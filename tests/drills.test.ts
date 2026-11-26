import { describe, expect, it } from 'vitest';
import { PLAYER, type PositionId } from '../src/config';
import type { ModeId } from '../src/game/modes/mode';
import { headlessGame } from './headlessGame';
import { brokenInvariants } from './invariants';

// Every drill, with nobody watching: a real simulation and a real drill in Node, with no renderer,
// no DOM, no HUD and no camera (docs/adr/0010). The player stands still, so this is the drill's own
// half of the play: it sets up its cast, feeds its balls, hears its touches and keeps its score.

const DRILLS: [ModeId, PositionId][] = [
  ['free', 'OH'],
  ['spike', 'OH'],
  ['spike', 'MB'],
  ['block', 'MB'],
  ['receive', 'L'],
  ['setter', 'S'],
  ['serve', 'OH'],
  ['rally', 'OH'],
  ['rally', 'S'],
  ['rally', 'L'],
];

/** play a drill for `seconds` and return what happened, checking the invariants at every step */
function play(id: ModeId, pos: PositionId, seconds: number, seed = 2024) {
  const game = headlessGame(id, pos, seed);
  const path: number[] = [];
  let launches = 0;
  let wasActive = false;
  for (let f = 0; f < seconds * 60; f++) {
    const before = game.sim.simTime;
    game.frame();
    const broken = brokenInvariants(game.sim, before, 2 / 120);
    if (broken.length) throw new Error(`${id}/${pos} frame ${f}: ${broken.join('; ')}`);
    const active = game.sim.ball.active;
    if (active && !wasActive) launches++;
    wasActive = active;
    const p = game.sim.ball.state.p;
    path.push(p.x, p.y, p.z);
    for (const a of game.sim.athletes) path.push(a.pos.x, a.pos.z);
  }
  return { game, path, launches };
}

describe('every drill plays with nobody watching', () => {
  for (const [id, pos] of DRILLS) {
    it(`${id} as ${pos}: sets up its cast, names itself, and keeps a ball coming`, () => {
      const { game, launches } = play(id, pos, 40);
      expect(game.said.some((line) => line.startsWith('title '))).toBe(true);
      expect(game.sim.athletes).toContain(game.seat.athlete);
      // a drill that feeds the player keeps feeding; one that waits on the player's serve has nothing to send
      if (id !== 'serve') expect(launches).toBeGreaterThan(0);
    });
  }

  it('gives the same play from the same seed, and another from another', () => {
    for (const [id, pos] of [
      ['rally', 'OH'],
      ['spike', 'OH'],
      ['receive', 'L'],
    ] as [ModeId, PositionId][]) {
      const first = play(id, pos, 30, 7);
      const again = play(id, pos, 30, 7);
      expect(again.path, `${id}/${pos}`).toEqual(first.path);
      expect(again.game.touches).toEqual(first.game.touches);
      const other = play(id, pos, 30, 8);
      expect(other.path, `${id}/${pos} with another seed`).not.toEqual(first.path);
    }
  });

  it('plays whole rallies between two teams of brains in the Mini Rally', () => {
    const { game } = play('rally', 'OH', 60);
    // they serve, the home side passes and sets (the player, who stands still, lets it drop), and the judge calls each point
    expect(game.touches.length).toBeGreaterThan(5);
    expect(game.touches.some((t) => t.includes('serve'))).toBe(true);
    expect(game.touches.some((t) => t.includes('pass'))).toBe(true);
    expect(game.touches.some((t) => t.includes('set'))).toBe(true);
    expect(game.touches.some((t) => t.includes('A '))).toBe(true);
    expect(game.touches.some((t) => t.includes('H '))).toBe(true);
    expect(game.outcomes.length).toBeGreaterThan(0);
  });
});

describe('Mini Rally: their jump serve', () => {
  // a passer reads a jump serve off the server's toss and steps back. The call says so at the top
  // of the screen (clear of the toss, which flies up the middle) and is gone by the time the server
  // leaves the floor: from then on the passer's eyes are on the ball (player report, 2026-11-22)
  it('the passers hear it on the toss, and the call is gone once the server leaves the floor', () => {
    const game = headlessGame('rally', 'OH');
    let up = -1;
    let down = -1;
    let struck = -1;
    for (let f = 0; f < 120 * 60 && struck < 0; f++) {
      const said = game.said.length;
      const touched = game.touches.length;
      game.frame();
      for (const line of game.said.slice(said)) {
        if (line === 'topCall Jump serve · step back' && up < 0) up = game.sim.simTime;
        if (line === 'topCall off' && up >= 0 && down < 0) down = game.sim.simTime;
      }
      if (up >= 0 && game.touches.slice(touched).some((t) => /A serve /.test(t))) struck = game.sim.simTime;
    }
    expect(up).toBeGreaterThan(0);
    expect(struck).toBeGreaterThan(up);
    expect(down).toBeGreaterThan(up);
    expect(down).toBeLessThan(struck);
    // the call is never the drill's message line, which sits over the court
    expect(game.said.some((line) => line.startsWith('message Jump serve'))).toBe(false);
  });
});

describe('Spike Drill: back to the start of the approach', () => {
  // between reps a hitter walks back to where their approach starts, and the setter waits for
  // them: nobody is picked up and put there, and no ball is set to an empty lane
  it('a hitter who ended the rep off the lane is walked back, a frame at a time, and the next set waits for them', () => {
    const game = headlessGame('spike', 'OH');
    const me = game.seat.athlete;
    const lane = { x: me.pos.x, z: me.pos.z };
    const offLane = (): number => Math.hypot(me.pos.x - lane.x, me.pos.z - lane.z);
    // the player runs at the net for a second, then lets go of the stick
    const hands = game.seat.intent;
    hands.moveZ = -1;
    hands.steering = true;
    for (let f = 0; f < 60; f++) game.frame();
    hands.moveZ = 0;
    hands.steering = false;
    expect(offLane()).toBeGreaterThan(2);
    // the rep plays out (the ball drops), and the drill sends them back
    for (let f = 0; f < 20 * 60 && !game.host.userReturning; f++) game.frame();
    expect(game.host.userReturning).toBe(true);
    let longest = 0;
    let frames = 0;
    let setEarly = false;
    while (game.host.userReturning && frames < 10 * 60) {
      const before = offLane();
      game.frame();
      frames++;
      longest = Math.max(longest, before - offLane());
      setEarly ||= game.sim.ball.active;
    }
    // a jog, over many frames, and they are on the lane at the end of it
    expect(frames).toBeGreaterThan(30);
    expect(frames).toBeLessThan(PLAYER.walkBack.maxT * 60);
    expect(longest).toBeLessThan(0.2);
    expect(offLane()).toBeLessThan(PLAYER.walkBack.near);
    // the next set waited for them, and then it came
    expect(setEarly).toBe(false);
    for (let f = 0; f < 5 * 60 && !game.sim.ball.active; f++) game.frame();
    expect(game.sim.ball.active).toBe(true);
  });
});
