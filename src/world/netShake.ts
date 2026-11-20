import { ARENA, COURT } from '../config';

/** a ball event the shake hears of (`GameEvents.ballEvent`) */
export interface ShakeHit {
  kind: string;
  x: number;
  y: number;
  z: number;
  /** speed into what it hit (m/s) */
  impact: number;
}

/**
 * How the net's top moves, for drawing. Looks only: what the ball does is the physics' business.
 *
 * - A hit on the tape (and less one in the mesh) pushes it away from the ball, most where it was
 *   hit, and it swings back and settles; it is held at the posts (`ARENA.netTop`).
 * - Where an antenna is strapped, the net's side moves as the physics moves it (`BALL.antenna.net`):
 *   the top goes with it, as a taut cable does pushed at one point, straight back to each post.
 */
export class NetShake {
  /** the net top's recent hits: where along it, how far it is sent (m, signed along z), how long ago (s) */
  private hits: { x: number; push: number; age: number }[] = [];
  /** how far the net's side at each antenna (-x, +x) is pushed along z now (m), from the physics */
  readonly sides: [number, number] = [0, 0];

  /** the shake is still showing */
  get moving(): boolean {
    return this.hits.length > 0 || this.sides[0] !== 0 || this.sides[1] !== 0;
  }

  hit(e: ShakeHit): void {
    if (e.kind !== 'tape' && e.kind !== 'net') return;
    const T = ARENA.netTop;
    const push = Math.min(T.max, T.perImpact * e.impact) * (e.kind === 'net' ? T.body : 1);
    if (push <= 0) return;
    // away from the ball
    this.hits.push({ x: e.x, push: (e.z >= 0 ? -1 : 1) * push, age: 0 });
    if (this.hits.length > T.hits) this.hits.shift();
  }

  step(dt: number): void {
    for (const h of this.hits) h.age += dt;
    this.hits = this.hits.filter((h) => h.age < ARENA.netTop.life);
  }

  /** how far the net's top is pushed along z at `x` now (m): nothing at the posts */
  top(x: number): number {
    const T = ARENA.netTop;
    const held = Math.max(0, 1 - Math.abs(x) / COURT.postX);
    let z = 0;
    for (const h of this.hits) {
      const d = (x - h.x) / T.spread;
      z += h.push * Math.exp(-d * d) * Math.sin(T.swing * h.age) * Math.exp(-T.damping * h.age);
    }
    z *= held;
    // each antenna's side, straight back to the near post and to the far one
    for (const [i, sx] of [-1, 1].entries()) {
      const u = sx * x;
      const share =
        u >= COURT.antennaX ? (COURT.postX - u) / (COURT.postX - COURT.antennaX) : (u + COURT.postX) / (COURT.antennaX + COURT.postX);
      z += this.sides[i] * Math.max(0, share);
    }
    return z;
  }
}
