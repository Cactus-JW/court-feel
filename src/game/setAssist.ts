import { ASSIST } from '../config';

/**
 * Aim assist for the set's footwork. Like the air magnet it helps the body, never the ball, and
 * at 0 it is off. While the ball is yours to set and your feet are within `ASSIST.setStep.radius`
 * (times the assist) of the spot, your body takes the last steps onto it and stops there, so
 * your attention can stay on the ball and the timing: getting near is yours, the last
 * centimetres are not a fiddle. It steers the move command (the same legs, the same top speed),
 * slowing as it arrives so the feet are still for the touch. Your own stick still counts: push
 * and you move, only held a little towards the spot, so you can always walk off it.
 *
 * `cmd` is the user's move command for this frame (changed in place), `feet` and `spot` the
 * floor points. Returns whether it steered. Pure: no scene, no DOM.
 */
export function setStepAssist(
  cmd: { moveX: number; moveZ: number; sprint: boolean },
  feet: { x: number; z: number },
  spot: { x: number; z: number },
  assist: number,
): boolean {
  const S = ASSIST.setStep;
  if (assist <= 0) return false;
  const dx = spot.x - feet.x;
  const dz = spot.z - feet.z;
  const d = Math.hypot(dx, dz);
  if (d > S.radius * assist) return false;
  const pushing = Math.hypot(cmd.moveX, cmd.moveZ) > S.deadzone;
  // arrive: full pace from `slow` m out, easing to a stop on the spot
  const pull = d <= S.stop ? 0 : Math.min(1, d / S.slow) * (pushing ? S.pull : 1);
  let mx = (pushing ? cmd.moveX : 0) + (d > 0 ? dx / d : 0) * pull;
  let mz = (pushing ? cmd.moveZ : 0) + (d > 0 ? dz / d : 0) * pull;
  const l = Math.hypot(mx, mz);
  if (l > 1) {
    mx /= l;
    mz /= l;
  }
  cmd.moveX = mx;
  cmd.moveZ = mz;
  // the last steps are a shuffle, never a run-up
  cmd.sprint = false;
  return true;
}
