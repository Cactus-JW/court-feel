import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AI, CONTACT, COURT, type PositionId } from '../src/config';
import { Athlete } from '../src/game/athlete';
import { attackHeight, handSetAllowed, laneFor, LANES, needsGoodPass, SET_PLAYS, SETTER_SPOT, SETTER_TARGET } from '../src/game/plays';
import { HitterBrain } from '../src/ai/hitter';
import { USER_SLOT, type SetterRead } from '../src/ai/team';
import { scene } from './scene';

/**
 * A Mini Rally home team with the user in `pos`, in a real simulation: the six of them, the ball,
 * the clock and the dice.
 */
function homeTeam(pos: PositionId) {
  const s = scene({ seed: 7 });
  const { sim } = s;
  const ball = sim.ball;
  const team = s.team(1, { user: USER_SLOT[pos], place: 'receive' });
  const me = team.user!;
  const reads: { r: SetterRead; t: number }[] = [];
  team.onRead = (r) => reads.push({ r: { ...r }, t: sim.simTime });
  /** the libero passes from the back court to (x, z) at the setter's hands height */
  const pass = (x: number, z: number) => {
    s.send(
      { from: { x: 2.4, y: 0.85, z: 6.0 }, to: { x, y: 2.5, z }, apex: 4.1 },
      { athlete: team.players.get('L')!, kind: 'pass', side: 1 },
    );
  };
  /** our setter digs the first ball from his defence spot, aimed where a first ball by him goes */
  const setterDigs = () => {
    const setter = team.players.get('S')!;
    const d = team.formSpot('defense', 'S');
    setter.place(d.x, d.z, 0);
    const T = team.firstBallTarget(setter);
    s.send({ from: { x: d.x, y: 0.75, z: d.z }, to: T, apex: T.apex }, { athlete: setter, kind: 'dig', side: 1 });
  };
  /**
   * Play until the setter would touch it: the ball drops to their hands. A setter who has gone up
   * for a pass in system has their hands up there with them and the ball is in them sooner
   * (`SetterBrain` takes it `CONTACT.setRadius` from its hands point): the play stops on the step
   * before they send it, so the first ball is still the ball's last touch and the call can be asked.
   */
  const flight = () => {
    const first = ball.lastTouch;
    const setter = team.players.get('S')!;
    const hands = setter.height + 0.17 + 0.45;
    const brain = team.brains.get(setter)?.setter;
    const at = new THREE.Vector3();
    const inHands = () => {
      if (!brain) return false;
      brain.handsPoint(at);
      return Math.hypot(ball.pos.x - at.x, ball.pos.y - at.y, ball.pos.z - at.z) < CONTACT.setRadius;
    };
    s.run(3, () => ball.vel.y < 0 && (ball.pos.y < hands || inHands()));
    // (nobody has played the second ball yet: what the tests ask next is asked of the first ball)
    expect(ball.lastTouch).toBe(first);
  };
  return { s, sim, team, me, ball, reads, pass, setterDigs, flight };
}

describe("the setter's call on the pass (Mini Rally)", () => {
  it('a pass to the target is called in system, once, a moment after the pass', () => {
    const { team, reads, pass, flight } = homeTeam('OH');
    pass(SETTER_TARGET.x, SETTER_TARGET.z);
    flight();
    expect(reads).toHaveLength(1);
    expect(reads[0].r.call).toBe('in');
    expect(reads[0].t).toBeGreaterThanOrEqual(AI.setterRead - 1e-9);
    // in good time to change an approach: well before the setter touches it
    expect(reads[0].t).toBeLessThan(AI.setterRead + 0.05);
    expect(team.read?.off).toBeLessThan(0.5);
  });

  it('the middle runs a quick on every pass the setter calls in system, and on none they call high', () => {
    let both = 0;
    for (let off = 1.2; off < 2; off += 0.05) {
      const { s, sim, team, pass } = homeTeam('OH');
      pass(SETTER_SPOT.x, SETTER_SPOT.z + off);
      s.step(31);
      const quick = team.passToSetter(sim) !== null;
      s.step(9);
      expect(quick, `a pass ${off.toFixed(2)} m off`).toBe(team.read?.call === 'in');
      if (quick) both++;
    }
    // (the sweep crosses the line: some in, some out)
    expect(both).toBeGreaterThan(3);
    expect(both).toBeLessThan(16);
  });

  it('a pass well off the net is called out of system ("high")', () => {
    const { team, reads, pass, flight } = homeTeam('OH');
    pass(SETTER_SPOT.x + 0.4, SETTER_SPOT.z + 2.6);
    flight();
    expect(reads).toHaveLength(1);
    expect(reads[0].r.call).toBe('out');
    expect(team.read!.off).toBeGreaterThan(AI.outOfSystem);
  });

  it('the set follows the call: a called go is fast in system and a high ball out of system', () => {
    const go = SET_PLAYS.OH!.find((p) => p.short === 'Go')!;
    expect(needsGoodPass(go)).toBe(true);
    for (const [z, out] of [
      [SETTER_TARGET.z, false],
      [SETTER_SPOT.z + 2.6, true],
    ] as const) {
      const { sim, team, me, pass, flight } = homeTeam('OH');
      team.userPlay = go;
      team.userSetBias = 1;
      pass(SETTER_TARGET.x, z);
      flight();
      expect(team.read!.call).toBe(out ? 'out' : 'in');
      // the setter is wherever: the call decides, not where they ended up standing
      const setter = team.players.get('S')!;
      setter.place(SETTER_SPOT.x, SETTER_SPOT.z, 0);
      const set = team.callSet(sim, setter);
      expect(set.hitter).toBe(me);
      const above = set.apex - attackHeight(me);
      if (out) expect(above).toBeGreaterThanOrEqual(LANES.OH.apexAbove + 0.4 - 1e-6);
      else expect(above).toBeCloseTo(go.lane.apexAbove, 6);
    }
  });

  it('the setter running down a bad pass does not change the call that was made', () => {
    const { sim, team, pass, flight } = homeTeam('OPP');
    team.userPlay = SET_PLAYS.OPP!.find((p) => p.short === 'Fast')!;
    team.userSetBias = 1;
    pass(SETTER_SPOT.x - 1.2, SETTER_SPOT.z + 2.4);
    flight();
    expect(team.read!.call).toBe('out');
    // even taken right on the setter's spot, the set is the high one that was called
    const setter = team.players.get('S')!;
    setter.place(SETTER_SPOT.x, SETTER_SPOT.z, 0);
    const set = team.callSet(sim, setter);
    expect(set.apex - attackHeight(team.user!)).toBeGreaterThan(LANES.OPP.apexAbove);
  });
});

describe('when our setter plays the first ball (Mini Rally)', () => {
  it('he digs it high to the middle of the court, just behind the 3 m line', () => {
    const { team } = homeTeam('OH');
    const dig = team.firstBallTarget(team.players.get('S')!);
    const pass = team.firstBallTarget(team.players.get('L')!);
    // anyone else passes to the setter target at the net
    expect(pass.z).toBeCloseTo(SETTER_TARGET.z, 6);
    expect(dig.z).toBeGreaterThan(COURT.attackLine);
    expect(dig.z).toBeLessThan(COURT.attackLine + 1);
    expect(Math.abs(dig.x)).toBeLessThan(1.5);
    expect(dig.apex).toBeGreaterThan(pass.apex);
  });

  it('he does not go to set the second ball: he goes back to defend, and the libero sets it', () => {
    const { team, setterDigs, flight } = homeTeam('OH');
    setterDigs();
    flight();
    const setter = team.brains.get(team.players.get('S')!)!;
    const d = team.formSpot('defense', 'S');
    expect(setter.job).toBe('base');
    expect(Math.hypot(setter.spot.x - d.x, setter.spot.z - d.z)).toBeLessThan(1e-9);
    expect(team.brains.get(team.players.get('L')!)!.job).toBe('set');
    expect(team.secondBy).toBe(team.players.get('L'));
  });

  it('the second ball is out of system: the libero calls HIGH! and a called go goes up high', () => {
    const { sim, team, me, reads, setterDigs, flight } = homeTeam('OH');
    team.userPlay = SET_PLAYS.OH!.find((p) => p.short === 'Go')!;
    team.userSetBias = 1;
    setterDigs();
    flight();
    expect(reads).toHaveLength(1);
    expect(reads[0].r.setter).toBe(team.players.get('L'));
    expect(reads[0].r.call).toBe('out');
    const set = team.callSet(sim, team.players.get('L')!);
    expect(set.hitter).toBe(me);
    expect((set as { time?: number }).time).toBeUndefined();
    expect(set.apex - attackHeight(me)).toBeGreaterThanOrEqual(LANES.OH.apexAbove + 0.4 - 1e-6);
  });

  it('the libero only sets high balls to the pins: no quick, no pipe', () => {
    const { sim, team, setterDigs, flight } = homeTeam('OH');
    team.userSetBias = 0;
    setterDigs();
    flight();
    const libero = team.players.get('L')!;
    const pins = new Set([team.players.get('OH1'), team.players.get('OPP')]);
    for (let i = 0; i < 40; i++) {
      const set = team.callSet(sim, libero);
      expect(pins.has(set.hitter!)).toBe(true);
      expect((set as { time?: number }).time).toBeUndefined();
    }
  });

  it('a libero hand-sets only from behind the 3 m line (in front of it they bump-set)', () => {
    const libero = new Athlete('L', 1);
    const setter = new Athlete('S', 1);
    expect(handSetAllowed(libero, COURT.attackLine + 0.3)).toBe(true);
    expect(handSetAllowed(libero, -(COURT.attackLine + 0.3))).toBe(true);
    expect(handSetAllowed(libero, COURT.attackLine - 0.3)).toBe(false);
    expect(handSetAllowed(libero, 0.7)).toBe(false);
    // on the line is the front zone
    expect(handSetAllowed(libero, COURT.attackLine)).toBe(false);
    // a foot on the line is in the front zone: the feet stay clear of it
    expect(handSetAllowed(libero, COURT.attackLine + 0.1)).toBe(false);
    expect(handSetAllowed(libero, -(COURT.attackLine + 0.1))).toBe(false);
    expect(handSetAllowed(setter, 0.7)).toBe(true);
  });

  it('when the user is the libero, the second ball is theirs: no AI is sent to play it', () => {
    const { team, me, setterDigs, flight } = homeTeam('L');
    setterDigs();
    flight();
    expect(team.secondBy).toBe(me);
    for (const b of team.brains.values()) {
      expect(b.job).not.toBe('set');
      expect(b.job).not.toBe('free');
    }
  });
});

describe('the pipe (back-row attack, Mini Rally and the libero in the Spike Drill)', () => {
  /**
   * A hitter at the pipe's approach start in a real simulation, their own brain running them, and
   * the setter's set from their spot, as `callSet` makes it in system: `nearer` m nearer the net
   * than the pipe is meant to be and `higher` m higher. `backRow` false is a front-row hitter's
   * run at the same ball. Played until they leave the floor: the approach they planned and where
   * their feet left it.
   */
  const pipeRun = (o: { nearer?: number; higher?: number; backRow?: boolean } = {}) => {
    const s = scene();
    const lane = laneFor('L', 1);
    let brain!: HitterBrain;
    const hitter = s.athlete(
      'OH',
      1,
      { x: lane.sx, z: lane.sz, yaw: 0 },
      { brain: (a) => (brain = Object.assign(new HitterBrain(a, lane), { backRow: o.backRow ?? true, isMySet: () => true })) },
    );
    const y = attackHeight(hitter);
    s.send(
      {
        from: { x: SETTER_SPOT.x, y: 2.6, z: SETTER_SPOT.z },
        to: { x: lane.x, y, z: lane.z - (o.nearer ?? 0) },
        apex: y + lane.apexAbove + (o.higher ?? 0),
      },
      { athlete: null, kind: 'set', side: 1 },
    );
    let takeoffZ = -1;
    hitter.onTakeoff = (a) => (takeoffZ = a.pos.z);
    let plan = brain.plan;
    const left = s.run(4, () => {
      plan ??= brain.plan;
      return takeoffZ >= 0;
    });
    // (the hitter went up for it)
    expect(left).toBe(true);
    return { plan: plan!, takeoffZ };
  };

  it('in system it is met a little over 2 m off the net, and the hitter leaves the floor behind the 3 m line, their feet clear of it', () => {
    // the AI hitter's approach, run by HitterBrain on the athlete's own kinematics
    const behind = COURT.attackLine + AI.backRow.clear;
    const { plan, takeoffZ } = pipeRun();
    expect(plan).not.toBeNull();
    expect(plan.contact.z).toBeGreaterThan(2.0);
    expect(plan.contact.z).toBeLessThan(2.5);
    expect(plan.error).toBeLessThan(0.3);
    expect(takeoffZ).toBeGreaterThanOrEqual(behind - 0.02);
  });

  it('a pipe set too tight to the net is still jumped at from behind the 3 m line: the hitter reaches for it, the feet stay legal', () => {
    // (0.6 m nearer the net than the pipe is meant to be, and high: there is time to get anywhere)
    const tight = { nearer: 0.6, higher: 1.5 };
    const behind = COURT.attackLine + AI.backRow.clear;
    const free = pipeRun({ ...tight, backRow: false });
    const legal = pipeRun(tight);
    // left to itself the run would take off with the feet on the line
    expect(free.takeoffZ).toBeLessThan(behind - 0.05);
    expect(legal.takeoffZ).toBeGreaterThanOrEqual(behind - 0.02);
  });

  it('the outside gets about half the sets, the opposite a quarter, the middle and the pipe the rest (elite men: zone 4 52%, zone 2 26%, zone 3 12%, back row 9%)', () => {
    const share = (inSystem: boolean) => {
      const { sim, team, pass, flight } = homeTeam('L');
      team.userSetBias = 0;
      if (inSystem) pass(SETTER_TARGET.x, SETTER_TARGET.z);
      else pass(SETTER_SPOT.x + 0.4, SETTER_SPOT.z + 2.6);
      flight();
      const setter = team.players.get('S')!;
      const n: Record<string, number> = {};
      for (let i = 0; i < 2000; i++) {
        const h = team.callSet(sim, setter).hitter!;
        const slot = team.slotOf(h)!;
        n[slot] = (n[slot] ?? 0) + 1 / 2000;
      }
      return n;
    };
    const inSys = share(true);
    const out = share(false);
    // in system: the outside most, then the opposite; the pipe now and then
    expect(inSys.OH1).toBeGreaterThan(0.4);
    expect(inSys.OH1).toBeGreaterThan(inSys.OPP * 1.6);
    expect(inSys.OPP).toBeGreaterThan(inSys.OH2 ?? 0);
    expect(inSys.OH2 ?? 0).toBeGreaterThan(0.04);
    expect(inSys.OH2 ?? 0).toBeLessThan(0.12);
    // off a bad pass: a high ball to the outside most of all, the pipe hardly ever, no quick
    expect(out.OH1).toBeGreaterThan(inSys.OH1);
    expect(out.OH2 ?? 0).toBeLessThan(0.05);
    expect(out.MB ?? 0).toBe(0);
  });

  it('out of system the back-row set stays behind the 3 m line', () => {
    const { sim, team, pass, flight } = homeTeam('L');
    pass(SETTER_SPOT.x + 0.4, SETTER_SPOT.z + 2.6);
    flight();
    expect(team.read!.call).toBe('out');
    const setter = team.players.get('S')!;
    const pipe = team.players.get('OH2')!;
    let seen = 0;
    for (let i = 0; i < 60; i++) {
      const set = team.callSet(sim, setter);
      if (set.hitter !== pipe) continue;
      seen++;
      expect(set.target.z).toBeGreaterThan(COURT.attackLine + 0.5);
    }
    expect(seen).toBeGreaterThan(0);
  });
});
