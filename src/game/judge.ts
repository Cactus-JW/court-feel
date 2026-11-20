import { COURT } from '../config';
import { R, type CollisionEvent } from '../physics/ball';
import type { BallEntity } from './ballEntity';

export type OutcomeKind = 'in' | 'out' | 'antenna' | 'outside-antenna' | 'under-net';

export interface Outcome {
  kind: OutcomeKind;
  /** court side where the ball ended (+1 user side, -1 opponent side) */
  side: 1 | -1;
  x: number;
  z: number;
  /** the side that wins the point */
  winner: 1 | -1;
  /** did the ball touch the net on the way */
  netTouch: boolean;
}

/** a ball that crossed the net's plane outside the crossing space: who sent it, to which side, past which antenna, when */
interface Wide {
  team: 1 | -1;
  to: 1 | -1;
  sx: 1 | -1;
  t: number;
}

/**
 * Line judge: watches the live ball and reports the first rally-ending event
 * (floor contact in/out, antenna touch, a ball out wide that can no longer be saved).
 *
 * A ball that crosses the net's plane outside the antennae (or under the net's end) is out (FIVB
 * 8.4.4), but not dead there: the team that sent it may chase it into the other team's free zone and
 * play it back outside the antenna on the same side (10.1.2). So it is called when it can no longer be
 * saved: where it lands (OUT, or OUTSIDE ANTENNA when it comes down in the other court), when the other
 * team plays it, or when it comes back between the antennae. Calling it at the crossing labelled a pass
 * shanked metres wide "antenna" (#110).
 */
export class Judge {
  armed = false;
  private prevZ = 0;
  private prevX = 0;
  private prevY = 0;
  netTouch = false;
  crossings = 0;
  private wide: Wide | null = null;

  /** on every clean touch; a ball out wide stays out wide through the touches of a live rally */
  arm(ball: BallEntity): void {
    if (!this.armed) this.wide = null;
    this.armed = true;
    this.prevZ = ball.pos.z;
    this.prevX = ball.pos.x;
    this.prevY = ball.pos.y;
    this.netTouch = false;
    this.crossings = 0;
  }

  disarm(): void {
    this.armed = false;
  }

  /** call after each ball step */
  step(ball: BallEntity, events: CollisionEvent[], netTop: number): Outcome | null {
    if (!this.armed || !ball.active) return null;
    const p = ball.pos;
    const lastSide: 1 | -1 = (ball.lastTouch?.side || (this.prevZ >= 0 ? 1 : -1)) as 1 | -1;
    let res: Outcome | null = null;
    const wide = this.wide;
    // crossing the net plane
    if (this.prevZ !== 0 && Math.sign(p.z) !== Math.sign(this.prevZ)) {
      const f = this.prevZ / (this.prevZ - p.z);
      const cx = this.prevX + (p.x - this.prevX) * f;
      const cy = this.prevY + (p.y - this.prevY) * f;
      this.crossings++;
      // past the net's end there is no net to go under: that is outside the antenna too
      const pastNet = Math.abs(cx) > COURT.netHalfLength;
      const outside = Math.abs(cx) > COURT.antennaX - R * 0.5 || pastNet;
      if (wide) {
        // coming back: only outside the antenna it went out past (10.1.2)
        if (outside && Math.sign(cx) === wide.sx) this.wide = null;
        else res = this.make('outside-antenna', p.x, p.z, wide.team);
      } else if (cy < netTop - COURT.netDepth && !pastNet) {
        res = this.make('under-net', p.x, p.z, lastSide);
      } else if (outside) {
        this.wide = { team: lastSide, to: p.z >= 0 ? 1 : -1, sx: cx >= 0 ? 1 : -1, t: ball.lastTouch?.t ?? 0 };
      }
    }
    // the other team plays a ball that went out wide: it was out, and they may not stop it coming back
    const w = this.wide;
    if (!res && w && ball.lastTouch && ball.lastTouch.side === w.to && ball.lastTouch.t > w.t) {
      res = this.make('outside-antenna', p.x, p.z, w.team);
    }
    if (!res) {
      for (const e of events) {
        if (e.kind === 'net' || e.kind === 'tape') this.netTouch = true;
        if (e.kind === 'antenna') {
          res = this.make('antenna', e.x, e.z, lastSide);
          break;
        }
        if (e.kind === 'post' || e.kind === 'board' || e.kind === 'wall' || e.kind === 'ceiling') {
          res = this.make('out', e.x, e.z, w ? w.team : lastSide);
          break;
        }
        if (e.kind === 'floor') {
          const inside = Math.abs(e.x) <= COURT.halfWidth && Math.abs(e.z) <= COURT.halfLength;
          const side: 1 | -1 = e.z >= 0 ? 1 : -1;
          // out wide, it is out wherever it lands; in the other court the reason is the antenna
          if (w) res = this.make(inside ? 'outside-antenna' : 'out', e.x, e.z, w.team);
          else if (inside) res = { kind: 'in', side, x: e.x, z: e.z, winner: -side as 1 | -1, netTouch: this.netTouch };
          else res = this.make('out', e.x, e.z, lastSide);
          break;
        }
      }
    }
    this.prevZ = p.z;
    this.prevX = p.x;
    this.prevY = p.y;
    if (res) this.armed = false;
    return res;
  }

  private make(kind: OutcomeKind, x: number, z: number, faultSide: 1 | -1): Outcome {
    return { kind, side: z >= 0 ? 1 : -1, x, z, winner: -faultSide as 1 | -1, netTouch: this.netTouch };
  }
}

export function outcomeLabel(o: Outcome, attackerSide: 1 | -1): string {
  switch (o.kind) {
    case 'in':
      return o.side === attackerSide ? (o.netTouch ? 'NET' : 'DOWN') : 'KILL';
    case 'out':
      return 'OUT';
    case 'antenna':
      return 'ANTENNA';
    case 'outside-antenna':
      return 'OUT (ANTENNA)';
    case 'under-net':
      return 'UNDER NET';
  }
}
