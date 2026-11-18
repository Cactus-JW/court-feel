import { describe, expect, it } from 'vitest';
import { ASSIST, TUTORIAL } from '../src/config';
import { damp, lerp } from '../src/core/mathx';
import { Pace, slowTarget, type PaceFacts } from '../src/app/pace';
import { forAll } from './forAll';

// How fast the play runs: every slow-down the game has, in one place. A shared session has none of
// them (docs/adr/0011), so what is tested here is also the list of what a host has to leave out.

const FRAME = 1 / 60;
const PLAIN: PaceFacts = { wheelOpen: false, swing: null, set: null, lesson: { scale: 1, snap: false } };

/** the play a pace gives over `frames` frames of real time */
function played(pace: Pace, facts: PaceFacts, frames: number): number {
  let sim = 0;
  for (let i = 0; i < frames; i++) sim += pace.simSeconds(FRAME, facts);
  return sim;
}

describe('the pace of the play', () => {
  it('is the clock when nothing asks for slow time: a second of frames is a second of play', () => {
    expect(played(new Pace(), PLAIN, 60)).toBeCloseTo(1, 12);
  });

  it('holds still for a hit-stop exactly as long as it was asked, and gives none of it back', () => {
    const pace = new Pace();
    pace.hitStop = 0.05;
    expect(pace.simSeconds(FRAME, PLAIN)).toBe(0);
    expect(pace.simSeconds(FRAME, PLAIN)).toBe(0);
    expect(pace.simSeconds(FRAME, PLAIN)).toBe(0);
    // the frame the hold ends in plays what is left of it
    expect(pace.simSeconds(FRAME, PLAIN)).toBeCloseTo(4 * FRAME - 0.05, 12);
    expect(pace.hitStop).toBe(0);
    expect(played(pace, PLAIN, 56)).toBeCloseTo(56 * FRAME, 12);
  });

  it('slows for an open play wheel, and eases there: the play never jumps to a new speed', () => {
    const pace = new Pace();
    const wheel = { ...PLAIN, wheelOpen: true };
    const first = pace.simSeconds(FRAME, wheel) / FRAME;
    expect(first).toBeLessThan(1);
    expect(first).toBeGreaterThan(ASSIST.playWheelSlow);
    played(pace, wheel, 120);
    expect(pace.slowmo).toBeCloseTo(ASSIST.playWheelSlow, 6);
    // and it eases back when the wheel closes
    const back = pace.simSeconds(FRAME, PLAIN) / FRAME;
    expect(back).toBeGreaterThan(ASSIST.playWheelSlow);
    expect(back).toBeLessThan(1);
  });

  it('dips for a contact only inside its window, with the ball in reach and still to come', () => {
    expect(slowTarget({ ...PLAIN, swing: { until: ASSIST.slowmoWindow / 2, inReach: true } })).toBe(ASSIST.slowmoScale);
    expect(slowTarget({ ...PLAIN, swing: { until: ASSIST.slowmoWindow * 2, inReach: true } })).toBe(1);
    expect(slowTarget({ ...PLAIN, swing: { until: ASSIST.slowmoWindow / 2, inReach: false } })).toBe(1);
    expect(slowTarget({ ...PLAIN, swing: { until: -0.01, inReach: true } })).toBe(1);
  });

  it('slows a set more while the ball loads in the hands than on its way down to them', () => {
    const coming = slowTarget({ ...PLAIN, set: { until: ASSIST.setSlowmoWindow / 2, absorbing: false } });
    const loading = slowTarget({ ...PLAIN, set: { until: 0, absorbing: true } });
    expect(coming).toBe(ASSIST.setSlowmoCatch);
    expect(loading).toBe(ASSIST.setSlowmoLoad);
    expect(loading).toBeLessThan(coming);
    // a set still far above the hands is played at full speed
    expect(slowTarget({ ...PLAIN, set: { until: ASSIST.setSlowmoWindow * 2, absorbing: false } })).toBe(1);
  });

  it('takes a moment the lesson waits at at once, and eases into everything else the lesson asks', () => {
    const waits = new Pace();
    expect(waits.simSeconds(FRAME, { ...PLAIN, lesson: { scale: 0, snap: true } })).toBe(0);
    const eases = new Pace();
    const first = eases.simSeconds(FRAME, { ...PLAIN, lesson: { scale: 0.4, snap: false } }) / FRAME;
    expect(first).toBeLessThan(1);
    expect(first).toBeGreaterThan(0.4);
    // at the lesson's own rate, which is not the assists'
    expect(first).toBeCloseTo(lerp(1, 0.4, damp(TUTORIAL.clockEase, FRAME)), 12);
    expect(TUTORIAL.clockEase).not.toBe(ASSIST.slowmoEase);
  });

  it('runs at the slower of the assist and the lesson: the two never stack', () => {
    const pace = new Pace();
    const both = { ...PLAIN, wheelOpen: true, lesson: { scale: 0.5, snap: true } };
    played(pace, both, 200);
    expect(pace.simSeconds(FRAME, both) / FRAME).toBeCloseTo(Math.min(ASSIST.playWheelSlow, 0.5), 6);
  });

  it('never runs faster than the clock and never runs backwards, whatever is asked of it', () => {
    forAll(
      300,
      51,
      (rng) => ({
        hitStop: rng.next() < 0.3 ? rng.range(0, 0.2) : 0,
        frames: Array.from({ length: 40 }, () => ({
          dt: rng.range(0.001, 0.1),
          facts: {
            wheelOpen: rng.next() < 0.3,
            swing: rng.next() < 0.4 ? { until: rng.range(-0.2, 0.8), inReach: rng.next() < 0.7 } : null,
            set: rng.next() < 0.4 ? { until: rng.range(-0.2, 0.8), absorbing: rng.next() < 0.4 } : null,
            lesson: { scale: rng.next() < 0.5 ? 1 : rng.range(0, 1), snap: rng.next() < 0.3 },
          } satisfies PaceFacts,
        })),
      }),
      ({ hitStop, frames }) => {
        const pace = new Pace();
        pace.hitStop = hitStop;
        for (const { dt, facts } of frames) {
          const sim = pace.simSeconds(dt, facts);
          expect(sim).toBeGreaterThanOrEqual(0);
          expect(sim).toBeLessThanOrEqual(dt + 1e-12);
        }
      },
    );
  });
});
