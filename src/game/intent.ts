import type { Input } from '../core/input';

/** what a player's buttons mean. Right mouse is `block` and `set` at once: the contact system decides which by the ball */
export type UserAction = 'jump' | 'attack' | 'block' | 'pass' | 'set' | 'toss';

/**
 * What one player asks of their athlete for one frame: where to go, where they look, and the
 * buttons that went down, came up and are held. It is everything the simulation takes from a
 * player's hands, and it is plain data, so it can be logged, played back, or sent from another
 * machine (docs/adr/0011). The simulation never reads a key or a camera: it is handed this.
 */
export interface Intent {
  /** the direction to move, on the floor, in the court's frame (length 0..1) */
  moveX: number;
  moveZ: number;
  sprint: boolean;
  /** a move key is down or a thumb is on the stick, even when they cancel out: the player is steering, so nothing walks the athlete for them */
  steering: boolean;
  /**
   * The game may help these feet onto the spot of a set (Settings: Set aim assist). A person's are
   * helped; an autopilot steers to the centimetre and the help would fight it.
   */
  helped: boolean;
  /** where the player looks. The body faces `yaw`; an attack is aimed along `yaw` and `pitch` */
  yaw: number;
  pitch: number;
  /** the look is from the athlete's own eyes (aim reads the pitch differently from behind) */
  firstPerson: boolean;
  /** buttons that went down this frame, in the order they are acted on */
  pressed: UserAction[];
  /** buttons that came up this frame */
  released: UserAction[];
  /** buttons that are down */
  held: UserAction[];
}

export const idleIntent = (): Intent => ({
  moveX: 0,
  moveZ: 0,
  sprint: false,
  steering: false,
  helped: true,
  yaw: 0,
  pitch: 0,
  firstPerson: false,
  pressed: [],
  released: [],
  held: [],
});

/** a copy that shares nothing with the original (a log keeps these) */
export const copyIntent = (i: Intent): Intent => ({ ...i, pressed: [...i.pressed], released: [...i.released], held: [...i.held] });

/** the keys and buttons of each action. The order is the order presses and releases are acted on */
const BINDS: readonly [UserAction, string][] = [
  ['jump', 'Space'],
  ['attack', 'Mouse0'],
  ['block', 'Mouse2'],
  ['pass', 'KeyE'],
  ['toss', 'KeyQ'],
];

/** the part of `Input` an intent is read from */
export type Hands = Pick<Input, 'isDown' | 'consumePress' | 'consumeRelease' | 'stick'>;

/** where a player is looking: the camera rig is one */
export interface Look {
  readonly yaw: number;
  readonly pitch: number;
  /** 'fp' is first person */
  readonly mode: string;
}

/**
 * This frame's intent, from the keys, the mouse buttons and the touch stick (all of them come
 * through `Input`) and from where the player looks. It takes the button edges it reads.
 */
export function readIntent(input: Hands, look: Look, out: Intent = idleIntent()): Intent {
  // ---- movement relative to where the player looks
  const ahead = input.isDown('KeyW') || input.isDown('ArrowUp');
  const back = input.isDown('KeyS') || input.isDown('ArrowDown');
  const right = input.isDown('KeyD') || input.isDown('ArrowRight');
  const left = input.isDown('KeyA') || input.isDown('ArrowLeft');
  let f = 0;
  let s = 0;
  if (ahead) f += 1;
  if (back) f -= 1;
  if (right) s += 1;
  if (left) s -= 1;
  const stick = input.stick;
  out.steering = ahead || back || right || left || stick.active;
  if (stick.active) {
    f += stick.y;
    s += stick.x;
  }
  const yaw = look.yaw;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  let mx = fx * f + rx * s;
  let mz = fz * f + rz * s;
  const l = Math.hypot(mx, mz);
  if (l > 1) {
    mx /= l;
    mz /= l;
  }
  out.moveX = mx;
  out.moveZ = mz;
  out.helped = true;
  out.sprint = input.isDown('ShiftLeft') || input.isDown('ShiftRight') || (stick.active && stick.sprint);
  out.yaw = yaw;
  out.pitch = look.pitch;
  out.firstPerson = look.mode === 'fp';

  // ---- buttons
  out.pressed.length = 0;
  out.released.length = 0;
  out.held.length = 0;
  for (const [action, code] of BINDS) if (input.consumePress(code)) out.pressed.push(action);
  for (const [action, code] of BINDS) if (input.consumeRelease(code)) out.released.push(action);
  for (const [action, code] of BINDS) {
    if (!input.isDown(code)) continue;
    out.held.push(action);
    if (action === 'block') out.held.push('set');
  }
  return out;
}
