import { describe, expect, it } from 'vitest';
import { GRAPHICS_LEVEL_IDS, GRAPHICS_SETTINGS, QUALITY } from '../src/config';
import { pixelRatioFor, QualityGovernor } from '../src/app/quality';

// The picture gets cheaper when the machine cannot keep up, so the play never does: a slow frame
// costs timing, a soft edge does not. And it gets richer again when the machine can: a phone that
// had one slow moment should not play soft for the rest of the session.

const L = (id: (typeof GRAPHICS_LEVEL_IDS)[number]) => GRAPHICS_LEVEL_IDS.indexOf(id);
/** where Auto starts, and the richest level it climbs to under a frame-rate cap */
const TOP = L(QUALITY.autoTop);
/** the richest level Auto climbs to */
const CEILING = L(QUALITY.autoCeiling);

/** a machine: the frame rate it draws at each level (cheapest first) */
type Machine = (level: number) => number;
const steady =
  (fps: number): Machine =>
  () =>
    fps;

/**
 * run `seconds` of frames on `machine` and return every level the governor changed to. `calm`: the
 * frames are a menu, the pause or a dead ball (true), or play (false), or a function of the time
 */
function run(g: QualityGovernor, machine: Machine, seconds: number, calm: boolean | ((t: number) => boolean) = true): number[] {
  const asked: number[] = [];
  for (let t = 0; t < seconds;) {
    const dt = 1 / machine(g.level);
    t += dt;
    const next = g.frame(dt, typeof calm === 'function' ? calm(t) : calm);
    if (next !== null) asked.push(next);
  }
  return asked;
}

/** seconds for the start-up hold and `n` whole windows after it */
const windows = (n: number) => QUALITY.window * (Math.ceil(QUALITY.startCooldown / QUALITY.window) + n);

describe('the quality governor (Graphics: Auto)', () => {
  it('starts at High, the level phones and laptops had before there was a setting', () => {
    expect(QUALITY.autoTop).toBe('high');
    const g = new QualityGovernor();
    expect(g.level).toBe(L('high'));
  });

  it("a device that keeps up goes on to Very high (a phone's own pixels), and stays", () => {
    expect(QUALITY.autoCeiling).toBe('veryHigh');
    const g = new QualityGovernor();
    expect(run(g, steady(60), windows(QUALITY.upWindows) + 1)).toEqual([CEILING]);
    expect(run(g, steady(60), 1200)).toEqual([]);
    // a 120 Hz phone that draws its own pixels at 80 fps keeps them: 80 fps plays as well as 120
    const fast = new QualityGovernor();
    expect(run(fast, (l) => (l === CEILING ? 80 : 120), 1200)).toEqual([CEILING]);
  });

  it('never steps up in the middle of a rally: it waits for a calm moment (a dead ball, a menu, the pause)', () => {
    const g = new QualityGovernor();
    expect(run(g, steady(60), 600, false)).toEqual([]);
    expect(g.level).toBe(TOP);
    // the ball goes dead: up at once, the run of fast windows was already there
    expect(run(g, steady(60), 0.1, true)).toEqual([CEILING]);
    // rallies of 10 s with 3 s dead balls between them: every step up lands in a dead ball
    const h = new QualityGovernor();
    const machine: Machine = (l) => (l >= TOP ? 30 : 60);
    const dead = (t: number) => t % 13 > 10;
    let t0 = 0;
    for (let s = 0; s < 900; s++) {
      const before = h.level;
      run(h, machine, 1, (t) => dead(t0 + t));
      t0 += 1;
      if (h.level > before) expect(dead(t0)).toBe(true);
    }
  });

  it('a step up that turns out slow comes back after one window, and waits twice as long to try again', () => {
    // fast at High, slow at Very high (a laptop drawing a 3x phone screen: 33 fps, measured)
    const g = new QualityGovernor();
    const machine: Machine = (l) => (l === CEILING ? 33 : 60);
    for (let s = 0; g.level !== CEILING && s < 600; s++) run(g, machine, 0.1);
    expect(g.level).toBe(CEILING);
    let slowFor = 0;
    while (g.level === CEILING && slowFor < 60) {
      run(g, machine, 0.1);
      slowFor += 0.1;
    }
    expect(g.level).toBe(TOP);
    expect(slowFor).toBeLessThanOrEqual(QUALITY.probeCooldown + 2 * QUALITY.window + 0.2);
    // the next try waits for twice the run of fast windows
    expect(run(g, machine, QUALITY.window * QUALITY.upWindows * 1.5)).toEqual([]);
    expect(run(g, machine, QUALITY.window * QUALITY.upWindows)).toEqual([CEILING, TOP]);
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
    // and on to Very high after another run, then no further
    expect(run(g, steady(60), 600)).toEqual([CEILING]);
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
    // one step down to find out, then back, and never again: not on to Very high either (a capped
    // phone is saving power or heat, and 4 times the pixels would cost it both)
    expect(run(g, steady(30), 600)).toEqual([L('medium'), TOP]);
    expect(g.cap).toBeCloseTo(30, 0);
    // a real drop under the cap still steps down
    const sinks: Machine = (l) => (l >= TOP ? 22 : 30);
    expect(run(g, sinks, 30)).toEqual([L('medium')]);
  });

  it('forgets the cap when the frame rate comes back in play (low power mode off)', () => {
    const g = new QualityGovernor();
    run(g, steady(30), 60);
    expect(g.cap).not.toBeNull();
    expect(run(g, steady(60), 10, false)).toEqual([]);
    expect(g.cap).toBeNull();
  });

  it('a menu faster than play does not clear the cap (a phone whose processor is the limit)', () => {
    const g = new QualityGovernor();
    // play is held at 45 fps by the processor, whatever the picture
    run(g, steady(45), 60, false);
    expect(g.cap).toBeCloseTo(45, 0);
    // the menu runs at 60: the cap stays, so the next rally does not test a cheaper picture again
    run(g, steady(60), 20, true);
    expect(g.cap).toBeCloseTo(45, 0);
    expect(run(g, steady(45), 600, false)).toEqual([]);
  });

  it('climbs back under a cap: a phone that stepped down for a reason, then went into low power mode', () => {
    const g = new QualityGovernor();
    // a hot phone: High is too much
    expect(run(g, (l) => (l >= TOP ? 42 : 60), windows(QUALITY.slowWindows))).toEqual([L('medium')]);
    expect(run(g, steady(60), 10, false)).toEqual([]);
    // then low power mode: 30 fps on every level. A step down does not help, the cap is found
    expect(run(g, steady(30), 30, false)).toEqual([L('low'), L('medium')]);
    expect(g.cap).toBeCloseTo(30, 0);
    // High holds the same 30 fps: back to High after the run of windows that hold the cap, no further
    expect(run(g, steady(30), 600)).toEqual([TOP]);
  });

  it('under a cap, a step up that costs frames goes back (a phone whose processor holds it at 45)', () => {
    const g = new QualityGovernor();
    // Medium at 45 (its processor), High at 38: High is a step too far
    expect(run(g, (l) => (l >= TOP ? 38 : 45), windows(QUALITY.slowWindows) + 30, false)).toEqual([L('medium'), L('low'), L('medium')]);
    expect(g.cap).toBeCloseTo(45, 0);
    const asked = run(g, (l) => (l >= TOP ? 38 : 45), 1200);
    // it tries High now and then, and comes straight back each time
    expect(asked.filter((l) => l === TOP).length).toBeGreaterThan(0);
    expect(asked.filter((l) => l === TOP).length).toBeLessThanOrEqual(6);
    expect(g.level).toBe(L('medium'));
  });

  it('after a lost graphics context above High, Auto stays at High', () => {
    const g = new QualityGovernor();
    g.lostContext();
    expect(run(g, steady(60), 1200)).toEqual([]);
    expect(g.level).toBe(TOP);
    // picking Auto again does not forget it
    g.start();
    expect(run(g, steady(60), 1200)).toEqual([]);
  });

  it('a constant frame rate between slow and fast never moves it', () => {
    const g = new QualityGovernor();
    expect(run(g, steady((QUALITY.slowFps + QUALITY.fastFps) / 2), 1200)).toEqual([]);
  });

  it('never flickers on the edge between two levels: each failed climb waits twice as long', () => {
    // fast at Medium, slow at High: it tries High, finds it slow, and tries less and less often
    const g = new QualityGovernor();
    const machine: Machine = (l) => (l >= TOP ? 42 : 60);
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

describe('how many pixels a level draws', () => {
  const q = QUALITY.levels;

  it("Very high draws a phone's own pixels (844x390 at 3x is 2532x1170)", () => {
    expect(pixelRatioFor(q.veryHigh, 3, 844, 390)).toBe(3);
    expect(pixelRatioFor(q.veryHigh, 3, 932, 430)).toBe(3);
  });

  it('no level draws more pixels than the screen has', () => {
    for (const id of GRAPHICS_LEVEL_IDS) expect(pixelRatioFor(q[id], 1, 1280, 720)).toBeLessThanOrEqual(1);
    expect(pixelRatioFor(q.high, 1.25, 1536, 864)).toBe(1.25);
  });

  it('no level draws a buffer over a 4K frame (a desktop at 2x with a large window)', () => {
    const r = pixelRatioFor(q.veryHigh, 2, 2560, 1440);
    expect(r).toBeLessThan(2);
    expect(2560 * r * 1440 * r).toBeLessThanOrEqual(QUALITY.maxPixels + 1);
    // High on a 1080p screen is untouched
    expect(pixelRatioFor(q.high, 1, 1920, 1080)).toBe(1);
  });
});
