import type { Simulation } from '../src/game/simulation';
import { R } from '../src/physics/ball';

/** how far past the court's boards an athlete may be before something is wrong (m) */
const HALL = 30;

/**
 * Facts that are true of the simulation after every step, whatever is being played. Returns the
 * ones that are not, as sentences. A test calls it after each step, so a rare bug fails at the
 * step it happens and not as a strange result seconds later.
 */
export function brokenInvariants(sim: Simulation, previousTime: number, dt: number): string[] {
  const broken: string[] = [];
  const finite = (name: string, v: { x: number; y: number; z: number }): void => {
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z))
      broken.push(`${name} is not a number: ${v.x}, ${v.y}, ${v.z}`);
  };
  if (Math.abs(sim.simTime - previousTime - dt) > 1e-9) broken.push(`the clock moved ${sim.simTime - previousTime} s in a step of ${dt} s`);
  const b = sim.ball.state;
  finite('the ball position', b.p);
  finite('the ball velocity', b.v);
  finite('the ball spin', b.w);
  if (sim.ball.active && b.p.y < R - 1e-6) broken.push(`the ball is ${R - b.p.y} m into the floor`);
  sim.athletes.forEach((a, i) => {
    const who = `athlete ${i} (${a.role})`;
    finite(`${who} position`, a.pos);
    finite(`${who} velocity`, a.vel);
    if (!Number.isFinite(a.yaw)) broken.push(`${who} faces ${a.yaw}`);
    if (a.pos.y < -1e-6) broken.push(`${who} is ${-a.pos.y} m under the floor`);
    if (Math.abs(a.pos.x) > HALL || Math.abs(a.pos.z) > HALL) broken.push(`${who} has left the hall: ${a.pos.x}, ${a.pos.z}`);
  });
  return broken;
}
