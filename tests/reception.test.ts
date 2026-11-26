import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CONTACT, COURT, PLAYER, TIMING } from '../src/config';
import { lerp } from '../src/core/mathx';
import type { Brain } from '../src/game/brains';
import { serveAim } from '../src/ai/server';
import { Rng } from '../src/core/mathx';
import { DT, scene } from './scene';

const TARGET = { x: 1, y: 2.35, z: 0.9, apex: 4 };

/**
 * A home passer at the end of their court takes a ball from the other side at `speed` m/s,
 * the platform out `lead` s before it arrives (the ideal lead for that speed by default).
 * Returns the contact and how far from the setter's target the pass was aimed.
 */
function receive(speed: number, opts: { lead?: number; rand?: number; moving?: number; spikeBy?: 'user' | 'ai' } = {}) {
  // fixed dice: every roll comes up `rand` (a half when not given), so the pass is graded on the timing and
  // the form alone, with the spread of the dice taken out, and a test says which side of a chance it falls
  const s = scene({ dice: { roll: opts.rand ?? 0.5 }, drill: { passTarget: () => TARGET } });
  const { sim } = s;
  const a = s.athlete('L', 1, { x: 0.5, z: 7.5 });
  // a passer still moving is shuffling along the end line at that much of a full run, and keeps going
  const run = (opts.moving ?? 0) * a.stats.approachSpeed;
  a.vel.set(run, 0, 0);
  // the ball comes over the net from 9 m away and arrives at T at the platform, where the passer is by then
  const T = 9 / speed;
  const P = sim.contact.platformPoint(a, new THREE.Vector3());
  P.x += run * T;
  const from = { x: P.x, y: 3.3, z: P.z - 9 };
  // (whoever spiked it stands where it was hit from; your spike is your seat's athlete's)
  const hitter = opts.spikeBy ? s.athlete('OH', -1, { x: from.x, z: from.z }, { user: opts.spikeBy === 'user' }) : null;
  s.send({ from, to: { x: P.x, y: P.y, z: P.z }, time: T }, hitter ? { athlete: hitter, kind: 'spike', side: -1 } : undefined);
  const fast = Math.min(1, Math.max(0, (speed - 12) / 10));
  const lead = opts.lead ?? lerp(TIMING.passLead, TIMING.digLead, fast);
  // a step moves the clock first and the ball last: a brain sees the ball arrive at T + DT on the clock it reads
  const press = sim.simTime + DT + T - lead;
  let pressed = false;
  // the passer's brain: it holds the run, puts the platform out on time, and plays the ball as every
  // AI brain does (the contact system is asked each step, before the bodies and the ball move)
  const passer: Brain = {
    athlete: a,
    step: (_dt, g) => {
      if (opts.moving) {
        a.cmd.moveX = opts.moving / PLAYER.sideScale;
        a.cmd.sprint = true;
      }
      if (!pressed && g.simTime >= press - 1e-9) {
        pressed = true;
        a.startAction('pass', g.simTime);
      }
      if (a.action?.kind === 'pass' && !a.action.resolved) g.contact.tryPass(a, a.action);
    },
  };
  sim.setBrain(a, passer);
  s.run(2, () => s.touches.length > 0);
  const e = s.touches[0]?.ev;
  return { e, off: e ? Math.hypot(e.target.x - TARGET.x, e.target.z - TARGET.z) : NaN, v: { ...sim.ball.vel }, vIn: speed };
}

describe('serve reception (contact)', () => {
  it('the same well-timed platform passes a fast jump serve less accurately than a slow float', () => {
    const float = receive(13);
    const jump = receive(24);
    expect(float.e.grade).toBe('Perfect');
    expect(jump.e.grade).toBe('Perfect');
    expect(jump.off).toBeGreaterThan(float.off * 1.8);
  });

  it('a passer still moving when the ball arrives passes it less accurately than one who is set', () => {
    const set = receive(15);
    const moving = receive(15, { moving: 0.8 });
    expect(moving.off).toBeGreaterThan(set.off * 1.4);
  });

  it('a hard-driven ball off a mistimed platform can be shanked; a slow one never is', () => {
    const lateHard = receive(25, { lead: 0.02, rand: 0.05 });
    expect(lateHard.e.note).toBe('Shanked');
    const lateSlow = receive(10, { lead: 0.02, rand: 0.05 });
    expect(lateSlow.e.note).not.toBe('Shanked');
  });

  it('a well-timed platform is not shanked even on the hardest ball', () => {
    const r = receive(26, { rand: 0.05 });
    expect(r.e.note).not.toBe('Shanked');
  });

  it("an AI defender who gets to your hard spike shanks it half the time, well timed or not (playability); an AI hitter's is dug", () => {
    // (the harness's random draw is fixed: under the user-spike shank chance)
    const rand = CONTACT.userSpikeShank * 0.6;
    const yours = receive(24, { rand, spikeBy: 'user' });
    const theirs = receive(24, { rand, spikeBy: 'ai' });
    expect(yours.e.note).toBe('Shanked');
    expect(theirs.e.note).not.toBe('Shanked');
    // a slow ball of yours (a roll shot, an easy swing) is played as usual
    expect(receive(12, { rand, spikeBy: 'user' }).e.note).not.toBe('Shanked');
  });

  it('a shank keeps going the way the spike came, at most 100 degrees off its line, up and off the arms', () => {
    for (const rand of [0.02, 0.3, 0.5, 0.7, 0.98]) {
      const r = receive(24, { rand: Math.min(rand, CONTACT.userSpikeShank * 0.99), spikeBy: 'user' });
      expect(r.e.note).toBe('Shanked');
      // the spike came in along +z (towards our end line)
      const ang = Math.atan2(r.v.x, r.v.z);
      expect(Math.abs(ang)).toBeLessThanOrEqual(CONTACT.shankTurn + 1e-6);
      expect(r.v.y).toBeGreaterThan(0);
    }
  });
});

describe('where the AI serves (Mini Rally)', () => {
  const passers = [
    { x: -3, z: 6 },
    { x: 0, z: 6.5 },
    { x: 3, z: 6 },
  ];

  it('always into their court, mostly at the seams and the deep corners', () => {
    const rng = new Rng(11);
    let hard = 0;
    const n = 400;
    for (let i = 0; i < n; i++) {
      const jump = i % 2 === 0;
      const p = serveAim(passers, -1, rng, jump);
      expect(Math.abs(p.x)).toBeLessThan(COURT.halfWidth);
      expect(p.z).toBeLessThan(0);
      expect(-p.z).toBeLessThan(COURT.halfLength);
      // a seam (between two passers) or deep (behind them)
      const seam = [-1.5, 1.5].some((sx) => Math.abs(p.x - sx) < 1.0);
      if (seam || -p.z > 7) hard++;
    }
    expect(hard / n).toBeGreaterThan(0.5);
  });

  it('a jump serve never goes short; a float sometimes does', () => {
    const rng = new Rng(3);
    let floatShort = 0;
    for (let i = 0; i < 400; i++) {
      // short = in front of the passers, inside 4.5 m of the net, with no spread pulling it back
      const j = serveAim(passers, -1, rng, true);
      expect(-j.z).toBeGreaterThan(2.5 - 1e-9);
      const f = serveAim(passers, -1, rng, false);
      if (-f.z < 4.5) floatShort++;
    }
    expect(floatShort).toBeGreaterThan(10);
  });
});
