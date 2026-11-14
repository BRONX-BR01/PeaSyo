import {storage} from '../store/mmkv';

// Máscaras = bits do ControllerState do Chiaki (ver Chiaki.kt)
export type MacroButton = {
  id: string;
  label: string;
  mask?: number;
  trigger?: 'left' | 'right';
};

export const MACRO_BUTTONS: MacroButton[] = [
  {id: 'cross', label: 'X', mask: 1 << 0},
  {id: 'circle', label: 'O', mask: 1 << 1},
  {id: 'square', label: '□', mask: 1 << 2},
  {id: 'triangle', label: '△', mask: 1 << 3},
  {id: 'l1', label: 'L1', mask: 1 << 8},
  {id: 'r1', label: 'R1', mask: 1 << 9},
  {id: 'l2', label: 'L2', trigger: 'left'},
  {id: 'r2', label: 'R2', trigger: 'right'},
  {id: 'l3', label: 'L3', mask: 1 << 10},
  {id: 'r3', label: 'R3', mask: 1 << 11},
  {id: 'up', label: '↑', mask: 1 << 6},
  {id: 'down', label: '↓', mask: 1 << 7},
  {id: 'left', label: '←', mask: 1 << 4},
  {id: 'right', label: '→', mask: 1 << 5},
  {id: 'options', label: 'OPTIONS', mask: 1 << 12},
  {id: 'share', label: 'SHARE', mask: 1 << 13},
  {id: 'touchpad', label: 'TOUCHPAD', mask: 1 << 14},
];

export const MACRO_MODES = [
  'Uma vez',
  'Repetir N vezes',
  'Enquanto segura',
  'Liga/desliga',
];

export type MacroStep = {id: string; hold: number; delay: number};

export type MacroConfig = {
  enabled: boolean;
  triggerKey: number; // KeyEvent.KEYCODE_*, 0 = nenhum
  mode: number; // índice de MACRO_MODES
  count: number;
  hold: number; // valor padrão para novos passos (ms)
  delay: number; // valor padrão para novos passos (ms)
  steps: MacroStep[];
  x: number;
  y: number;
};

export const DEFAULT_MACRO: MacroConfig = {
  enabled: false,
  triggerKey: 0,
  mode: 0,
  count: 3,
  hold: 50,
  delay: 50,
  steps: [],
  x: 8,
  y: 80,
};

const STORE_KEY = 'macro_config';

export function findButton(id: string): MacroButton | undefined {
  return MACRO_BUTTONS.find(b => b.id === id);
}

export function loadMacro(): MacroConfig {
  try {
    const raw = storage.getString(STORE_KEY);
    if (!raw) {
      return {...DEFAULT_MACRO};
    }
    const parsed = JSON.parse(raw);
    const steps = Array.isArray(parsed.steps)
      ? parsed.steps.filter((s: any) => s && findButton(s.id))
      : [];
    return {...DEFAULT_MACRO, ...parsed, steps};
  } catch (e) {
    return {...DEFAULT_MACRO};
  }
}

export function saveMacro(cfg: MacroConfig) {
  try {
    storage.set(STORE_KEY, JSON.stringify(cfg));
  } catch (e) {}
}

const KEY_NAMES: {[code: number]: string} = {
  96: 'A',
  97: 'B',
  99: 'X',
  100: 'Y',
  102: 'L1',
  103: 'R1',
  104: 'L2',
  105: 'R2',
  106: 'L3',
  107: 'R3',
  108: 'START',
  109: 'SELECT',
  110: 'MODE',
  19: 'D-pad ↑',
  20: 'D-pad ↓',
  21: 'D-pad ←',
  22: 'D-pad →',
  188: 'BUTTON_1',
  189: 'BUTTON_2',
  190: 'BUTTON_3',
  191: 'BUTTON_4',
};

export function keyLabel(code: number): string {
  if (!code) {
    return 'não definido';
  }
  return KEY_NAMES[code] || 'tecla ' + code;
}

/**
 * Executa a sequência com setTimeout. Roda na thread JS; cada passo aperta o
 * botão, espera `hold` ms, solta e espera `delay` ms antes do próximo.
 * pressButton/pressTrigger do app usam OR / AND-NOT, então soltar é seguro.
 */
export class MacroRunner {
  private running = false;
  private idx = 0;
  private iter = 0;
  private timer: any = null;
  private pressed: MacroButton | null = null;
  private cfg: MacroConfig = DEFAULT_MACRO;
  private isHeld: () => boolean = () => false;

  constructor(
    private press: (b: MacroButton, down: boolean) => void,
    private onState: (running: boolean) => void,
  ) {}

  isRunning() {
    return this.running;
  }

  start(cfg: MacroConfig, isHeld: () => boolean) {
    if (this.running || cfg.steps.length === 0) {
      return;
    }
    this.cfg = cfg;
    this.isHeld = isHeld;
    this.running = true;
    this.idx = 0;
    this.iter = 0;
    this.onState(true);
    this.pressStep();
  }

  stop() {
    const was = this.running;
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.releasePressed();
    if (was) {
      this.onState(false);
    }
  }

  private releasePressed() {
    if (this.pressed) {
      const b = this.pressed;
      this.pressed = null;
      try {
        this.press(b, false);
      } catch (e) {}
    }
  }

  private shouldContinue() {
    switch (this.cfg.mode) {
      case 0:
        return false;
      case 1:
        return this.iter < this.cfg.count;
      case 2:
        return this.isHeld();
      default:
        return true;
    }
  }

  private pressStep = () => {
    if (!this.running) {
      return;
    }
    const step = this.cfg.steps[this.idx];
    const b = step ? findButton(step.id) : undefined;
    if (!b) {
      this.stop();
      return;
    }
    this.pressed = b;
    try {
      this.press(b, true);
    } catch (e) {
      this.stop();
      return;
    }
    this.timer = setTimeout(this.releaseStep, Math.max(10, step.hold));
  };

  private releaseStep = () => {
    const step = this.cfg.steps[this.idx];
    this.releasePressed();
    if (!this.running) {
      return;
    }
    this.idx++;
    if (this.idx >= this.cfg.steps.length) {
      this.idx = 0;
      this.iter++;
      if (!this.shouldContinue()) {
        this.stop();
        return;
      }
    }
    this.timer = setTimeout(this.pressStep, Math.max(0, step ? step.delay : 0));
  };
}
