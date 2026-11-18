import { describe, expect, it } from 'vitest';
import { SIM } from '../src/config';
import { Athlete } from '../src/game/athlete';
import { copyIntent, idleIntent, type Command, type Intent } from '../src/game/intent';
import { Simulation } from '../src/game/simulation';
import { solveApex } from '../src/physics/solve';
import { brokenInvariants } from './invariants';
import { NO_HOOKS } from './simHooks';

// Two players in one game (docs/adr/0011, the first milestone), at the level it has to hold first:
// one simulation, two seats, each handed its own player's intent every frame. No keys, no camera,
// no browser: an intent is all a seat takes, wherever it comes from.

const STEP = 1 / SIM.hz;
const FRAME = 1 / 60;
const STEPS_A_FRAME = Math.round(FRAME / STEP);

/** a game with a player on each side of the net, and a ball on its way to the far player's arms */
function twoPlayers() {
  const touches: string[] = [];
  const sim = new Simulation({
    ...NO_HOOKS,
    contact: (ev) => touches.push(`${sim.simTime.toFixed(4)} seat ${sim.seatOf(ev.athlete)?.id ?? 'none'} ${ev.kind} ${ev.grade}`),
  });
  const home = new Athlete('OH', 1);
  home.place(-2, 6, 0);
  const away = new Athlete('L', -1);
  away.place(1, -5, Math.PI);
  sim.athletes.push(home, away);
  const seats = [sim.addSeat(home), sim.addSeat(away)];
  // a free ball from the home side that comes down just in front of the away player, onto their platform
  const from = { x: -1, y: 2.4, z: 3 };
  const v = { x: 0, y: 0, z: 0 };
  solveApex(from, { x: 1, y: 0.9, z: -4.6 }, 5.5, { x: 0, y: 0, z: 0 }, v);
  sim.ball.launch(from, v);
  sim.ball.lastTouch = { athlete: null, kind: 'free', t: 0, side: 1 };
  return { sim, seats, home, away, touches };
}

/** what each player does on a frame: the home player runs at the net and jumps, the away player holds a pass under the ball */
function hands(frame: number): Intent[] {
  const home = idleIntent();
  if (frame >= 10 && frame < 70) {
    home.moveZ = -1;
    home.sprint = true;
    home.steering = true;
  }
  if (frame === 70) home.pressed.push('jump');
  if (frame >= 70 && frame < 80) home.held.push('jump');
  if (frame === 80) home.released.push('jump');

  const away = idleIntent();
  away.yaw = Math.PI;
  if (frame === 40) away.pressed.push('pass');
  if (frame >= 40) away.held.push('pass');
  return [home, away];
}

/** play `frames` frames from a stream of commands, and return every athlete's and the ball's path */
function play(game: ReturnType<typeof twoPlayers>, frames: number, commandsOf: (frame: number) => Command[]): number[] {
  const { sim, seats } = game;
  const path: number[] = [];
  for (let f = 0; f < frames; f++) {
    for (const c of commandsOf(f)) seats[c.seat].hear(FRAME, c.intent);
    for (let i = 0; i < STEPS_A_FRAME; i++) {
      const before = sim.simTime;
      sim.step(STEP);
      const broken = brokenInvariants(sim, before, STEP);
      if (broken.length) throw new Error(`frame ${f}: ${broken.join('; ')}`);
    }
    for (const a of sim.athletes) path.push(a.pos.x, a.pos.y, a.pos.z);
    path.push(sim.ball.state.p.x, sim.ball.state.p.y, sim.ball.state.p.z);
  }
  return path;
}

describe('two players in one game', () => {
  it('gives each seat its own athlete: one player’s hands never move the other’s', () => {
    const game = twoPlayers();
    const { home, away } = game;
    const homeStart = { x: home.pos.x, z: home.pos.z };
    const awayStart = { x: away.pos.x, z: away.pos.z };
    let peak = 0;
    play(game, 100, (f) => {
      peak = Math.max(peak, home.pos.y);
      return hands(f).map((intent, seat) => ({ seat, frame: f, intent }));
    });
    // the home player ran at the net and left the floor
    expect(home.pos.z).toBeLessThan(homeStart.z - 2);
    expect(peak).toBeGreaterThan(0.3);
    // the away player, who only held a pass, stayed where they stood
    expect(Math.hypot(away.pos.x - awayStart.x, away.pos.z - awayStart.z)).toBeLessThan(0.05);
    expect(home.pos.x).toBeCloseTo(homeStart.x, 6);
  });

  it('plays a touch by the second seat as a player’s touch: graded, and theirs', () => {
    const game = twoPlayers();
    play(game, 240, (f) => hands(f).map((intent, seat) => ({ seat, frame: f, intent })));
    const passes = game.touches.filter((t) => t.includes('pass'));
    expect(passes.length).toBe(1);
    expect(passes[0]).toContain('seat 1');
    expect(passes[0]).not.toContain('Miss');
    // the ball went back up off their arms
    expect(game.sim.ball.lastTouch?.athlete).toBe(game.away);
  });

  it('plays the same game again from the log of both players’ commands', () => {
    const live = twoPlayers();
    const log: Command[] = [];
    const first = play(live, 240, (f) => {
      const commands = hands(f).map((intent, seat) => ({ seat, frame: f, intent: copyIntent(intent) }));
      log.push(...commands);
      return commands;
    });
    const again = twoPlayers();
    const second = play(again, 240, (f) => log.filter((c) => c.frame === f));
    expect(second).toEqual(first);
    expect(again.touches).toEqual(live.touches);
  });

  it('leaves a seat that is sent nothing doing what it was last asked', () => {
    const game = twoPlayers();
    // the home player's commands stop arriving after frame 30 (a slow link): they keep running
    play(game, 60, (f) => hands(f).flatMap((intent, seat) => (seat === 0 && f > 30 ? [] : [{ seat, frame: f, intent }])));
    expect(game.home.cmd.moveZ).toBe(-1);
    expect(game.home.pos.z).toBeLessThan(4.5);
  });
});
