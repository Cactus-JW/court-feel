import { TIMING } from '../config';
import type { Athlete } from './athlete';
import { idleIntent, type Intent, type UserAction } from './intent';

export type { UserAction } from './intent';

interface Buffered {
  action: UserAction;
  /** real time (s) the press happened */
  at: number;
  /** the button was released while still buffered */
  released: boolean;
}

/**
 * Turns a player's intent into what their athlete does. Presses are executed on the frame they
 * arrive; if the action is not possible yet (mid-landing, already swinging) the press is buffered
 * for TIMING.bufferWindow and retried. It reads no key and no camera: it is handed an `Intent`
 * each frame (src/game/intent.ts), whoever's hands it came from.
 */
export class UserController {
  athlete: Athlete | null = null;
  private buffer: Buffered[] = [];
  /** handlers return true if the action was executed */
  handlers: Partial<Record<UserAction, () => boolean>> = {};
  releaseHandlers: Partial<Record<UserAction, () => void>> = {};
  realTime = 0;
  /** the intent of the frame being played: the buttons held, and where the player looks (an attack is aimed there) */
  intent: Intent = idleIntent();

  isHeld(a: UserAction): boolean {
    return this.intent.held.includes(a);
  }

  /** per render frame: movement command + edge-triggered actions */
  frame(dt: number, intent: Intent): void {
    this.realTime += dt;
    this.intent = intent;
    const a = this.athlete;
    if (!a) return;
    a.cmd.moveX = intent.moveX;
    a.cmd.moveZ = intent.moveZ;
    a.cmd.sprint = intent.sprint;
    // the body always faces where the camera looks, in both cameras: volleyball players face
    // the play while they shuffle, and it keeps the aim consistent
    a.cmd.faceYaw = intent.yaw;

    // ---- edges
    for (const p of intent.pressed) {
      if (!this.tryRun(p)) this.buffer.push({ action: p, at: this.realTime, released: false });
    }
    for (const action of intent.released) {
      const pending = this.buffer.find((b) => b.action === action);
      if (pending) pending.released = true;
      else this.releaseHandlers[action]?.();
    }

    // ---- retry buffered presses
    if (this.buffer.length) {
      const keep: Buffered[] = [];
      for (const b of this.buffer) {
        if (this.realTime - b.at > TIMING.bufferWindow) continue;
        if (!this.tryRun(b.action)) keep.push(b);
        else if (b.released) this.releaseHandlers[b.action]?.();
      }
      this.buffer = keep;
    }
  }

  private tryRun(a: UserAction): boolean {
    const h = this.handlers[a];
    return h ? h() : true;
  }

  clear(): void {
    this.buffer.length = 0;
  }
}
