import { describe, expect, it } from 'vitest';
import type { PositionId } from '../src/config';
import type { Athlete } from '../src/game/athlete';
import type { ModeId } from '../src/game/modes/mode';
import { headlessGame } from './headlessGame';

// A ball that crosses the net outside the antennae stays in play until the judge calls it: where it
// lands, when the other team plays it, or when it comes back between the antennae (FIVB 8.4.4, 10.1.2;
// tests/judge.test.ts). The drills have to wait for that call. A touch by the other team on a ball
// that was already out is not a dig, a pass or a tool: the ball was out (OUT (ANTENNA)). And a ball
// the drill throws away (N, a new feed) takes its crossing with it.

type Game = ReturnType<typeof headlessGame>;

/** a ball of the home team sent over the net 2 m outside the right antenna, still in the air */
function sendWide(game: Game, kind: 'spike' | 'serve', by: Athlete): void {
  const { sim } = game;
  sim.ball.launch({ x: 6.5, y: 3.0, z: 1.2 }, { x: 0.3, y: 1.5, z: -7 }, undefined, 0, sim.simTime);
  sim.ball.lastTouch = { athlete: by, kind, t: sim.simTime, side: 1 };
  sim.judge.arm(sim.ball);
  for (let i = 0; i < 120 && sim.ball.pos.z > -0.5; i++) sim.step(1 / 120);
  expect(sim.ball.pos.z).toBeLessThan(0);
  expect(sim.judge.outWide).toBe(1);
}

/** a player of the away team gets a hand or a platform on it where it is */
function awayTouches(game: Game, kind: 'dig' | 'pass' | 'block'): void {
  const { sim, mode } = game;
  const them = sim.athletes.find((a) => a.side === -1)!;
  expect(them).toBeDefined();
  sim.ball.lastTouch = { athlete: them, kind, t: sim.simTime, side: -1 };
  // as the game does for a clean touch: the judge is armed and the drill hears of it
  sim.judge.arm(sim.ball);
  mode.onContact({ athlete: them, kind, grade: 'Good', speed: 6 } as any);
  sim.step(1 / 120);
}

/** play frames until the drill is in `phase` */
function until(game: Game, phase: string, frames = 900): void {
  for (let f = 0; f < frames && (game.mode as any).phase !== phase; f++) game.frame();
  expect((game.mode as any).phase).toBe(phase);
}

function start(id: ModeId, pos: PositionId): Game {
  return headlessGame(id, pos, 7);
}

const banners = (game: Game) => game.said.filter((s) => s.startsWith('banner '));

describe('the drills wait for the judge on a ball out wide', () => {
  it('Free Play: N on a ball out wide throws its crossing away with it, so the next feed is judged on its own', () => {
    const game = start('free', 'OH');
    const { sim } = game;
    sendWide(game, 'spike', game.seat.athlete);
    game.mode.restartRep();
    // the machine feeds again
    let fed = false;
    for (let f = 0; f < 600 && !fed; f++) {
      game.frame();
      fed = sim.ball.active;
    }
    expect(fed).toBe(true);
    expect(sim.judge.armed).toBe(true);
    expect(sim.judge.outWide).toBeNull();
  });

  it('Setter Drill: their back row playing your hitter’s attack that went round the antenna is OUT (ANTENNA), not DUG', () => {
    const game = start('setter', 'S');
    const { mode } = game;
    const me = game.seat.athlete;
    until(game, 'live');
    mode.onContact({ athlete: me, kind: 'set', grade: 'Good', speed: 6 } as any);
    mode.onContact({ athlete: me, kind: 'spike', grade: 'Good', speed: 20 } as any);
    sendWide(game, 'spike', me);
    awayTouches(game, 'dig');
    expect((mode as any).phase).toBe('result');
    const said = banners(game).join(' | ');
    expect(said).toContain('OUT (ANTENNA)');
    expect(said).not.toContain('DUG');
  });

  it('Serve Drill: a serve that crossed outside the antenna is OUT even when they pass it', () => {
    const game = start('serve', 'OH');
    const { mode } = game;
    (mode as any).toPhase('flight');
    sendWide(game, 'serve', game.seat.athlete);
    awayTouches(game, 'pass');
    expect((mode as any).phase).toBe('result');
    expect(banners(game).at(-1)).toBe('banner OUT · 0 bad');
  });

  it('Spike Drill: a spike that crossed outside the antenna and then hits their block is OUT (ANTENNA), not TOOLED', () => {
    const game = start('spike', 'OH');
    const { mode } = game;
    const me = game.seat.athlete;
    (mode as any).setBlock(1);
    until(game, 'live');
    mode.onContact({ athlete: me, kind: 'spike', grade: 'Good', speed: 20 } as any);
    sendWide(game, 'spike', me);
    awayTouches(game, 'block');
    expect((mode as any).phase).toBe('result');
    const said = banners(game).at(-1)!;
    expect(said).toContain('OUT (ANTENNA)');
    expect(said).not.toContain('TOOLED');
  });
});
