import { ASSIST, TIMING, TUTORIAL } from '../config';
import { damp, lerp } from '../core/mathx';

/**
 * What can slow the play this frame. Every slow-down the game has is here, and they are all the
 * one player's: a shared session has none of them (docs/adr/0011), so a host runs with `swing`
 * and `set` null, the wheel shut and the lesson at 1.
 */
export interface PaceFacts {
  /** the play wheel is open: the game waits for the pick (it runs, slowly) */
  wheelOpen: boolean;
  /**
   * The dip into a contact (Settings: Slow-mo assist, or the lesson): the user is in the air
   * swinging at a ball. `until` is the time to its best moment (s), `inReach` whether it will come
   * within their reach. Null when no dip is wanted.
   */
  swing: { until: number; inReach: boolean } | null;
  /**
   * The user's set (Settings: Set slow-mo): `until` is the time to the catch (s), `absorbing`
   * whether the ball is loading in their hands. Null when the set is not theirs or the setting is off.
   */
  set: { until: number; absorbing: boolean } | null;
  /** the lesson's clock: the speed it asks for, and whether it is a moment the ball waits at (taken at once, not eased) */
  lesson: { scale: number; snap: boolean };
}

/** the speed the assists ask for right now, 0..1, before any easing */
export function slowTarget(f: PaceFacts): number {
  let target = f.wheelOpen ? ASSIST.playWheelSlow : 1;
  // lining up a contact: slow from `slowmoWindow` before the best moment, for a ball that can be reached
  if (f.swing && f.swing.until > 0 && f.swing.until < ASSIST.slowmoWindow && f.swing.inReach) target = ASSIST.slowmoScale;
  // a set: slow for the catch, and more while the ball loads in the hands, the same on every level
  if (f.set) {
    if (f.set.absorbing) target = Math.min(target, ASSIST.setSlowmoLoad);
    else if (f.set.until < ASSIST.setSlowmoWindow && f.set.until > -TIMING.setCatchLate) target = Math.min(target, ASSIST.setSlowmoCatch);
  }
  return target;
}

/**
 * How fast the play runs: turns a frame of real time into the simulation time it is worth. The
 * simulation itself has no idea of speed; it is stepped as many fixed steps as this allows.
 */
export class Pace {
  /** a multiplier on everything (tests and tools run the game fast or slow with it) */
  timeScale = 1;
  /** the speed from the slow-mo assists right now (the set autopilot times its frames by it) */
  slowmo = 1;
  /** the lesson's clock: 1 real time, slower through a taught rep, 0 while the ball waits for the player */
  tutor = 1;
  /** real seconds the play still has to hold still for (a clean hit asks for it: FX.hitStop*) */
  hitStop = 0;

  /** the simulation time a frame of `realDt` real seconds is worth, and the hit-stop it uses up */
  simSeconds(realDt: number, f: PaceFacts): number {
    this.slowmo = lerp(this.slowmo, slowTarget(f), damp(ASSIST.slowmoEase, realDt));
    // the lesson's own clock never stacks on top of the assist dip: the play runs at the slower of the two
    this.tutor = f.lesson.snap ? f.lesson.scale : lerp(this.tutor, f.lesson.scale, damp(TUTORIAL.clockEase, realDt));
    const scale = Math.min(this.slowmo, this.tutor);
    if (this.hitStop <= 0) return realDt * this.timeScale * scale;
    const used = Math.min(this.hitStop, realDt);
    this.hitStop -= used;
    return (realDt - used) * this.timeScale * scale;
  }
}
