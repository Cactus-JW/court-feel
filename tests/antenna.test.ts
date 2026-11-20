import { describe, expect, it } from 'vitest';
import { BALL, COURT, SIM } from '../src/config';
import { antennaShape, makeBall, makeRodPoints, R, stepBall, stillNet, type BallState, type CollisionEvent } from '../src/physics/ball';

// The antennae (BALL.antenna): 10 mm fibreglass rods strapped to the net's sides, 0.8 m free above
// it. The rod bends out of the ball's way and shakes, the net's side moves with it, and the ball is
// turned by where and how it met the rod.

const DT = 1 / SIM.hz;
const top = COURT.netHeightMen;
const env = { netTop: top };
const KMH = 1 / 3.6;

/** a ball flying along -z at the antenna at +x, `off` m inside its line, `above` m over the net's top */
function atRod(kmh: number, above: number, off: number, topspin = 0): BallState {
  const b = makeBall();
  b.p = { x: COURT.antennaX - off, y: top + above, z: 0.6 };
  b.v = { x: 0, y: 0, z: -kmh * KMH };
  b.w = { x: -topspin, y: 0, z: 0 };
  return b;
}

function run(b: BallState, secs: number): CollisionEvent[] {
  const events: CollisionEvent[] = [];
  for (let t = 0; t < secs; t += DT) stepBall(b, DT, env, events);
  return events;
}

/** how many of the touches across the rod's width and height a ball at `kmh` comes back from */
function sentBack(kmh: number): number {
  let touched = 0;
  let back = 0;
  for (const above of [0.12, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.78])
    for (let off = -0.1; off <= 0.1001; off += 0.01) {
      const b = atRod(kmh, above, off);
      if (!run(b, 0.25).some((e) => e.kind === 'antenna')) continue;
      touched++;
      if (b.v.z > 0) back++;
    }
  return back / touched;
}

const turned = (b: BallState) => Math.atan2(Math.abs(b.v.x), -b.v.z);

describe('the antennae', () => {
  it('a 100 km/h spike that catches the antenna goes on into their court, turned and slowed a little', () => {
    const b = atRod(100, 0.4, 0.06);
    const events = run(b, 0.3);
    expect(events.filter((e) => e.kind === 'antenna')).toHaveLength(1);
    expect(b.v.z).toBeLessThan(0);
    expect(b.p.z).toBeLessThan(-3);
    expect(Math.hypot(b.v.x, b.v.y, b.v.z)).toBeGreaterThan(100 * KMH * 0.6);
    expect(turned(b)).toBeGreaterThan(0.05);
    expect(turned(b)).toBeLessThan(0.35);
  });

  it('the harder the ball, the less often the antenna sends it back: it pushes the rod out of its way', () => {
    const slow = sentBack(30);
    const fast = sentBack(100);
    expect(fast).toBeLessThan(slow);
    expect(fast).toBeLessThan(0.2);
  });

  it('a ball is turned to the side of the rod its centre passes', () => {
    const inside = atRod(60, 0.3, 0.05);
    const outside = atRod(60, 0.3, -0.05);
    run(inside, 0.2);
    run(outside, 0.2);
    expect(inside.v.x).toBeLessThan(0);
    expect(outside.v.x).toBeGreaterThan(0);
  });

  it('low down, where the rod is held, it turns a ball more than near its tip, where it gives', () => {
    const low = atRod(100, 0.15, 0.05);
    const high = atRod(100, 0.7, 0.05);
    run(low, 0.2);
    run(high, 0.2);
    expect(turned(low)).toBeGreaterThan(turned(high));
  });

  it('a slow ball into the rod is pushed back by it springing back, slower than it came', () => {
    const b = atRod(10, 0.6, 0);
    b.p.z = 0.2;
    run(b, 0.4);
    expect(b.v.z).toBeGreaterThan(0);
    expect(Math.hypot(b.v.x, b.v.z)).toBeLessThan(10 * KMH);
  });

  it('the rod is driven away from the ball, its tip further than where it was hit, and it shakes for a second', () => {
    const b = atRod(60, 0.3, 0.03);
    const rod = makeRodPoints();
    let tip = 0;
    let atHit = 0;
    for (let t = 0; t < 0.15; t += DT) {
      stepBall(b, DT, env);
      antennaShape(b, 1, top, rod);
      tip = Math.min(tip, rod.z[rod.z.length - 1]);
      atHit = Math.min(atHit, rod.z[Math.round((rod.z.length - 1) * (0.3 / COURT.antennaAboveNet))]);
    }
    expect(tip).toBeLessThan(atHit);
    expect(atHit).toBeLessThan(-0.01);
    // fibreglass hardly damps: still shaking a second on, straight within a couple of millimetres by
    // three, and at rest in the end
    run(b, 1);
    antennaShape(b, 1, top, rod);
    expect(Math.abs(rod.z[rod.z.length - 1])).toBeGreaterThan(0.002);
    run(b, 2);
    antennaShape(b, 1, top, rod);
    expect(Math.abs(rod.z[rod.z.length - 1])).toBeLessThan(0.002);
    run(b, 10);
    expect(b.ant.every((v) => v === 0)).toBe(true);
  });

  it('the rod does not stretch: bent far, its tip comes down', () => {
    const b = atRod(100, 0.5, 0);
    const rod = makeRodPoints();
    let lowest = Infinity;
    for (let t = 0; t < 0.1; t += DT) {
      stepBall(b, DT, env);
      antennaShape(b, 1, top, rod);
      const n = rod.y.length - 1;
      let len = 0;
      for (let i = 1; i <= n; i++) len += Math.hypot(rod.x[i] - rod.x[i - 1], rod.y[i] - rod.y[i - 1], rod.z[i] - rod.z[i - 1]);
      expect(len).toBeCloseTo(COURT.antennaAboveNet, 6);
      lowest = Math.min(lowest, rod.y[n]);
    }
    expect(lowest).toBeLessThan(top + COURT.antennaAboveNet - 0.02);
  });

  it('a hit on the antenna moves the net it is strapped to, away from the ball, more for a harder ball', () => {
    const side = (kmh: number) => {
      const b = atRod(kmh, 0.15, 0.03);
      let most = 0;
      const rod = makeRodPoints();
      for (let t = 0; t < 0.3; t += DT) {
        stepBall(b, DT, env);
        antennaShape(b, 1, top, rod);
        most = Math.min(most, rod.z[0]);
      }
      return most;
    };
    expect(side(30)).toBeLessThan(0);
    expect(side(100)).toBeLessThan(side(30));
  });

  it('every antenna call is a real touch: a ball passing a few millimetres clear of the rod is not touched', () => {
    for (const above of [-0.3, 0.2, 0.7]) {
      const b = makeBall();
      b.p = { x: COURT.antennaX - R - COURT.antennaRadius - 0.003, y: top + above, z: 2 };
      b.v = { x: 0, y: 0, z: -18 };
      expect(run(b, 0.25).some((e) => e.kind === 'antenna')).toBe(false);
    }
  });

  it('a ball that only brushes the rod is still called, once', () => {
    const b = atRod(80, 0.5, R + COURT.antennaRadius - 0.004);
    expect(run(b, 0.25).filter((e) => e.kind === 'antenna')).toHaveLength(1);
  });

  it('an antenna never gives a ball more than it brought: the rod only gives back what the ball put into it', () => {
    for (const kmh of [30, 60, 100])
      for (const above of [0.1, 0.3, 0.45, 0.6, 0.78])
        for (const off of [-0.01, -0.005, 0, 0.005, 0.01]) {
          const b = atRod(kmh, above, off);
          const energy = () => 0.5 * (b.v.x ** 2 + b.v.y ** 2 + b.v.z ** 2) + BALL.gravity * b.p.y;
          const brought = energy();
          for (let t = 0; t < 0.3; t += DT) {
            stepBall(b, DT, env);
            expect(energy()).toBeLessThanOrEqual(brought * 1.001);
          }
        }
  });

  it('a hard spike met dead on is not thrown straight up by the rod: the rod is light up and down as well as across', () => {
    // the rod keeps its length, so bent far it comes down: pushed up or down there it bends, it is not a
    // ramp as heavy as the floor (that threw a 100 km/h spike up at 23 m/s)
    for (const kmh of [100, 120])
      for (const above of [0.25, 0.4, 0.45, 0.5])
        for (const off of [-0.002, -0.001, 0, 0.001, 0.002]) {
          const b = atRod(kmh, above, off);
          let rise = 0;
          for (let t = 0; t < 0.3; t += DT) {
            stepBall(b, DT, env);
            rise = Math.max(rise, b.v.y);
          }
          expect(rise).toBeLessThan(0.5 * kmh * KMH);
        }
  });

  it('the rod and the net settle on their own, whatever the ball does: they do not freeze bent when it lies still', () => {
    const b = atRod(60, 0.3, 0.03);
    run(b, 0.1);
    expect(b.ant.some((v) => v !== 0)).toBe(true);
    // the ball has come to rest somewhere
    b.rest = true;
    run(b, 10);
    expect(b.ant.every((v) => v === 0)).toBe(true);
  });

  it('a planner that flies one shot after another meets a still net each time, not the shake of the shot before', () => {
    const fresh = atRod(60, 0.3, 0.06);
    run(fresh, 0.3);
    // the same ball flown first into the rod, then reused for the same shot
    const reused = atRod(100, 0.4, 0);
    run(reused, 0.05);
    const again = atRod(60, 0.3, 0.06);
    Object.assign(reused.p, again.p);
    Object.assign(reused.v, again.v);
    Object.assign(reused.w, again.w);
    stillNet(reused);
    run(reused, 0.3);
    expect(reused.p).toEqual(fresh.p);
    expect(reused.v).toEqual(fresh.v);
  });
});
