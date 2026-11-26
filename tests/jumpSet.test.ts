import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AI, PLAYER, SIM, TIMING } from '../src/config';
import { SetterBrain } from '../src/ai/setter';
import { Athlete, FEET_OFF_NET } from '../src/game/athlete';
import type { ContactEvent, SetOption } from '../src/game/contact';
import { SETTER_SPOT } from '../src/game/plays';
import { autoSetJump, HANDS_FWD, hopDrift, planSetJump, setHop, takeoffSpot } from '../src/game/setJump';
import { setTouch, setWindow, type SetShape } from '../src/game/setTiming';
import type { V3 } from '../src/physics/ball';
import { DT, scene } from './scene';

const OH_TARGET = { x: -4.05, y: 3.25, z: 0.9 };
const high: SetShape = { window: 1, fast: false, outOfSystem: false };

/**
 * A home setter facing the outside, a pass on its way down to `to` (a point at standing hands
 * height) or aimed at `aim` (into the net, or over it), in a real simulation. The setter is the
 * player (they have a seat), or with `ai` an athlete for a brain to play.
 */
function stage(o: { to?: { x: number; z: number }; steep?: boolean; aim?: V3; ai?: boolean; seed?: number } = {}) {
  const options: SetOption[] = [{ target: OH_TARGET, apex: OH_TARGET.y + 1.65, hitter: null, label: 'OH High', key: 'OH' }];
  /** the body and the ball as an AI setter's set leaves the hands */
  const aiSets: { t: number; feetY: number; vy: number; ballY: number }[] = [];
  const s = scene({
    seed: o.seed ?? 3,
    hooks: {
      setLevel: () => 'easy',
      // Settings: Auto jump set, as the game runs it (Game.userSetJump): the player's body goes up by itself
      userSetJump: () => {
        if (a.jumpSets) autoSetJump(a, cs.setCatch(a)?.jump ?? null, sim.simTime);
      },
      aiContact: (b) => aiSets.push({ t: sim.simTime, feetY: b.pos.y, vy: b.vel.y, ballY: ball.pos.y }),
    },
    drill: {
      passTarget: () => ({ x: 1, y: 2.35, z: 0.9, apex: 4 }),
      setOptions: () => options,
      setPick: () => 'OH',
      canServe: () => false,
    },
  });
  const { sim } = s;
  const ball = sim.ball;
  const cs = sim.contact;
  const a = s.athlete('S', 1, { x: SETTER_SPOT.x, z: SETTER_SPOT.z, yaw: Math.PI / 2 }, { user: !o.ai });
  const to = o.to ?? { x: SETTER_SPOT.x - HANDS_FWD, z: SETTER_SPOT.z };
  // (steep: popped up from close by, so it comes almost straight down)
  const from = o.steep ? { x: to.x + 0.3, y: 0.85, z: to.z + 0.6 } : { x: -1, y: 0.85, z: 6.4 };
  s.send({ from, to: o.aim ?? { x: to.x, y: a.height + 0.17, z: to.z }, apex: 4.4 }, { athlete: null, kind: 'pass', side: 1 });
  return { s, sim, ball, cs, a, aiSets };
}

/**
 * One set off that pass. `jump`: the body goes up by itself (auto jump set); `space`: the setter
 * jumps themself this long before the ball would reach standing hands. The setter starts on the
 * floor spot, presses as the ball reaches the hands and releases at the top of the bar.
 */
function rep(o: { jump?: boolean; space?: number; to?: { x: number; z: number }; steep?: boolean; aim?: V3 } = {}) {
  const { s, sim, ball, cs, a } = stage(o);
  a.jumpSets = !!o.jump;
  a.airIntent = 'set';
  // stand on the floor spot (it is where the ball comes down onto the hands for the set you will take)
  const spot = cs.setSpot(a, { x: 0, y: 0, z: 0 })!;
  a.place(spot.x, spot.z, Math.PI / 2);
  a.cmd.faceYaw = Math.PI / 2;
  const tFloor = ball.ensurePrediction(sim.env, sim.simTime).descendThrough(a.height + 0.17, 0);
  let pressed = false;
  let feetAtCatch = -1;
  let vyAtCatch = 0;
  let catchT = -1;
  let cueT = -1;
  let peak = 0;
  let set: ContactEvent | null = null;
  let setT = -1;
  let feetAtSet = -1;
  let vyAtSet = 0;
  let hitterT = -1;
  for (let i = 0; i < SIM.hz * 5; i++) {
    // the player's legs and hands act before the step that plays them, as a frame's input does: `t` is that step
    const t = sim.simTime + DT;
    if (o.space !== undefined && a.state === 'ground' && t >= tFloor - o.space && peak === 0) {
      a.jumpPress();
      a.jumpRelease();
    }
    const pv = pressed ? null : cs.setPreview(a);
    if (pv && t >= pv.tIdeal - DT / 2) {
      cueT = pv.tIdeal;
      cs.pressSet(a, pv.tIdeal);
      pressed = true;
    }
    const held = a.action;
    if (held && held.kind === 'set' && held.held && held.absorbing && t >= held.arriveT + TIMING.setLoad) {
      held.held = false;
      held.releaseT = held.arriveT + TIMING.setLoad;
    }
    s.step();
    peak = Math.max(peak, a.pos.y);
    const act = a.action;
    if (act && act.kind === 'set' && act.absorbing && catchT < 0) {
      catchT = act.arriveT;
      feetAtCatch = a.pos.y;
      vyAtCatch = a.vel.y;
    }
    if (!set && s.touches.length) {
      set = s.touches[0].ev;
      setT = sim.simTime;
      feetAtSet = a.pos.y;
      vyAtSet = a.vel.y;
    }
    if (set && ball.vel.y < 0 && ball.pos.y <= OH_TARGET.y) {
      hitterT = sim.simTime;
      break;
    }
  }
  return {
    a,
    set: set as ContactEvent,
    setT,
    catchT,
    cueT,
    feetAtCatch,
    vyAtCatch,
    feetAtSet,
    vyAtSet,
    peak,
    hitterT,
    result: cs.lastSetResult!,
  };
}

describe('the jump set: the setter meets the pass at the top of a small jump', () => {
  it('it is a hop, well under a block jump, and it takes about 0.3 s from the plant to the catch', () => {
    const a = new Athlete('S', 1);
    const hop = setHop(a);
    expect(hop.H).toBeGreaterThan(0.25);
    expect(hop.H).toBeLessThan(a.jumpMax * a.stats.standingJumpFrac);
    expect(hop.lead).toBeGreaterThan(0.25);
    expect(hop.lead).toBeLessThan(0.4);
  });
  it('off the same pass the ball is met higher and sooner than off the floor', () => {
    const floor = rep();
    const jump = rep({ jump: true });
    expect(floor.peak).toBe(0);
    expect(jump.set.point.y - floor.set.point.y).toBeGreaterThan(0.25);
    expect(floor.catchT - jump.catchT).toBeGreaterThan(0.03);
  });
  it('the set gets to the hitter sooner: the other block has less time', () => {
    const floor = rep();
    const jump = rep({ jump: true });
    expect(floor.hitterT - jump.hitterT).toBeGreaterThan(0.06);
  });
  it('the top of the jump is in the middle of the touch: the body is still rising at the catch, coming down at the push, and stays within 5 cm of the top', () => {
    const r = rep({ jump: true });
    const hop = setHop(r.a);
    expect(Math.abs(r.peak - hop.H)).toBeLessThan(0.02);
    expect(r.feetAtCatch).toBeCloseTo(hop.feetY, 1);
    expect(r.vyAtCatch).toBeGreaterThan(0);
    expect(r.vyAtSet).toBeLessThan(0);
    expect(r.peak - r.feetAtCatch).toBeLessThan(0.05);
    expect(r.peak - r.feetAtSet).toBeLessThan(0.05);
  });
  it('the cue is true before the body moves: the ball reaches the hands when the ring said it would', () => {
    const r = rep({ jump: true });
    expect(Math.abs(r.catchT - r.cueT)).toBeLessThan(2 * DT);
  });
  it('a straight jump from a standing start is a clean touch: the same green as a set off still feet', () => {
    const floor = rep();
    const jump = rep({ jump: true });
    expect(jump.result.pips.feet).toBe(true);
    expect(jump.result.window).toBe(floor.result.window);
    expect(jump.set.grade).toBe('Perfect');
  });
  it('a pass off the net is set from the floor', () => {
    const r = rep({ jump: true, to: { x: SETTER_SPOT.x, z: SETTER_SPOT.z + AI.outOfSystem + 0.4 } });
    expect(r.peak).toBe(0);
    expect(r.set).toBeTruthy();
  });
  it('there has to be time to get up: once the moment to plant has gone, the setter stays down', () => {
    const { sim, ball, a } = stage();
    const flight = ball.ensurePrediction(sim.env, sim.simTime);
    const plan = planSetJump(a, flight, 0)!;
    expect(plan.catchT - plan.pressT).toBeCloseTo(setHop(a).lead, 6);
    expect(plan.hop.H).toBe(setHop(a).H);
    expect(planSetJump(a, flight, plan.pressT - 0.01)).not.toBeNull();
    expect(planSetJump(a, flight, plan.pressT + PLAYER.setJump.late + 0.01)).toBeNull();
  });
  it('jump yourself and the ring follows the jump you took: the ball still reaches the hands on its cue', () => {
    // (a ball coming straight down: the floor spot is under it whatever height you meet it at)
    const r = rep({ space: 0.45, steep: true });
    expect(r.peak).toBeGreaterThan(setHop(r.a).H);
    expect(r.set).toBeTruthy();
    expect(Math.abs(r.catchT - r.cueT)).toBeLessThan(2 * DT);
  });
});

describe('an AI setter jump-sets too', () => {
  /** an AI setter under a pass to `to` (a point at standing hands height): the body and the ball as the set leaves the hands */
  function aiSet(jumps: boolean, to?: { x: number; z: number }) {
    const { s, sim, a, aiSets } = stage({ to, ai: true, seed: 5 });
    const brain = new SetterBrain(a, SETTER_SPOT, Math.PI / 2);
    brain.jumps = jumps;
    brain.call = () => ({ target: OH_TARGET, apex: OH_TARGET.y + 1.65, hitter: null });
    sim.setBrain(a, brain);
    if (!s.run(4, () => aiSets.length > 0)) throw new Error('no set');
    return aiSets[0];
  }
  it('in system the ball is met at the top of the hop, higher and sooner than off the floor', () => {
    const floor = aiSet(false);
    const jump = aiSet(true);
    expect(floor.feetY).toBe(0);
    expect(jump.feetY).toBeGreaterThan(0.25);
    expect(Math.abs(jump.vy)).toBeLessThan(0.8);
    expect(jump.ballY - floor.ballY).toBeGreaterThan(0.2);
    expect(jump.t).toBeLessThan(floor.t);
  });
  it('a pass off the net is set from the floor', () => {
    expect(aiSet(true, { x: SETTER_SPOT.x, z: SETTER_SPOT.z + AI.outOfSystem + 0.6 }).feetY).toBe(0);
  });
});

describe('running into a jump set', () => {
  /** the setter arrives at the take-off spot at the moment to plant, still moving at `speed` m/s along the net */
  function runIn(speed: number, off = 0) {
    const { s, sim, ball, cs, a } = stage();
    a.jumpSets = true;
    const plan = planSetJump(a, ball.ensurePrediction(sim.env, sim.simTime), sim.simTime)!;
    // the pass flies until the next step is the moment to plant
    s.run(5, () => sim.simTime + DT >= plan.pressT - DT / 2);
    a.vel.set(-speed, 0, 0);
    const spot = takeoffSpot(a, plan, { x: 0, z: 0 });
    a.place(spot.x + off, spot.z, Math.PI / 2);
    a.vel.set(-speed, 0, 0);
    a.cmd.faceYaw = Math.PI / 2;
    // the moment to plant: the body goes up by itself, or stays down
    s.step();
    const went = a.state !== 'ground';
    if (went) s.run(1, () => sim.simTime >= plan.catchT - DT / 2);
    const hands = cs.handsPoint(a, new THREE.Vector3());
    return { went, a, plan, miss: Math.hypot(hands.x - plan.at.x, hands.z - plan.at.z) };
  }
  it('the hop is taken from short of the spot and the run carries the hands onto the ball', () => {
    const r = runIn(2);
    expect(r.went).toBe(true);
    expect(r.miss).toBeLessThan(0.08);
    // the plant took most of the run off: the body drifts, it does not fly
    expect(r.a.speed).toBeCloseTo(hopDrift(2, setHop(r.a)).carry, 1);
    expect(r.a.speed).toBeLessThan(1);
  });
  it('drifting through the touch costs green; a straight jump does not', () => {
    const drift = runIn(2).a.speed;
    const moving = setTouch(0, 0, 0, 0.48, high, 'easy', { drift, vy: 0.6 });
    const straight = setTouch(0, 0, 0, 0.48, high, 'easy', { drift: 0, vy: 0.6 });
    expect(moving.reasons).toContain('drifting');
    expect(straight.reasons).toEqual([]);
    expect(setWindow(moving, 'easy').green).toBeLessThan(setWindow(straight, 'easy').green);
  });
  it('a ball met off the top of the jump costs green too', () => {
    const falling = setTouch(0, 0, 0, 0.48, high, 'easy', { drift: 0, vy: -2.5 });
    expect(falling.reasons).toContain('off the top of the jump');
    expect(setWindow(falling, 'easy').green).toBeLessThan(setWindow(setTouch(1, 0, 0, 0.48, high, 'easy'), 'easy').green);
  });
  it('a setter who would fly through the ball stays down and sets off the floor', () => {
    expect(runIn(4.5).went).toBe(false);
  });
  it('too far from the take-off spot the body stays down: the hop would not reach the ball', () => {
    expect(runIn(0, PLAYER.setJump.near + 0.1).went).toBe(false);
    expect(runIn(0, PLAYER.setJump.near - 0.1).went).toBe(true);
  });
});

describe("a pass into the net that drops back on our side is still the setter's", () => {
  // (a pass a little tight, just under the tape: it dies in the net and drops down it, our side)
  const NET_BALL = { x: 1.0, y: 2.3, z: 0.1 };
  it('it hits the net and comes down on our side', () => {
    const { sim, ball } = stage({ aim: NET_BALL });
    const flight = ball.ensurePrediction(sim.env, sim.simTime);
    expect(flight.events.some((e) => e.kind === 'net')).toBe(true);
    expect(flight.land.z).toBeGreaterThan(0);
  });
  it('the floor spot shows, as near the net as the feet go, and the right button sets it', () => {
    const { cs, a } = stage({ aim: NET_BALL });
    const spot = cs.setSpot(a, { x: 0, y: 0, z: 0 });
    expect(spot).not.toBeNull();
    expect(spot!.z).toBeGreaterThanOrEqual(FEET_OFF_NET);
    expect(cs.wantsSet(a)).toBe(true);
    const r = rep({ aim: NET_BALL });
    expect(r.set.kind).toBe('set');
    expect(r.set.grade).not.toBe('Miss');
  });
  it('auto jump set goes up for it: the hands meet it on our side before it reaches the net', () => {
    const r = rep({ aim: NET_BALL, jump: true });
    expect(r.peak).toBeGreaterThan(0.2);
    expect(r.feetAtCatch).toBeGreaterThan(0.1);
    expect(r.set.point.z).toBeGreaterThan(0);
    expect(r.set.grade).not.toBe('Miss');
  });
  it('pressed late, a pass just gone over the tape is theirs too: the right button blocks, it does not set', () => {
    const { s, ball, cs, a } = stage();
    a.place(SETTER_SPOT.x, 0.2, Math.PI / 2);
    const P = cs.handsPoint(a, new THREE.Vector3());
    // just below the hands, falling, 5 cm over their side of the net: within reach of the hands
    s.send({ from: { x: P.x, y: P.y - 0.1, z: -0.05 }, v: { x: 0, y: -2, z: -1 } });
    expect(Math.hypot(P.y - ball.pos.y, P.z - ball.pos.z)).toBeLessThan(cs.setReach(a));
    expect(cs.wantsSet(a)).toBe(false);
    // the same ball still on our side is a late catch
    s.send({ from: { x: P.x, y: P.y - 0.1, z: 0.05 }, v: { x: 0, y: -2, z: -1 } });
    expect(cs.wantsSet(a)).toBe(true);
  });
  it('a pass that goes over the net is theirs: no spot, and the right button blocks', () => {
    const { sim, ball, cs, a } = stage({ aim: { x: 1.0, y: 2.45, z: -0.4 } });
    expect(ball.ensurePrediction(sim.env, sim.simTime).land.z).toBeLessThan(0);
    expect(cs.setSpot(a, { x: 0, y: 0, z: 0 })).toBeNull();
    expect(cs.wantsSet(a)).toBe(false);
  });
});
