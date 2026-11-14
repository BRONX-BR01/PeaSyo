export type StickName = 'left' | 'right';

export const STICK_MODES = ['Girar', 'Segurar'];
export const PUSH_DIRS = ['Cima', 'Baixo', 'Esquerda', 'Direita'];

export type StickConfig = {
  stick: StickName;
  mode: number; // 0 = girar sem parar, 1 = segurar uma direção
  cw: boolean; // true = horário
  speed: number; // voltas por segundo
  radius: number; // 0.2 a 1
  dir: number; // índice de PUSH_DIRS
  invertY: boolean;
};

export const DEFAULT_STICK: StickConfig = {
  stick: 'right',
  mode: 0,
  cw: true,
  speed: 1.5,
  radius: 1,
  dir: 0,
  invertY: false,
};

// x, y de cada direção (cima = Y negativo, como no controle de verdade)
const VEC = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];
const TICK_MS = 16;

export class StickRunner {
  private move: (name: StickName, x: number, y: number) => void;
  private onState: (running: boolean) => void;
  private timer: ReturnType<typeof setInterval> | null = null;
  private angle = 0;
  private last = 0;
  private cfg: StickConfig = DEFAULT_STICK;

  constructor(
    move: (name: StickName, x: number, y: number) => void,
    onState: (running: boolean) => void,
  ) {
    this.move = move;
    this.onState = onState;
  }

  isRunning() {
    return this.timer !== null;
  }

  start(cfg: StickConfig) {
    this.stop();
    this.cfg = cfg;
    this.angle = 0;
    this.last = Date.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
    this.onState(true);
  }

  // Muda a config com o analógico já rodando
  update(cfg: StickConfig) {
    if (this.timer !== null && cfg.stick !== this.cfg.stick) {
      this.move(this.cfg.stick, 0, 0);
    }
    this.cfg = cfg;
  }

  stop() {
    if (this.timer === null) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
    this.move(this.cfg.stick, 0, 0);
    this.onState(false);
  }

  private tick() {
    const c = this.cfg;
    const now = Date.now();
    const dt = (now - this.last) / 1000;
    this.last = now;
    const sy = c.invertY ? -1 : 1;
    let x: number;
    let y: number;
    if (c.mode === 0) {
      this.angle += (c.cw ? 1 : -1) * 2 * Math.PI * c.speed * dt;
      x = Math.cos(this.angle) * c.radius;
      y = Math.sin(this.angle) * c.radius;
    } else {
      const v = VEC[c.dir] || VEC[0];
      x = v[0] * c.radius;
      y = v[1] * c.radius;
    }
    this.move(c.stick, x, y * sy);
  }
}
