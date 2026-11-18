import { describe, expect, it } from 'vitest';
import { BALL, DEFAULT_SETTINGS, SETTING_RANGES, SIM } from '../src/config';
import { sanitizeSettings } from '../src/app/settings';
import type { Rng } from '../src/core/mathx';
import { copyBall, makeBall, stepBall, type BallEnv, type BallState, type CollisionEvent, type V3 } from '../src/physics/ball';
import { COURT } from '../src/config';
import { BallPredictor } from '../src/physics/predict';
import { flyFor, solveApex } from '../src/physics/solve';
import { forAll } from './forAll';
import { brokenInvariants } from './invariants';
import { freeBallToATeam } from './simScenes';

// Property tests (tests/forAll.ts): each states a fact that must hold for every input and tries
// it on hundreds of seeded ones. They are here for the bugs nobody wrote a case for.

const DT = 1 / SIM.hz;
const env: BallEnv = { netTop: COURT.netHeightMen };

/** a ball anywhere over the court, hit in any direction at any speed a player can give it, with any spin */
function anyLaunch(rng: Rng, spin = 30): { p: V3; v: V3; w: V3 } {
  const speed = rng.range(3, 30);
  const heading = rng.range(0, Math.PI * 2);
  const climb = rng.range(-0.3, 1.3);
  return {
    p: { x: rng.range(-4, 4), y: rng.range(0.6, 3.5), z: rng.range(-8, 8) },
    v: { x: Math.cos(heading) * Math.cos(climb) * speed, y: Math.sin(climb) * speed, z: Math.sin(heading) * Math.cos(climb) * speed },
    w: { x: rng.range(-spin, spin), y: rng.range(-spin, spin), z: rng.range(-spin, spin) },
  };
}

function ballOf(l: { p: V3; v: V3; w: V3 }): BallState {
  const b = makeBall();
  Object.assign(b.p, l.p);
  Object.assign(b.v, l.v);
  Object.assign(b.w, l.w);
  return b;
}

const energy = (b: BallState): number => 0.5 * (b.v.x * b.v.x + b.v.y * b.v.y + b.v.z * b.v.z) + BALL.gravity * b.p.y;

describe('the ball, for any launch', () => {
  it('lands where the predictor says it will, at the moment it says', () => {
    forAll(
      400,
      11,
      (rng) => anyLaunch(rng),
      (launch) => {
        const pred = new BallPredictor(DT, SIM.predictHorizon);
        pred.compute(ballOf(launch), env, 0);
        const b = ballOf(launch);
        const events: CollisionEvent[] = [];
        let landed = -1;
        const spot = { x: 0, z: 0 };
        for (let i = 1; i <= Math.round(SIM.predictHorizon / DT) && landed < 0; i++) {
          events.length = 0;
          stepBall(b, DT, env, events);
          const floor = events.find((e) => e.kind === 'floor');
          if (floor) {
            landed = i * DT;
            spot.x = floor.x;
            spot.z = floor.z;
          }
        }
        if (pred.landT < 0) {
          // the predictor sees no landing inside its horizon: neither does the simulation, short of the last step
          expect(landed < 0 || landed > SIM.predictHorizon - 2 * DT).toBe(true);
          return;
        }
        expect(Math.abs(pred.landT - landed)).toBeLessThan(DT * 1.01);
        expect(Math.hypot(pred.land.x - spot.x, pred.land.z - spot.z)).toBeLessThan(1e-6);
      },
    );
  });

  it('never sinks into the floor and never stops being a number', () => {
    forAll(
      400,
      12,
      (rng) => anyLaunch(rng),
      (launch) => {
        const b = ballOf(launch);
        for (let i = 0; i < 4 / DT; i++) {
          stepBall(b, DT, env);
          for (const v of [b.p.x, b.p.y, b.p.z, b.v.x, b.v.y, b.v.z]) expect(Number.isFinite(v)).toBe(true);
          expect(b.p.y).toBeGreaterThan(BALL.radius - 1e-6);
        }
      },
    );
  });

  it('flies the mirrored path when it is launched mirrored: the court has no left or right', () => {
    forAll(
      200,
      13,
      (rng) => anyLaunch(rng),
      (launch) => {
        const a = ballOf(launch);
        // a mirror in x turns the velocity's x and, spin being an axial vector, the spin's y and z
        const b = ballOf({
          p: { x: -launch.p.x, y: launch.p.y, z: launch.p.z },
          v: { x: -launch.v.x, y: launch.v.y, z: launch.v.z },
          w: { x: launch.w.x, y: -launch.w.y, z: -launch.w.z },
        });
        for (let i = 0; i < 3 / DT; i++) {
          stepBall(a, DT, env);
          stepBall(b, DT, env);
          expect(Math.abs(a.p.x + b.p.x)).toBeLessThan(1e-7);
          expect(Math.abs(a.p.y - b.p.y)).toBeLessThan(1e-7);
          expect(Math.abs(a.p.z - b.p.z)).toBeLessThan(1e-7);
        }
      },
    );
  });

  it('never gains energy in free flight when it has no spin: the air only takes', () => {
    forAll(
      300,
      14,
      (rng) => anyLaunch(rng, 0),
      (launch) => {
        const b = ballOf(launch);
        const before = makeBall();
        const events: CollisionEvent[] = [];
        for (let i = 0; i < 3 / DT; i++) {
          copyBall(b, before);
          events.length = 0;
          stepBall(b, DT, env, events);
          if (events.length || b.rest) break;
          expect(energy(b)).toBeLessThanOrEqual(energy(before) + 1e-9);
        }
      },
    );
  });
});

describe('a set, for any target the setter can reach', () => {
  it('comes down at the target it was solved for', () => {
    forAll(
      300,
      21,
      (rng) => {
        const from = { x: rng.range(-4, 4), y: rng.range(1.8, 2.8), z: rng.range(0.5, 8) };
        const to = { x: rng.range(-4.2, 4.2), y: rng.range(2.6, 3.4), z: rng.range(0.4, 6) };
        return { from, to, apex: Math.max(from.y, to.y) + rng.range(0.4, 4) };
      },
      ({ from, to, apex }) => {
        const v = { x: 0, y: 0, z: 0 };
        const spin = { x: 0, y: 0, z: 0 };
        const { T } = solveApex(from, to, apex, spin, v);
        expect(Number.isFinite(T) && T > 0).toBe(true);
        const at = { x: 0, y: 0, z: 0 };
        flyFor(from, v, spin, T, at);
        expect(Math.hypot(at.x - to.x, at.y - to.y, at.z - to.z)).toBeLessThan(0.05);
      },
    );
  });
});

describe('stored settings, for anything that could be in the browser', () => {
  const junk = (rng: Rng): unknown =>
    rng.pick([NaN, Infinity, -1e9, 1e9, rng.range(-5, 5), 'yes', '', null, undefined, true, false, [], {}, { x: 1 }]);

  it('come out valid, inside their ranges, and unchanged by a second check', () => {
    forAll(
      500,
      31,
      (rng) => {
        const raw: Record<string, unknown> = {};
        for (const key of Object.keys(DEFAULT_SETTINGS)) if (rng.next() < 0.7) raw[key] = junk(rng);
        raw[`extra${Math.floor(rng.range(0, 9))}`] = junk(rng);
        return rng.next() < 0.05 ? junk(rng) : raw;
      },
      (raw) => {
        const once = sanitizeSettings(raw);
        expect(sanitizeSettings(JSON.parse(JSON.stringify(once)))).toEqual(once);
        expect(Object.keys(once).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
        for (const [key, range] of Object.entries(SETTING_RANGES)) {
          const v = once[key as keyof typeof once] as number;
          expect(v, key).toBeGreaterThanOrEqual(range.min);
          expect(v, key).toBeLessThanOrEqual(range.max);
        }
      },
    );
  });
});

describe('a rally in the simulation, for any seed', () => {
  it('keeps every invariant at every step, and plays the same twice', () => {
    forAll(
      12,
      41,
      (rng) => Math.floor(rng.range(1, 1e6)),
      (seed) => {
        const run = (): number[] => {
          const { sim } = freeBallToATeam(seed);
          const path: number[] = [];
          for (let i = 0; i < 6 / DT; i++) {
            const before = sim.simTime;
            sim.step(DT);
            expect(brokenInvariants(sim, before, DT)).toEqual([]);
            path.push(sim.ball.state.p.x, sim.ball.state.p.y, sim.ball.state.p.z);
            for (const a of sim.athletes) path.push(a.pos.x, a.pos.z);
          }
          return path;
        };
        expect(run()).toEqual(run());
      },
    );
  });
});
