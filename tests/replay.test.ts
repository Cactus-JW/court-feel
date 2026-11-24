import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Athlete } from '../src/game/athlete';
import { AthleteView } from '../src/character/athleteView';
import { makeKit } from '../src/character/kits';
import { FX } from '../src/config';
import { Replay } from '../src/fx/replay';
import { headlessGame } from './headlessGame';

const DT = 1 / 60;

function makeView(x: number): AthleteView {
  const a = new Athlete('OH', 1);
  a.place(x, 1, 0);
  a.interpolate(1);
  const v = new AthleteView(a, makeKit(0, false, 1));
  v.update(DT, 0);
  return v;
}

/** play the replay forward until its cursor reaches `t` (or it ends); false once it ended */
function advanceTo(r: Replay, ball: THREE.Object3D, t: number): boolean {
  while (r.playing && r.cursor < t) if (!r.advance(DT, ball)) return false;
  return r.playing;
}

describe('replay', () => {
  /**
   * A drill that spawns athletes after it started (the spike drill's block, key B): the
   * replay must record and pose them too, not leave them frozen where they stand live.
   */
  function recordWithLateBlocker() {
    const r = new Replay(4);
    const ball = new THREE.Object3D();
    const me = makeView(-3);
    r.setViews([me]);
    let t = 0;
    for (; t < 1 - 1e-9; t += DT) {
      me.root.position.x = -3 + t;
      r.record(t, ball, true);
    }
    // the block is turned on: a new athlete mid-recording
    const blocker = makeView(0);
    r.addView(blocker);
    r.addView(blocker); // twice is a no-op
    const spawnT = t;
    for (; t < 2 - 1e-9; t += DT) {
      me.root.position.x = -3 + t;
      blocker.root.position.set(t - spawnT, 0.5 * Math.sin((t - spawnT) * 3), -0.5);
      r.record(t, ball, true);
    }
    // the live scene has moved on by the time the replay is watched
    blocker.root.position.set(9, 0, 9);
    me.root.position.set(9, 0, 9);
    return { r, ball, me, blocker, spawnT };
  }

  it('records an athlete added while recording, and poses it where it was', () => {
    const { r, ball, me, blocker, spawnT } = recordWithLateBlocker();
    expect(r.views).toEqual([me, blocker]);
    expect(r.start(spawnT + 0.1, 1.9)).toBe(true);
    for (const c of [spawnT + 0.2, spawnT + 0.45, spawnT + 0.8]) {
      expect(advanceTo(r, ball, c)).toBe(true);
      const k = r.cursor - spawnT;
      expect(blocker.root.visible).toBe(true);
      expect(blocker.root.position.x).toBeCloseTo(k, 1);
      expect(blocker.root.position.y).toBeCloseTo(0.5 * Math.sin(k * 3), 1);
      expect(blocker.root.position.z).toBeCloseTo(-0.5, 3);
      expect(me.root.position.x).toBeCloseTo(-3 + r.cursor, 1);
    }
  });

  it('hides an athlete for the part of the recording from before it was there, and shows it again after', () => {
    const { r, ball, blocker, spawnT } = recordWithLateBlocker();
    expect(r.start(0.3, 1.9)).toBe(true);
    expect(advanceTo(r, ball, 0.6)).toBe(true);
    expect(blocker.root.visible).toBe(false);
    // its pose is left alone (no stale or empty slot data)
    const q = blocker.rig.bones.handR.quaternion;
    expect(Math.abs(q.lengthSq() - 1)).toBeLessThan(1e-4);
    expect(advanceTo(r, ball, spawnT + 0.1)).toBe(true);
    expect(blocker.root.visible).toBe(true);
    expect(advanceTo(r, ball, 99)).toBe(false);
    expect(blocker.root.visible).toBe(true);
  });

  it('a replay stopped (skipped) or reset while it hides an athlete gives it back to the live scene', () => {
    const { r, ball, me, blocker } = recordWithLateBlocker();
    r.start(0.3, 1.9);
    advanceTo(r, ball, 0.6);
    expect(blocker.root.visible).toBe(false);
    r.stop();
    expect(blocker.root.visible).toBe(true);
    r.start(0.3, 1.9);
    advanceTo(r, ball, 0.6);
    expect(blocker.root.visible).toBe(false);
    r.setViews([me]);
    expect(r.playing).toBe(false);
    expect(blocker.root.visible).toBe(true);
  });
});

describe('the whole point (R held)', () => {
  /** a second of play with nothing but a ball, recorded at 60 frames a second */
  function recorded(seconds: number) {
    const r = new Replay(seconds + 1);
    const ball = new THREE.Object3D();
    r.setViews([]);
    for (let t = 0; t < seconds; t += DT) {
      ball.position.set(0, 1, t);
      r.record(t, ball, true);
    }
    return { r, ball };
  }

  it('plays at real speed between the touches and slows to the replay speed at each of them, as TV does', () => {
    const { r } = recorded(10);
    expect(r.start(0, 9.9, [2, 6])).toBe(true);
    const P = FX.replayPoint;
    // on the touch, and just around it: slow
    expect(r.speedAt(2)).toBeCloseTo(FX.replaySlow, 6);
    expect(r.speedAt(6 - P.slowHold)).toBeCloseTo(FX.replaySlow, 6);
    // between them: real speed
    expect(r.speedAt(4)).toBeCloseTo(1, 6);
    expect(r.speedAt(2 + P.slowHold + P.slowRamp)).toBeCloseTo(1, 6);
    // and it eases from one to the other, never jumping
    let last = r.speedAt(2);
    for (let t = 2; t <= 4; t += 0.01) {
      const s = r.speedAt(t);
      expect(s).toBeGreaterThanOrEqual(last - 1e-9);
      expect(s - last).toBeLessThan(0.05);
      last = s;
    }
  });

  it('a replay without touches to slow for (the last attempt) is slow all the way', () => {
    const { r } = recorded(4);
    expect(r.start(0.5, 3.5)).toBe(true);
    for (const t of [0.5, 1.7, 3.4]) expect(r.speedAt(t)).toBe(FX.replaySlow);
  });

  it('with slow-mo off a replay plays at real speed, the hits and the last attempt too', () => {
    const { r } = recorded(10);
    r.realSpeed = true;
    expect(r.start(0, 9.9, [2, 6])).toBe(true);
    for (const t of [2, 4, 6]) expect(r.speedAt(t)).toBe(1);
    expect(r.start(0.5, 3.5)).toBe(true);
    expect(r.speedAt(1.7)).toBe(1);
  });

  it('a 25 s rally and its serve fit in the buffer (a rally ends by itself at 25 s)', () => {
    const r = new Replay(FX.replaySeconds);
    expect(r.seconds).toBeGreaterThanOrEqual(25 + FX.replayPoint.pre + 2);
  });

  it('the buffer holds all its seconds on a 70 Hz display too (it keeps a frame every 1/70 s at most)', () => {
    const r = new Replay(FX.replaySeconds);
    const ball = new THREE.Object3D();
    r.setViews([]);
    // a display just under 70 Hz: every frame is kept
    const dt = 1 / 69.9;
    for (let t = 0; t < FX.replaySeconds + 5; t += dt) r.record(t, ball, true);
    expect(r.newestT - r.oldestT).toBeGreaterThanOrEqual(FX.replaySeconds - 2 * dt);
  });
});

describe('what else a replay plays back (the antennae, the net, where you looked)', () => {
  it('a channel is posed as it was recorded at the moment replayed, between frames too', () => {
    const r = new Replay(4);
    const ball = new THREE.Object3D();
    // something that swings, like an antenna the ball hit: two numbers a frame
    let live = [0, 0];
    const posed = [NaN, NaN];
    r.addChannel({
      size: 2,
      write: (o, i) => {
        o[i] = live[0];
        o[i + 1] = live[1];
      },
      read: (d, a, b, u) => {
        posed[0] = d[a] + (d[b] - d[a]) * u;
        posed[1] = d[a + 1] + (d[b + 1] - d[a + 1]) * u;
      },
    });
    r.setViews([]);
    const swing = (t: number) => [Math.sin(t * 9) * Math.exp(-t), t];
    for (let t = 0; t < 3; t += DT) {
      live = swing(t);
      r.record(t, ball, true);
    }
    // the live scene has settled by the time the replay is watched
    live = [0, 0];
    expect(r.start(0.5, 2.9)).toBe(true);
    for (const c of [0.8, 1.234, 2.5]) {
      expect(advanceTo(r, ball, c)).toBe(true);
      const want = swing(r.cursor);
      expect(posed[1]).toBeCloseTo(want[1], 2);
      expect(posed[0]).toBeCloseTo(want[0], 1);
    }
  });
});

describe('the Mini Rally point', () => {
  it("starts with the serve's toss, and is still the last point once the rally is over", () => {
    const h = headlessGame('rally', 'OH');
    expect(h.mode.pointStart()).toBeNull();
    let toss: number | null = null;
    for (let i = 0; i < 60 * 20 && toss === null; i++) {
      h.frame();
      toss = h.mode.pointStart();
    }
    expect(toss).not.toBeNull();
    // the toss is the first flight of the point: nothing else had launched the ball since the serve was called
    expect(toss!).toBeLessThanOrEqual(h.sim.ball.lastLaunchT);
    expect(h.sim.simTime - toss!).toBeLessThan(0.1);
    // the point plays on and ends: until the next toss it is the point just played
    const outcomes = h.outcomes.length;
    for (let i = 0; i < 60 * 30 && h.outcomes.length === outcomes; i++) h.frame();
    expect(h.outcomes.length).toBeGreaterThan(outcomes);
    expect(h.mode.pointStart()).toBe(toss);
  });
});
