import { describe, expect, it } from 'vitest';
import { GRAPHICS_LEVEL_IDS, GRAPHICS_SETTINGS, QUALITY } from '../src/config';
import { QualityGovernor } from '../src/app/quality';

// The picture gets cheaper when the machine cannot keep up, so the play never does: a slow frame
// costs timing, a soft edge does not. And it gets richer again when the machine can: a phone that
// had one slow moment should not play soft for the rest of the session.

const L = (id: (typeof GRAPHICS_LEVEL_IDS)[number]) => GRAPHICS_LEVEL_IDS.indexOf(id);
/** where Auto starts, and the richest level it picks */
const TOP = L(QUALITY.autoTop);

/** a machine: the frame rate it draws at each level (cheapest first) */
type Machine = (level: number) => number;
const steady =
  (fps: number): Machine =>
  () =>
    fps;

/** run `seconds` of frames on `machine` and return every level the governor changed to */
function run(g: QualityGovernor, machine: Machine, seconds: number): number[] {
  const asked: number[] = [];
  for (let t = 0; t < seconds;) {
    const dt = 1 / machine(g.level);
    t += dt;
    const next = g.frame(dt);
    if (next !== null) asked.push(next);
  }
  return asked;
}

/** seconds for the start-up hold and `n` whole windows after it */
const windows = (n: number) => QUALITY.window * (Math.ceil(QUALITY.startCooldown / QUALITY.window) + n);

describe('the quality governor (Graphics: Auto)', () => {
  it('starts at High, the level phones and laptops had before there was a setting, and never climbs past it', () => {
    expect(QUALITY.autoTop).toBe('high');
    const g = new QualityGovernor();
    expect(g.level).toBe(L('high'));
    // Very high (a phone's own pixels) is the player's pick: a climb that turns out slow costs a rally
    expect(run(g, steady(120), 1200)).toEqual([]);
  });

  it('climbs back after a long run of fast windows (a phone that had one slow moment)', () => {
    const g = new QualityGovernor();
    // a hot phone: slow at High for a while
    expect(run(g, (l) => (l >= TOP ? 30 : 55), windows(QUALITY.slowWindows))).toEqual([TOP - 1]);
    // cooled down: back up after the run of fast windows (and the hold after the step down), not before
    let back = 0;
    while (g.level < TOP && back < 600) {
      run(g, steady(60), 1);
      back++;
    }
    const run40 = QUALITY.window * QUALITY.upWindows;
    expect(back).toBeGreaterThanOrEqual(run40);
    expect(back).toBeLessThanOrEqual(run40 + QUALITY.changeCooldown + 2 * QUALITY.window);
    expect(run(g, steady(60), 600)).toEqual([]);
  });

  it('steps down one level after two slow windows in a row', () => {
    const g = new QualityGovernor();
    // the first windows fall in the start-up hold (loading costs frames): they do not count
    const machine: Machine = (l) => (l >= L('high') ? 30 : 55);
    expect(run(g, machine, windows(QUALITY.slowWindows))).toEqual([L('medium')]);
  });

  it('starts the count again when a fast window comes between two slow ones', () => {
    const g = new QualityGovernor();
    run(g, steady(55), windows(0));
    for (let i = 0; i < 4; i++) {
      expect(run(g, steady(30), QUALITY.window)).toEqual([]);
      expect(run(g, steady(55), QUALITY.window)).toEqual([]);
    }
    expect(g.level).toBe(TOP);
  });

  it('leaves a level alone right after a change: the change itself costs frames', () => {
    const g = new QualityGovernor();
    const machine: Machine = (l) => (l >= L('high') ? 30 : 40);
    expect(run(g, machine, windows(QUALITY.slowWindows))).toEqual([L('medium')]);
    // slow for less than the hold and the windows it then needs: no second step
    expect(run(g, machine, QUALITY.changeCooldown)).toEqual([]);
    expect(g.level).toBe(L('medium'));
  });

  it('keeps stepping down while each step helps, and stops at Very low', () => {
    const g = new QualityGovernor();
    const machine: Machine = (l) => 20 + 6 * (TOP - l);
    expect(run(g, machine, 120)).toEqual([L('medium'), L('low'), L('veryLow')]);
    expect(run(g, machine, 120)).toEqual([]);
    expect(g.level).toBe(L('veryLow'));
  });

  it('a phone capped at 30 fps (low power mode) keeps its picture: a cheaper one did not help', () => {
    const g = new QualityGovernor();
    // one step down to find out, then back, and never again
    expect(run(g, steady(30), 600)).toEqual([L('medium'), TOP]);
    expect(g.cap).toBeCloseTo(30, 0);
    // a real drop under the cap still steps down
    const sinks: Machine = (l) => (l >= TOP ? 22 : 30);
    expect(run(g, sinks, 30)).toEqual([L('medium')]);
  });

  it('forgets the cap when the frame rate comes back (low power mode off)', () => {
    const g = new QualityGovernor();
    run(g, steady(30), 60);
    expect(g.cap).not.toBeNull();
    expect(run(g, steady(60), 10)).toEqual([]);
    expect(g.cap).toBeNull();
  });

  it('a constant frame rate between slow and fast never moves it', () => {
    const g = new QualityGovernor();
    expect(run(g, steady((QUALITY.slowFps + QUALITY.fastFps) / 2), 1200)).toEqual([]);
  });

  it('never flickers on the edge between two levels: each failed climb waits twice as long', () => {
    // fast at Medium, slow at High: it tries High, finds it slow, and tries less and less often
    const g = new QualityGovernor();
    const machine: Machine = (l) => (l === TOP ? 42 : 60);
    run(g, machine, windows(QUALITY.slowWindows));
    expect(g.level).toBe(TOP - 1);
    const ups: number[] = [];
    let atTop = 0;
    const minutes = 20;
    for (let s = 0; s < minutes * 60; s++) {
      const before = g.level;
      run(g, machine, 1);
      if (g.level === TOP && before !== TOP) ups.push(s);
      if (g.level === TOP) atTop++;
    }
    expect(ups.length).toBeGreaterThan(1);
    expect(ups.length).toBeLessThanOrEqual(6);
    const gaps = ups.slice(1).map((t, i) => t - ups[i]);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThanOrEqual(gaps[i - 1] - 2 * QUALITY.window);
    // the slow level is tried, not played: under 5% of the time
    expect(atTop / (minutes * 60)).toBeLessThan(0.05);
    expect(g.level).toBe(TOP - 1);
  });

  it('a level the player fixed turns it off', () => {
    const g = new QualityGovernor();
    g.fix(L('veryHigh'));
    expect(run(g, steady(20), 120)).toEqual([]);
    expect(g.level).toBe(L('veryHigh'));
    // back to Auto: it starts again from High, with nothing learned
    g.start();
    expect(g.level).toBe(TOP);

    expect(g.auto).toBe(true);
  });
});

describe('the graphics levels', () => {
  const levels = GRAPHICS_LEVEL_IDS.map((id) => QUALITY.levels[id]);

  it('the setting offers Auto and every level, cheapest first, each with its own label', () => {
    expect(GRAPHICS_SETTINGS).toEqual(['auto', ...GRAPHICS_LEVEL_IDS]);
    expect(new Set(levels.map((q) => q.label)).size).toBe(levels.length);
  });

  it('each level draws at least as much as the one below it, and something more', () => {
    for (let i = 1; i < levels.length; i++) {
      const [a, b] = [levels[i - 1], levels[i]];
      expect(b.pixelRatio).toBeGreaterThanOrEqual(a.pixelRatio);
      expect(b.msaa).toBeGreaterThanOrEqual(a.msaa);
      expect(b.shadowMap).toBeGreaterThanOrEqual(a.shadowMap);
      expect(b.mirror).toBeGreaterThanOrEqual(a.mirror);
      expect({ ...b, label: '' }).not.toEqual({ ...a, label: '' });
    }
  });

  it('every level draws the court lines: MSAA stays on (without it a 5 cm line far away drops out)', () => {
    for (const q of levels) expect(q.msaa).toBeGreaterThan(0);
  });

  it('every number is one a phone GPU can draw', () => {
    for (const q of levels) {
      // a phone screen has 3 pixels per CSS pixel; under half a pixel the court is mush
      expect(q.pixelRatio).toBeGreaterThanOrEqual(0.5);
      expect(q.pixelRatio).toBeLessThanOrEqual(3);
      expect([0, 4]).toContain(q.msaa);
      // a power of two every WebGL 2 phone can hold (MAX_TEXTURE_SIZE is at least 4096 there)
      expect(Math.log2(q.shadowMap) % 1).toBe(0);
      expect(q.shadowMap).toBeGreaterThanOrEqual(512);
      expect(q.shadowMap).toBeLessThanOrEqual(4096);
      expect(q.mirror).toBeGreaterThanOrEqual(0);
      expect(q.mirror).toBeLessThanOrEqual(1);
    }
  });
});
