import { describe, expect, it } from 'vitest';
import { ASSIST, CONTACT, SIM } from '../src/config';
import { Athlete } from '../src/game/athlete';
import type { ContactEvent } from '../src/game/contact';
import { idleIntent } from '../src/game/intent';
import { Simulation, type SimulationHooks } from '../src/game/simulation';
import { solveApex } from '../src/physics/solve';
import { NO_HOOKS } from './simHooks';
import { freeBallToATeam } from './simScenes';

// The simulation runs on its own (docs/adr/0010): these tests build a real one, with real brains,
// a real ball and the real contact system, in Node. There is no page, no canvas and no renderer.

const DT = 1 / SIM.hz;

function play(seed: number, seconds: number) {
  const r = freeBallToATeam(seed);
  const path: number[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    r.sim.step(DT);
    const p = r.sim.ball.state.p;
    path.push(p.x, p.y, p.z);
    for (const a of r.sim.athletes) path.push(a.pos.x, a.pos.y, a.pos.z);
  }
  return { ...r, path };
}

describe('the simulation runs on its own', () => {
  it('is built and stepped with no page and no renderer: the clock moves one fixed step at a time', () => {
    const { sim } = freeBallToATeam(1);
    for (let i = 0; i < 120; i++) sim.step(DT);
    expect(sim.simTime).toBeCloseTo(1, 9);
    expect(sim.ball.active).toBe(true);
  });

  it('brains running in it play a free ball: someone gets under it and the team touches it before it lands', () => {
    const { log, sim } = play(1, 6);
    const touches = log.filter((l) => !l.includes(' ball '));
    expect(touches.length, log.join('\n')).toBeGreaterThan(0);
    const firstTouch = Number(touches[0].split(' ')[0]);
    const firstBounce = log.find((l) => l.includes('ball floor'));
    if (firstBounce) expect(firstTouch).toBeLessThan(Number(firstBounce.split(' ')[0]));
    expect(sim.simTime).toBeCloseTo(6, 6);
  });

  it('the same start gives the same play, step for step: every position of the ball and of every athlete', () => {
    const a = play(7, 6);
    const b = play(7, 6);
    expect(a.log).toEqual(b.log);
    expect(a.path).toEqual(b.path);
  });

  it('a different random seed gives a different play: the brains draw their reads from the simulation’s own stream', () => {
    const a = play(7, 6);
    const b = play(8, 6);
    expect(a.path).not.toEqual(b.path);
  });
});

/** one player, a libero on the away side, and a free ball coming down onto their platform */
function aPlayerUnderAFreeBall(hooks: Partial<SimulationHooks> = {}) {
  const sim = new Simulation({ ...NO_HOOKS, ...hooks });
  const player = new Athlete('L', -1);
  player.place(1, -5, Math.PI);
  sim.athletes.push(player);
  const seat = sim.addSeat(player);
  const from = { x: -1, y: 2.4, z: 3 };
  const v = { x: 0, y: 0, z: 0 };
  solveApex(from, { x: 1, y: 0.9, z: -4.6 }, 5.5, { x: 0, y: 0, z: 0 }, v);
  sim.ball.launch(from, v);
  sim.ball.lastTouch = { athlete: null, kind: 'free', t: 0, side: 1 };
  /** the player holds a pass from frame 40 on, until the ball has left their arms (4 s at most) */
  const pass = (): void => {
    for (let f = 0; f < 240 && sim.ball.lastTouch?.athlete !== player; f++) {
      const hands = idleIntent();
      hands.yaw = Math.PI;
      if (f === 40) hands.pressed.push('pass');
      if (f >= 40) hands.held.push('pass');
      seat.hear(1 / 60, hands);
      for (let i = 0; i < 2; i++) sim.step(DT);
    }
  };
  return { sim, player, seat, pass };
}

describe('a touch, in a simulation nobody is listening to', () => {
  // On a court the rally is the referee's from the first clean touch: nobody has to ask for the
  // whistle. Whoever ran a simulation used to have to arm the judge and tell the drill themselves
  // (the game did, and the tests' headless game copied it).
  it('a clean touch puts the rally in the judge’s hands with nobody listening', () => {
    const { sim, player, pass } = aPlayerUnderAFreeBall();
    expect(sim.judge.armed).toBe(false);
    pass();
    expect(sim.ball.lastTouch?.athlete).toBe(player);
    expect(sim.judge.armed).toBe(true);
  });

  it('a missed swing does not arm it: a hand through the air is not a touch', () => {
    const heard: ContactEvent[] = [];
    const sim = new Simulation({ ...NO_HOOKS, contact: (ev) => heard.push(ev) });
    const player = new Athlete('OH', 1);
    player.place(0, 3, 0);
    sim.athletes.push(player);
    const seat = sim.addSeat(player);
    // they jump and swing with no ball anywhere near
    for (let f = 0; f < 120 && !heard.length; f++) {
      const hands = idleIntent();
      if (f === 0) hands.pressed.push('jump');
      if (f < 10) hands.held.push('jump');
      if (f === 10) hands.released.push('jump');
      if (f === 20) hands.pressed.push('attack');
      if (f >= 20 && f < 24) hands.held.push('attack');
      if (f === 24) hands.released.push('attack');
      seat.hear(1 / 60, hands);
      for (let i = 0; i < 2; i++) sim.step(DT);
    }
    expect(heard.map((ev) => ev.grade)).toEqual(['Miss']);
    expect(sim.judge.armed).toBe(false);
  });

  it('the drill hears of a touch after the judge is armed and before whoever runs the game', () => {
    const order: string[] = [];
    const { sim, pass } = aPlayerUnderAFreeBall({
      touched: () => order.push(`the runner, first: the judge is ${sim.judge.armed ? 'armed' : 'not armed'}`),
      contact: () => order.push('the runner, last'),
    });
    sim.drill = {
      step: () => {},
      onOutcome: () => {},
      onContact: (ev) => order.push(`the drill hears of a ${ev.kind}: the judge is ${sim.judge.armed ? 'armed' : 'not armed'}`),
    };
    pass();
    expect(order).toEqual([
      'the runner, first: the judge is not armed',
      'the drill hears of a pass: the judge is armed',
      'the runner, last',
    ]);
  });
});

describe('an athlete nobody plays', () => {
  // The help an AI player's aim gets is a number of the play (ASSIST.ai), not a setting: it is the
  // same whoever runs the simulation. It used to be the game's to hand over, so a test's AI players
  // reached 6.6 cm less far than the game's.
  it('an AI player reaches as far in a test as in the game', () => {
    const sim = new Simulation(NO_HOOKS);
    const ai = new Athlete('OH', 1);
    sim.athletes.push(ai);
    expect(sim.contact.reach(ai)).toBeCloseTo(CONTACT.spikeReach + ASSIST.ai * ASSIST.reachBonus, 12);
    expect(sim.contact.setAssist(ai)).toBe(ASSIST.ai);
  });

  it('a player is helped as much as whoever runs the game says, and only a player is asked about', () => {
    const asked: Athlete[] = [];
    const sim = new Simulation({
      ...NO_HOOKS,
      aimAssist: (a) => {
        asked.push(a);
        return 1;
      },
    });
    const ai = new Athlete('OH', 1);
    const player = new Athlete('OH', 1);
    sim.athletes.push(ai, player);
    sim.addSeat(player);
    expect(sim.contact.reach(player)).toBeCloseTo(CONTACT.spikeReach + ASSIST.reachBonus, 12);
    sim.contact.reach(ai);
    sim.contact.setAssist(ai);
    expect(asked.every((a) => a === player)).toBe(true);
  });
});
