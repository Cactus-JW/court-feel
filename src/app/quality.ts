import { QUALITY } from '../config';

/**
 * Decides when the picture has to get cheaper. It only watches frame times and says which level
 * it wants; what a level means for the renderer is the game's to apply (`Game.setQuality`).
 */
export class QualityGovernor {
  /** 0 is full quality, `QUALITY.lowest` the cheapest */
  level = 0;
  private acc = 0;
  private frames = 0;
  private cooldown: number = QUALITY.startCooldown;
  private slow = 0;

  /** note a frame of `dt` real seconds: the level to step down to, or null to stay */
  frame(dt: number): number | null {
    this.cooldown -= dt;
    this.acc += dt;
    this.frames++;
    if (this.acc < QUALITY.window) return null;
    const avg = this.acc / this.frames;
    this.acc = 0;
    this.frames = 0;
    if (this.cooldown > 0 || this.level >= QUALITY.lowest) return null;
    this.slow = avg > 1 / QUALITY.slowFps ? this.slow + 1 : 0;
    if (this.slow < QUALITY.slowWindows) return null;
    this.slow = 0;
    return this.level + 1;
  }

  /** the level was changed (by the governor's own ask, or by hand): hold it for a while */
  set(level: number): void {
    this.level = Math.max(0, Math.min(QUALITY.lowest, level));
    this.cooldown = QUALITY.changeCooldown;
  }
}
