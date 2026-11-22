import { GRAPHICS_LEVEL_IDS, QUALITY } from '../config';

/** the richest level Auto picks (and starts at): its index in GRAPHICS_LEVEL_IDS */
const TOP = GRAPHICS_LEVEL_IDS.indexOf(QUALITY.autoTop);

/**
 * Picks the graphics level when the Graphics setting is Auto. It only watches frame times and says
 * which level it wants; what a level means for the renderer is the game's to apply
 * (`Game.applyQuality`). The rules and their numbers are in `QUALITY`.
 */
export class QualityGovernor {
  /** index in GRAPHICS_LEVEL_IDS: 0 is the cheapest */
  level: number = TOP;
  /** false: the player fixed a level, and the governor leaves it */
  auto = true;
  private acc = 0;
  private frames = 0;
  private cooldown: number = QUALITY.startCooldown;
  private slow = 0;
  private fast = 0;
  /** fast windows in a row a step up waits for (doubled by each step up that fails) */
  private upWait: number = QUALITY.upWindows;
  /** windows since the last step up */
  private sinceUp = Infinity;
  /** the last step down, until its first window says whether it helped */
  private check: { from: number; fps: number } | null = null;
  /** a frame rate a cheaper picture did not raise (null: none found) */
  cap: number | null = null;

  /** note a frame of `dt` real seconds: the level to change to, or null to stay */
  frame(dt: number): number | null {
    if (!this.auto) return null;
    this.cooldown -= dt;
    this.acc += dt;
    this.frames++;
    if (this.acc < QUALITY.window) return null;
    const fps = this.frames / this.acc;
    this.acc = 0;
    this.frames = 0;
    if (this.cooldown > 0) return null;
    this.sinceUp++;
    const check = this.check;
    this.check = null;
    if (check && fps < check.fps * (1 + QUALITY.minGain)) {
      // the cheaper picture did not help: it is not what holds the frame rate back
      this.cap = Math.max(check.fps, fps);
      return this.go(check.from);
    }
    if (this.cap !== null && fps > this.cap * (1 + QUALITY.capBand)) this.cap = null;
    const slowFps = this.cap === null ? QUALITY.slowFps : Math.min(QUALITY.slowFps, this.cap * (1 - QUALITY.capBand));
    this.slow = fps < slowFps ? this.slow + 1 : 0;
    this.fast = fps >= QUALITY.fastFps ? this.fast + 1 : 0;
    if (this.slow >= QUALITY.slowWindows && this.level > 0) {
      // slow again soon after a step up: that level is too much for now, so wait longer to try it again
      if (this.sinceUp <= QUALITY.upFail) this.upWait = Math.min(this.upWait * 2, QUALITY.upMaxWindows);
      this.check = { from: this.level, fps };
      return this.go(this.level - 1);
    }
    if (this.fast >= this.upWait && this.level < TOP) {
      this.sinceUp = 0;
      return this.go(this.level + 1);
    }
    return null;
  }

  /** the player picked Auto: start again from `QUALITY.autoTop`, with nothing learned */
  start(): void {
    this.auto = true;
    this.upWait = QUALITY.upWindows;
    this.sinceUp = Infinity;
    this.check = null;
    this.cap = null;
    this.go(TOP);
  }

  /** the player fixed a level: the governor leaves it */
  fix(level: number): void {
    this.auto = false;
    this.level = level;
  }

  private go(level: number): number {
    this.level = level;
    this.slow = 0;
    this.fast = 0;
    this.acc = 0;
    this.frames = 0;
    this.cooldown = QUALITY.changeCooldown;
    return level;
  }
}
