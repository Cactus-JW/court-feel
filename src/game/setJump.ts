import * as THREE from 'three';
import { AI, BALL, PLAYER, SIM, TIMING } from '../config';
import { dirFromYaw } from '../core/mathx';
import type { V3 } from '../physics/ball';
import { Athlete } from './athlete';
import { SETTER_SPOT } from './plays';

/**
 * The jump set: the setter meets the pass at the top of a small jump, higher and sooner than off
 * the floor, so the ball has less far to go and the other block less time. In system only: a
 * pass off the net is set from the floor, with the legs under it. The jump is timed by the body
 * (the user's "Auto jump set" setting, an AI setter); the hands are still the setter's to time.
 * It helps the body, never the ball. Pure functions over the ball's predicted flight: no scene,
 * no DOM.
 */

/** the hands point: this far (m) above the head and in front of the feet */
export const HANDS_UP = 0.17;
export const HANDS_FWD = 0.14;

/** the ball's predicted flight (BallPredictor) */
interface Flight {
  descendThrough(y: number, fromT?: number): number;
  posAt(t: number, out: V3): V3;
}

/**
 * How a setter touches the ball: how far (m) above the hands point it is met, and how long (s)
 * it stays in the hands. The user catches it on the hands and it loads there (the set bar); an AI
 * setter takes it as it enters the hands and sends it at once (plays.ts: setterTouchY).
 */
export interface SetTouchKind {
  above: number;
  hold: number;
}
export const USER_TOUCH: SetTouchKind = { above: 0, hold: TIMING.setLoad };
export const AI_TOUCH: SetTouchKind = { above: 0.45, hold: 0 };

/** a setter's hop: its height, and where the body is at the catch (the ball is then in the hands across the top) */
export interface SetHop {
  /** peak height of the feet (m) */
  H: number;
  /** take-off to the catch (s) */
  air: number;
  /** the feet's height (m) and vertical speed (m/s, still rising) at the catch */
  feetY: number;
  vy: number;
  /** from the start of the plant to the catch (s) */
  lead: number;
}

/**
 * `a`'s set jump. The catch comes half the time the ball is in the hands (`hold`) before the
 * top and the ideal push half after it, so the body stays within a few centimetres of the top
 * while the ball is in the hands. A touch that takes no time is met at the top.
 */
export function setHop(a: Athlete, hold = TIMING.setLoad): SetHop {
  const g = BALL.gravity;
  const b = PLAYER.apexBand;
  const s = PLAYER.apexGravityScale;
  const H = a.jumpMax * a.stats.standingJumpFrac * PLAYER.setJump.height;
  const v0 = Athlete.takeoffSpeed(H);
  const up = Math.max(0, v0 - b) / g + Math.min(v0, b) / (g * s);
  const half = hold / 2;
  return { H, air: up - half, feetY: H - 0.5 * g * s * half * half, vy: g * s * half, lead: PLAYER.loadMin + up - half };
}

/**
 * How far (m) a hop carries the body along its run from the start of the plant to the catch, for
 * a setter moving at `speed` m/s, and the speed (m/s) it drifts at in the air: the plant brakes
 * the run down to the carried share (Athlete.step).
 */
export function hopDrift(speed: number, hop: SetHop, plantCarry = PLAYER.plantCarry): { dist: number; carry: number } {
  const carry = speed * plantCarry;
  const brakeT = Math.min(PLAYER.loadMin, (speed - carry) / PLAYER.plantBrake);
  const plant = speed * brakeT - 0.5 * PLAYER.plantBrake * brakeT * brakeT + carry * (PLAYER.loadMin - brakeT);
  return { dist: plant + carry * hop.air, carry };
}

/** a set jump for the ball now in flight */
export interface SetJumpPlan {
  /** when the plant starts, and when the ball reaches the hands (sim time) */
  pressT: number;
  catchT: number;
  /** the feet's height and vertical speed at the catch */
  feetY: number;
  vy: number;
  /** the ball at the catch: the hands are there (or `above` under it, for an AI's touch) */
  at: V3;
  /** the hop it is */
  hop: SetHop;
}

/**
 * The jump `a` would take to set the ball now in flight (at `now`), or null when there is none
 * to take: the ball never comes down onto the hands, the pass is out of system (it comes down
 * further than AI.outOfSystem from the setter's spot), or the moment to plant has gone.
 */
export function planSetJump(a: Athlete, flight: Flight, now: number, touch: SetTouchKind = USER_TOUCH): SetJumpPlan | null {
  const hop = setHop(a, touch.hold);
  const catchT = flight.descendThrough(a.height + HANDS_UP + touch.above + hop.feetY, now);
  if (catchT < 0) return null;
  const pressT = catchT - hop.lead;
  if (now > pressT + PLAYER.setJump.late) return null;
  const at = flight.posAt(catchT, { x: 0, y: 0, z: 0 });
  if (Math.hypot(at.x - SETTER_SPOT.x * a.side, at.z - SETTER_SPOT.z * a.side) > AI.outOfSystem) return null;
  return { pressT, catchT, feetY: hop.feetY, vy: hop.vy, at, hop };
}

/** where the feet take off from so the hop lands the hands on the ball: the catch spot, less what the run carries */
export function takeoffSpot(a: Athlete, plan: SetJumpPlan, out: { x: number; z: number }): { x: number; z: number } {
  const f = dirFromYaw(a.yaw, _f);
  const d = hopDrift(a.speed, plan.hop, a.plantCarry);
  const k = a.speed > 1e-6 ? d.dist / a.speed : 0;
  out.x = plan.at.x - f.x * HANDS_FWD - a.vel.x * k;
  out.z = plan.at.z - f.z * HANDS_FWD - a.vel.z * k;
  return out;
}

/**
 * The body goes up for its set jump: once the moment to plant has come, if the hop takes the
 * hands to the ball (within PLAYER.setJump.near) without flying through it (maxDrift). Otherwise
 * the setter stays on the floor. Returns whether it jumped.
 */
export function autoSetJump(a: Athlete, plan: SetJumpPlan | null, now: number): boolean {
  if (!plan || a.state !== 'ground' || now < plan.pressT - 0.5 / SIM.hz) return false;
  const J = PLAYER.setJump;
  const hop = plan.hop;
  if (hopDrift(a.speed, hop, a.plantCarry).carry > J.maxDrift) return false;
  const spot = takeoffSpot(a, plan, _s);
  if (Math.hypot(a.pos.x - spot.x, a.pos.z - spot.z) > J.near) return false;
  return a.hop(hop.H);
}

const _f = new THREE.Vector3();
const _s = { x: 0, z: 0 };
