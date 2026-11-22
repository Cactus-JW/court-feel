import { GRAPHICS_LEVEL_IDS, QUALITY, type QualityLevel } from '../config';

/** where Auto starts, the richest level it climbs to under a frame-rate cap: its index in GRAPHICS_LEVEL_IDS */
const START = GRAPHICS_LEVEL_IDS.indexOf(QUALITY.autoTop);
/** the richest level Auto ever climbs to */
const CEILING = GRAPHICS_LEVEL_IDS.indexOf(QUALITY.autoCeiling);

/**
 * Picks the graphics level when the Graphics setting is Auto. It only watches frame times and says
 * which level it wants; what a level means for the renderer is the game's to apply
 * (`Game.applyQuality`). The rules and their numbers are in `QUALITY`.
 */
export class QualityGovernor {
  /** index in GRAPHICS_LEVEL_IDS: 0 is the cheapest */
  level: number = START;
  /** false: the player fixed a level, and the governor leaves it */
  auto = true;
  /** the richest level it may climb to (lowered to `QUALITY.autoTop` after a lost graphics context) */
  ceiling: number = CEILING;
  private acc = 0;
  private frames = 0;
  /** frames of this window drawn in a calm moment */
  private calmFrames = 0;
  private cooldown: number = QUALITY.startCooldown;
  private slow = 0;
  private fast = 0;
  /** fast windows in a row a step up waits for (doubled by each step up that fails) */
  private upWait: number = QUALITY.upWindows;
  /** windows since the last step up */
  private sinceUp = Infinity;
  /** the last window's frame rate */
  private lastFps = 0;
  /** the last step down, until its first window says whether it helped */
  private check: { from: number; fps: number } | null = null;
  /** the last step up, until its first window says whether it held the frame rate it had */
  private probe: { fps: number } | null = null;
  /** a frame rate a cheaper picture did not raise (null: none found) */
  cap: number | null = null;

  /**
   * note a frame of `dt` real seconds: the level to change to, or null to stay. `calm`: nothing
   * the player times hangs on this frame (a menu, the pause, a replay, a dead ball). Only then
   * does it step up: a step up resizes the picture, and may turn out slow.
   */
  frame(dt: number, calm = false): number | null {
    if (!this.auto) return null;
    this.cooldown -= dt;
    this.acc += dt;
    this.frames++;
    if (calm) this.calmFrames++;
    if (this.acc >= QUALITY.window) {
      const next = this.judge(this.frames / this.acc, this.calmFrames * 2 < this.frames);
      if (next !== null) return next;
    }
    if (calm && this.cooldown <= 0 && this.fast >= this.upWait && this.level < this.top()) {
      this.sinceUp = 0;
      this.probe = { fps: this.lastFps };
      return this.go(this.level + 1, QUALITY.probeCooldown);
    }
    return null;
  }

  /** a window of `fps` is over (`live`: most of it was play) */
  private judge(fps: number, live: boolean): number | null {
    this.acc = 0;
    this.frames = 0;
    this.calmFrames = 0;
    if (this.cooldown > 0) return null;
    this.lastFps = fps;
    this.sinceUp++;
    const check = this.check;
    this.check = null;
    if (check && fps < check.fps * (1 + QUALITY.minGain)) {
      // the cheaper picture did not help: it is not what holds the frame rate back
      this.cap = Math.max(check.fps, fps);
      return this.go(check.from);
    }
    // a menu can run faster than play on a machine whose processor is the limit: only play clears a cap
    if (live && this.cap !== null && fps > this.cap * (1 + QUALITY.capBand)) this.cap = null;
    const slowFps = this.cap === null ? QUALITY.slowFps : Math.min(QUALITY.slowFps, this.cap * (1 - QUALITY.capBand));
    const probe = this.probe;
    this.probe = null;
    // the richer picture must hold most of the frame rate it had (up to fastFps: a 120 Hz screen keeps 57)
    if (probe && fps < Math.max(slowFps, Math.min(probe.fps, QUALITY.fastFps) * (1 - QUALITY.minGain))) {
      this.upWait = Math.min(this.upWait * 2, QUALITY.upMaxWindows);
      return this.go(this.level - 1);
    }
    // under a cap a window is fast when it holds the cap: a phone held at 30 fps can still climb
    const fastFps = this.cap === null ? QUALITY.fastFps : Math.min(QUALITY.fastFps, this.cap * (1 - QUALITY.capBand / 2));
    this.slow = fps < slowFps ? this.slow + 1 : 0;
    this.fast = fps >= fastFps ? this.fast + 1 : 0;
    if (this.slow >= QUALITY.slowWindows && this.level > 0) {
      // slow again soon after a step up: that level is too much for now, so wait longer to try it again
      if (this.sinceUp <= QUALITY.upFail) this.upWait = Math.min(this.upWait * 2, QUALITY.upMaxWindows);
      this.check = { from: this.level, fps };
      return this.go(this.level - 1);
    }
    return null;
  }

  /** the richest level a step up may reach now: past `autoTop` only with no cap (a capped phone is saving power or heat) */
  private top(): number {
    return this.cap === null ? this.ceiling : Math.min(this.ceiling, START);
  }

  /** the player picked Auto: start again from `QUALITY.autoTop`, with nothing learned */
  start(): void {
    this.auto = true;
    this.upWait = QUALITY.upWindows;
    this.sinceUp = Infinity;
    this.check = null;
    this.probe = null;
    this.cap = null;
    this.go(Math.min(START, this.ceiling));
  }

  /** the player fixed a level: the governor leaves it */
  fix(level: number): void {
    this.auto = false;
    this.level = level;
  }

  /** the graphics context was lost: Auto climbs no higher than where it starts from now on */
  lostContext(): void {
    this.ceiling = Math.min(this.ceiling, START);
  }

  private go(level: number, cooldown: number = QUALITY.changeCooldown): number {
    this.level = level;
    this.slow = 0;
    this.fast = 0;
    this.acc = 0;
    this.frames = 0;
    this.calmFrames = 0;
    this.cooldown = cooldown;
    return level;
  }
}

/**
 * The pixel ratio to draw a `w` x `h` CSS-pixel view at on level `q`: the level's, never more than
 * the screen's own `dpr`, and never a drawing buffer over `QUALITY.maxPixels`.
 */
export function pixelRatioFor(q: QualityLevel, dpr: number, w: number, h: number): number {
  const ratio = Math.min(dpr || 1, q.pixelRatio);
  const area = Math.max(1, w * h);
  return Math.min(ratio, Math.sqrt(QUALITY.maxPixels / area));
}
