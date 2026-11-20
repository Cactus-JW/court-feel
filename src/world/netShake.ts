import { ARENA, BALL, COURT } from '../config';
import { antennaShare } from '../physics/ball';

/** a ball event the shake hears of (`GameEvents.ballEvent`) */
export interface ShakeHit {
  kind: string;
  x: number;
  y: number;
  z: number;
  /** speed into what it hit (m/s) */
  impact: number;
}

/** an antenna's tip: how far it is bent along x and z (m), and how fast it moves (m/s) */
export interface Tip {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

/**
 * How the net's top and the antennae move after the ball hits them, for drawing. Looks only: what
 * the ball does is the physics' business (`BALL.tape`, `BALL.antenna`), and this follows its events.
 *
 * - An antenna whips: its tip is sent by the share of the ball's push the rod took (the same rod as
 *   the physics', light at its tip and held at the tape) and shakes back to straight (`ARENA.antenna`).
 * - The net's top is pushed away from the ball by a hit on the tape (and less by one in the mesh),
 *   most where it was hit, and swings back and settles; it is held at the posts (`ARENA.netTop`).
 */
export class NetShake {
  /** the tips of the antenna at -x and at +x */
  readonly tips: [Tip, Tip] = [
    { x: 0, z: 0, vx: 0, vz: 0 },
    { x: 0, z: 0, vx: 0, vz: 0 },
  ];
  /** the net top's recent hits: where along it, how far it is sent (m, signed along z), how long ago (s) */
  private hits: { x: number; push: number; age: number }[] = [];

  /** the shake is still showing */
  get moving(): boolean {
    return this.hits.length > 0 || this.tips.some((t) => t.x !== 0 || t.z !== 0 || t.vx !== 0 || t.vz !== 0);
  }

  hit(e: ShakeHit, netTop: number): void {
    if (e.kind === 'antenna') this.whip(e, netTop);
    else if (e.kind === 'tape' || e.kind === 'net') {
      const T = ARENA.netTop;
      const push = Math.min(T.max, T.perImpact * e.impact) * (e.kind === 'net' ? T.body : 1);
      if (push <= 0) return;
      // away from the ball
      this.hits.push({ x: e.x, push: (e.z >= 0 ? -1 : 1) * push, age: 0 });
      if (this.hits.length > T.hits) this.hits.shift();
    }
  }

  /** the rod above the tape is sent by what the ball gave it: J = (1 + e) m vn share, met by mass M there */
  private whip(e: ShakeHit, netTop: number): void {
    const share = antennaShare(e.y, netTop);
    if (share >= 1 || e.impact <= 0) return;
    const M = (BALL.mass * share) / (1 - share);
    const J = (1 + BALL.antenna.restitution) * BALL.mass * e.impact * share;
    // the point hit moves at J / M; the tip at that times its shape there, sqrt(M / tipMass)
    const speed = J / Math.sqrt(M * BALL.antenna.tipMass);
    const sx = e.x >= 0 ? 1 : -1;
    const dx = sx * COURT.antennaX - e.x;
    const dz = -e.z;
    const d = Math.hypot(dx, dz) || 1;
    const tip = this.tips[sx > 0 ? 1 : 0];
    tip.vx += (dx / d) * speed;
    tip.vz += (dz / d) * speed;
  }

  step(dt: number): void {
    const A = ARENA.antenna;
    const w = 2 * Math.PI * A.hz;
    const wd = w * Math.sqrt(1 - A.damping * A.damping);
    // a damped spring solved exactly over the frame, so a long frame cannot blow it up
    const e = Math.exp(-A.damping * w * dt);
    const c = Math.cos(wd * dt);
    const s = Math.sin(wd * dt);
    const swing = (x: number, v: number): [number, number] => [
      e * (x * c + ((v + A.damping * w * x) / wd) * s),
      e * (v * c - ((A.damping * w * v + w * w * x) / wd) * s),
    ];
    for (const t of this.tips) {
      [t.x, t.vx] = swing(t.x, t.vx);
      [t.z, t.vz] = swing(t.z, t.vz);
      // it cannot bend further than this
      const r = Math.hypot(t.x, t.z);
      if (r > A.max) {
        t.x *= A.max / r;
        t.z *= A.max / r;
      }
      if (r < A.still && Math.hypot(t.vx, t.vz) < A.still * w) t.x = t.z = t.vx = t.vz = 0;
    }
    for (const h of this.hits) h.age += dt;
    this.hits = this.hits.filter((h) => h.age < ARENA.netTop.life);
  }

  /** how far the net's top is pushed along z at `x` now (m): most where it was hit, nothing at the posts */
  top(x: number): number {
    const T = ARENA.netTop;
    const held = Math.max(0, 1 - Math.abs(x) / COURT.postX);
    let z = 0;
    for (const h of this.hits) {
      const d = (x - h.x) / T.spread;
      z += h.push * Math.exp(-d * d) * Math.sin(T.swing * h.age) * Math.exp(-T.damping * h.age);
    }
    return z * held;
  }
}
