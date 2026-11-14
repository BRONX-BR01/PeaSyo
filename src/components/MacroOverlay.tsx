import React from 'react';
import {
  DeviceEventEmitter,
  NativeModules,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  MACRO_BUTTONS,
  MACRO_MODES,
  MacroButton,
  MacroConfig,
  MacroRunner,
  findButton,
  keyLabel,
  loadMacro,
  saveMacro,
} from '../common/macro';
import {
  DEFAULT_STICK,
  PUSH_DIRS,
  STICK_MODES,
  StickConfig,
  StickRunner,
} from '../common/macroStick';

type Props = {
  onPressButton: (buttonMask: number, isPressed: boolean) => void;
  onPressTrigger: (name: string, value: number) => void;
  onMoveStick: (name: string, x: number, y: number) => void;
};

const BUBBLE = 44;
const PANEL_W = 300;

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

const Stepper = ({
  label,
  value,
  onMinus,
  onPlus,
  dim,
}: {
  label: string;
  value: string;
  onMinus: () => void;
  onPlus: () => void;
  dim?: boolean;
}) => (
  <View style={[styles.row, dim ? {opacity: 0.4} : null]}>
    <Text style={[styles.text, {flex: 1}]}>
      {label}: {value}
    </Text>
    <Pressable style={styles.smallBtn} onPress={onMinus}>
      <Text style={styles.btnText}>-</Text>
    </Pressable>
    <Pressable style={styles.smallBtn} onPress={onPlus}>
      <Text style={styles.btnText}>+</Text>
    </Pressable>
  </View>
);

const MacroOverlay = ({onPressButton, onPressTrigger, onMoveStick}: Props) => {
  const {width, height} = useWindowDimensions();
  const [cfg, setCfg] = React.useState<MacroConfig>(() => loadMacro());
  const cfgRef = React.useRef(cfg);
  const [pos, setPos] = React.useState({x: cfg.x, y: cfg.y});
  const [open, setOpen] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [capturing, setCapturing] = React.useState(false);
  const [stick, setStick] = React.useState<StickConfig>(DEFAULT_STICK);
  const stickRef = React.useRef(stick);
  const [stickRunning, setStickRunning] = React.useState(false);

  const heldRef = React.useRef(false);
  const propsRef = React.useRef({onPressButton, onPressTrigger, onMoveStick});
  propsRef.current = {onPressButton, onPressTrigger, onMoveStick};
  const winRef = React.useRef({width, height});
  winRef.current = {width, height};

  const gm = NativeModules.GamepadManager;

  const update = React.useCallback((patch: Partial<MacroConfig>) => {
    const next = {...cfgRef.current, ...patch};
    cfgRef.current = next;
    setCfg(next);
    saveMacro(next);
  }, []);

  const runnerRef = React.useRef<MacroRunner | null>(null);
  if (!runnerRef.current) {
    runnerRef.current = new MacroRunner(
      (b: MacroButton, down: boolean) => {
        if (b.mask !== undefined) {
          propsRef.current.onPressButton(b.mask, down);
        } else if (b.trigger) {
          propsRef.current.onPressTrigger(b.trigger, down ? 1 : 0);
        }
      },
      (r: boolean) => setRunning(r),
    );
  }
  const runner = runnerRef.current;

  // Analógico (girar sem parar / segurar direção), independente da sequência
  const stickRunnerRef = React.useRef<StickRunner | null>(null);
  if (!stickRunnerRef.current) {
    stickRunnerRef.current = new StickRunner(
      (name, x, y) => propsRef.current.onMoveStick(name, x, y),
      (r: boolean) => setStickRunning(r),
    );
  }
  const stickRunner = stickRunnerRef.current;

  const updateStick = React.useCallback(
    (patch: Partial<StickConfig>) => {
      const next = {...stickRef.current, ...patch};
      stickRef.current = next;
      setStick(next);
      stickRunner.update(next);
    },
    [stickRunner],
  );

  const toggleStick = React.useCallback(() => {
    if (stickRunner.isRunning()) {
      stickRunner.stop();
    } else {
      stickRunner.start(stickRef.current);
    }
  }, [stickRunner]);

  const triggerDown = React.useCallback(() => {
    const c = cfgRef.current;
    heldRef.current = true;
    if (c.mode === 3 && runner.isRunning()) {
      runner.stop();
      return;
    }
    runner.start(c, () => heldRef.current);
  }, [runner]);

  const triggerUp = React.useCallback(() => {
    heldRef.current = false;
  }, []);

  // Botão físico do controle (evento vindo do nativo: MacroKeys.java)
  React.useEffect(() => {
    const sub = DeviceEventEmitter.addListener('onMacroKey', (e: any) => {
      if (e.action === 'capture') {
        setCapturing(false);
        update({triggerKey: e.keyCode});
      } else if (e.action === 'down') {
        triggerDown();
      } else if (e.action === 'up') {
        triggerUp();
      }
    });
    return () => sub.remove();
  }, [update, triggerDown, triggerUp]);

  React.useEffect(() => {
    gm?.setMacroTriggerKey?.(cfg.enabled ? cfg.triggerKey : 0);
  }, [gm, cfg.enabled, cfg.triggerKey]);

  React.useEffect(() => {
    return () => {
      runner.stop();
      stickRunner.stop();
      gm?.setMacroTriggerKey?.(0);
      gm?.setMacroCapture?.(false);
    };
  }, [gm, runner, stickRunner]);

  // Bolinha arrastável
  const dragStart = React.useRef({x: 0, y: 0});
  const moved = React.useRef(false);
  const posRef = React.useRef(pos);
  posRef.current = pos;
  const pan = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          dragStart.current = {...posRef.current};
          moved.current = false;
        },
        onPanResponderMove: (_e, g) => {
          if (Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6) {
            moved.current = true;
          }
          if (moved.current) {
            const w = winRef.current;
            setPos({
              x: clamp(dragStart.current.x + g.dx, 0, w.width - BUBBLE),
              y: clamp(dragStart.current.y + g.dy, 0, w.height - BUBBLE),
            });
          }
        },
        onPanResponderRelease: () => {
          if (!moved.current) {
            setOpen(o => !o);
          } else {
            update({x: posRef.current.x, y: posRef.current.y});
          }
        },
      }),
    [update],
  );

  const toggleCapture = () => {
    const next = !capturing;
    setCapturing(next);
    gm?.setMacroCapture?.(next);
  };

  const addStep = (b: MacroButton) => {
    if (cfg.steps.length >= 32) {
      return;
    }
    runner.stop();
    update({steps: [...cfg.steps, {id: b.id, hold: cfg.hold, delay: cfg.delay}]});
  };

  const stepsText = cfg.steps.length
    ? cfg.steps
        .map((s, i) => {
          const b = findButton(s.id);
          return `${i + 1}. ${b ? b.label : s.id}  ${s.hold}ms  +${s.delay}ms`;
        })
        .join('\n')
    : '(vazia)';

  const panelLeft =
    pos.x + BUBBLE + 8 + PANEL_W <= width
      ? pos.x + BUBBLE + 8
      : Math.max(0, pos.x - PANEL_W - 8);
  const panelMaxH = Math.min(height - 16, 340);
  const panelTop = clamp(pos.y, 0, Math.max(0, height - panelMaxH));

  const bubbleColor = !cfg.enabled ? '#5a5a5a' : running ? '#28a046' : '#2864c8';
  const showRun = cfg.enabled && cfg.steps.length > 0;
  const stickTop = Math.min(
    pos.y + BUBBLE + 6 + (showRun ? BUBBLE - 8 + 6 : 0),
    height - 40,
  );

  return (
    <>
      <View
        {...pan.panHandlers}
        style={[
          styles.bubble,
          {left: pos.x, top: pos.y, backgroundColor: bubbleColor},
        ]}>
        <Text style={styles.bubbleText}>M</Text>
      </View>

      {showRun && (
        <Pressable
          style={[
            styles.runBtn,
            {
              left: pos.x + 4,
              top: Math.min(pos.y + BUBBLE + 6, height - 40),
              backgroundColor: running ? '#b03a3a' : '#28a046',
            },
          ]}
          onPressIn={triggerDown}
          onPressOut={triggerUp}>
          <Text style={styles.bubbleText}>{running ? '■' : '▶'}</Text>
        </Pressable>
      )}

      <Pressable
        style={[
          styles.runBtn,
          {
            left: pos.x + 4,
            top: stickTop,
            backgroundColor: stickRunning ? '#b03a3a' : '#8a4fd0',
          },
        ]}
        onPress={toggleStick}>
        <Text style={styles.bubbleText}>{stickRunning ? '■' : '↻'}</Text>
      </Pressable>

      {open && (
        <View
          style={[
            styles.panel,
            {left: panelLeft, top: panelTop, maxHeight: panelMaxH},
          ]}>
          <ScrollView nestedScrollEnabled>
            <View style={styles.row}>
              <Text style={[styles.title, {flex: 1}]}>Macro</Text>
              <Pressable style={styles.btn} onPress={() => setOpen(false)}>
                <Text style={styles.btnText}>Fechar</Text>
              </Pressable>
            </View>

            <View style={styles.row}>
              <Pressable
                style={[styles.btn, cfg.enabled ? styles.btnOn : null]}
                onPress={() => {
                  if (cfg.enabled) {
                    runner.stop();
                  }
                  update({enabled: !cfg.enabled});
                }}>
                <Text style={styles.btnText}>
                  {cfg.enabled ? 'Ativada: SIM' : 'Ativada: NÃO'}
                </Text>
              </Pressable>
            </View>

            <View style={styles.row}>
              <Text style={[styles.text, {flex: 1}]}>
                Gatilho: {keyLabel(cfg.triggerKey)}
              </Text>
              <Pressable
                style={[styles.btn, capturing ? styles.btnOn : null]}
                onPress={toggleCapture}>
                <Text style={styles.btnText}>
                  {capturing ? 'Aperte um botão...' : 'Definir'}
                </Text>
              </Pressable>
            </View>
            <Text style={styles.hint}>
              O gatilho por botão só funciona com controle Bluetooth/OTG comum
              (não no modo de driver USB). O botão ▶ ao lado do M funciona
              sempre.
            </Text>

            <Text style={[styles.text, {marginTop: 8}]}>
              Sequência:{'\n'}
              {stepsText}
            </Text>
            <View style={styles.row}>
              <Pressable
                style={styles.btn}
                onPress={() => {
                  runner.stop();
                  update({steps: cfg.steps.slice(0, -1)});
                }}>
                <Text style={styles.btnText}>Desfazer</Text>
              </Pressable>
              <Pressable
                style={styles.btn}
                onPress={() => {
                  runner.stop();
                  update({steps: []});
                }}>
                <Text style={styles.btnText}>Limpar</Text>
              </Pressable>
            </View>

            <Text style={[styles.text, {marginTop: 8}]}>Adicionar botão:</Text>
            <View style={styles.chips}>
              {MACRO_BUTTONS.map(b => (
                <Pressable
                  key={b.id}
                  style={styles.chip}
                  onPress={() => addStep(b)}>
                  <Text style={styles.btnText}>{b.label}</Text>
                </Pressable>
              ))}
            </View>

            <Stepper
              label="Segurar (novos)"
              value={cfg.hold + ' ms'}
              onMinus={() => update({hold: Math.max(10, cfg.hold - 10)})}
              onPlus={() => update({hold: Math.min(2000, cfg.hold + 10)})}
            />
            <Stepper
              label="Pausa após (novos)"
              value={cfg.delay + ' ms'}
              onMinus={() => update({delay: Math.max(0, cfg.delay - 10)})}
              onPlus={() => update({delay: Math.min(5000, cfg.delay + 10)})}
            />

            <View style={styles.row}>
              <Pressable
                style={styles.btn}
                onPress={() => update({mode: (cfg.mode + 1) % MACRO_MODES.length})}>
                <Text style={styles.btnText}>Modo: {MACRO_MODES[cfg.mode]}</Text>
              </Pressable>
            </View>
            <Stepper
              label="Vezes"
              value={String(cfg.count)}
              dim={cfg.mode !== 1}
              onMinus={() => update({count: Math.max(1, cfg.count - 1)})}
              onPlus={() => update({count: Math.min(99, cfg.count + 1)})}
            />

            <View style={styles.row}>
              <Pressable
                style={styles.btn}
                onPressIn={triggerDown}
                onPressOut={triggerUp}>
                <Text style={styles.btnText}>Testar</Text>
              </Pressable>
              <Pressable style={styles.btn} onPress={() => runner.stop()}>
                <Text style={styles.btnText}>Parar</Text>
              </Pressable>
            </View>

            <Text style={[styles.title, {marginTop: 14}]}>Analógico</Text>
            <Text style={styles.hint}>
              Roda ao mesmo tempo da sequência de botões. O botão ↻ ao lado do
              M liga e desliga.
            </Text>
            <View style={styles.row}>
              <Pressable
                style={styles.btn}
                onPress={() =>
                  updateStick({stick: stick.stick === 'left' ? 'right' : 'left'})
                }>
                <Text style={styles.btnText}>
                  {stick.stick === 'left' ? 'Esquerdo' : 'Direito'}
                </Text>
              </Pressable>
              <Pressable
                style={styles.btn}
                onPress={() =>
                  updateStick({mode: (stick.mode + 1) % STICK_MODES.length})
                }>
                <Text style={styles.btnText}>
                  Modo: {STICK_MODES[stick.mode]}
                </Text>
              </Pressable>
            </View>

            {stick.mode === 0 ? (
              <>
                <View style={styles.row}>
                  <Pressable
                    style={styles.btn}
                    onPress={() => updateStick({cw: !stick.cw})}>
                    <Text style={styles.btnText}>
                      Sentido: {stick.cw ? 'Horário' : 'Anti-horário'}
                    </Text>
                  </Pressable>
                </View>
                <Stepper
                  label="Voltas por seg"
                  value={stick.speed.toFixed(1)}
                  onMinus={() =>
                    updateStick({
                      speed: Math.max(0.2, Math.round((stick.speed - 0.1) * 10) / 10),
                    })
                  }
                  onPlus={() =>
                    updateStick({
                      speed: Math.min(8, Math.round((stick.speed + 0.1) * 10) / 10),
                    })
                  }
                />
              </>
            ) : (
              <View style={styles.row}>
                <Pressable
                  style={styles.btn}
                  onPress={() =>
                    updateStick({dir: (stick.dir + 1) % PUSH_DIRS.length})
                  }>
                  <Text style={styles.btnText}>
                    Direção: {PUSH_DIRS[stick.dir]}
                  </Text>
                </Pressable>
              </View>
            )}

            <Stepper
              label="Força"
              value={Math.round(stick.radius * 100) + '%'}
              onMinus={() =>
                updateStick({
                  radius: Math.max(0.2, Math.round((stick.radius - 0.05) * 100) / 100),
                })
              }
              onPlus={() =>
                updateStick({
                  radius: Math.min(1, Math.round((stick.radius + 0.05) * 100) / 100),
                })
              }
            />
            <View style={styles.row}>
              <Pressable
                style={[styles.btn, stick.invertY ? styles.btnOn : null]}
                onPress={() => updateStick({invertY: !stick.invertY})}>
                <Text style={styles.btnText}>
                  Inverter vertical: {stick.invertY ? 'SIM' : 'NÃO'}
                </Text>
              </Pressable>
            </View>
            <View style={styles.row}>
              <Pressable
                style={[styles.btn, stickRunning ? styles.btnOn : null]}
                onPress={toggleStick}>
                <Text style={styles.btnText}>
                  {stickRunning
                    ? 'Parar analógico'
                    : stick.mode === 0
                    ? 'Iniciar giro'
                    : 'Iniciar'}
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      )}
    </>
  );
};

const styles = StyleSheet.create({
  bubble: {
    position: 'absolute',
    width: BUBBLE,
    height: BUBBLE,
    borderRadius: BUBBLE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.85,
    zIndex: 9997,
  },
  runBtn: {
    position: 'absolute',
    width: BUBBLE - 8,
    height: BUBBLE - 8,
    borderRadius: (BUBBLE - 8) / 2,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.85,
    zIndex: 9997,
  },
  bubbleText: {color: '#fff', fontSize: 16, fontWeight: 'bold'},
  panel: {
    position: 'absolute',
    width: PANEL_W,
    backgroundColor: 'rgba(24,26,32,0.94)',
    borderRadius: 12,
    padding: 10,
    zIndex: 9997,
  },
  title: {color: '#fff', fontSize: 16, fontWeight: 'bold'},
  text: {color: '#fff', fontSize: 13},
  hint: {color: '#9aa0aa', fontSize: 11, marginTop: 2},
  row: {flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 6},
  btn: {
    backgroundColor: '#3a3f4b',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  btnOn: {backgroundColor: '#2864c8'},
  smallBtn: {
    backgroundColor: '#3a3f4b',
    borderRadius: 8,
    width: 34,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: {color: '#fff', fontSize: 12},
  chips: {flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6},
  chip: {
    backgroundColor: '#3a3f4b',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
});

export default MacroOverlay;
