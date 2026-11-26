import { describe, expect, it } from 'vitest';
import { AI, COURT } from '../src/config';
import type { Athlete } from '../src/game/athlete';
import type { TouchKind } from '../src/game/ballEntity';
import type { CollisionEvent } from '../src/physics/ball';
import { SLOTS, type Slot } from '../src/ai/team';
import { scene } from './scene';

// (the book spots: each player's own habit, a little off them every rally, is tested on its own)
AI.sit.personal = 0;

/** An all-AI Mini Rally team on `side`, set up to serve, in a real simulation: six brains, the ball, the clock and the dice. */
function servingTeam(side: 1 | -1) {
  const s = scene({ seed: 7 });
  const { sim } = s;
  const ball = sim.ball;
  const team = s.team(side, { serving: true });
  let reads = 0;
  team.onRead = () => reads++;
  /** `athlete` has just played the ball (the ball flies on as it was) */
  const touch = (athlete: Athlete, kind: TouchKind) => {
    ball.lastTouch = { athlete, kind, t: sim.simTime, side: athlete.side };
  };
  /** OH2 serves from behind our end line: deep into their court, or (`net`) low into the net */
  const serve = (net = false) => {
    const v = net ? { y: 1.5, z: 15 } : { y: 4.5, z: 17 };
    s.send(
      { from: { x: 1.5 * side, y: 2.9, z: side * (COURT.halfLength + 0.8) }, v: { x: -0.6 * side, y: v.y, z: -side * v.z } },
      { athlete: team.players.get('OH2')!, kind: 'serve', side },
    );
  };
  /** play for up to `seconds`, calling `each` after every step with what the ball hit in it */
  const run = (seconds: number, each: (ev: CollisionEvent[]) => boolean | void = () => {}) => {
    s.run(seconds, () => !!each(ball.events));
  };
  const job = (slot: Slot) => team.brains.get(team.players.get(slot)!)!;
  return { s, ball, team, touch, serve, run, job, reads: () => reads };
}

describe.each([1, -1] as const)('our own serve (side %i)', (side) => {
  it('is not one of our touches and nobody plays it: the setter makes no call', () => {
    const { ball, team, serve, run, reads } = servingTeam(side);
    serve();
    run(1.2, () => ball.pos.z * side < -COURT.halfLength);
    expect(ball.pos.z * side).toBeLessThan(0);
    expect(team.touches).toBe(0);
    expect(team.read).toBeNull();
    expect(reads()).toBe(0);
  });

  it('the team settles into base defence while it flies: the front row stays at the net to block', () => {
    const { ball, team, serve, run, job } = servingTeam(side);
    serve();
    const jobs = new Set<string>();
    run(1.2, () => {
      for (const slot of SLOTS) {
        const b = job(slot);
        jobs.add(b.job);
        // their base defence spot: the front row on it, the back row moved along the net with the ball
        const spot = team.formSpot('defense', slot);
        const back = slot === 'S' || slot === 'L' || slot === 'OH2';
        expect(Math.abs(b.spot.z - spot.z)).toBeLessThan(1e-9);
        expect(Math.abs(b.spot.x - spot.x)).toBeLessThanOrEqual(back ? AI.sit.ballSideMax + 1e-9 : 1e-9);
      }
      for (const slot of ['OH1', 'MB', 'OPP'] as const) expect(Math.abs(job(slot).spot.z)).toBeLessThan(1);
      return ball.pos.z * side < -COURT.halfLength;
    });
    // nobody goes off to an approach start, sets or chases our own serve
    expect([...jobs]).toEqual(['base']);
  });

  it('a serve into the net is left alone, and a touch on it by any of us is a service fault', () => {
    const { s, ball, team, touch, serve, run, job } = servingTeam(side);
    serve(true);
    let net = false;
    const jobs = new Set<string>();
    run(1.5, (ev) => {
      if (ev.some((e) => e.kind === 'net' || e.kind === 'tape')) net = true;
      for (const slot of SLOTS) jobs.add(job(slot).job);
      // dropping back on our side
      return net && ball.vel.y < 0 && ball.pos.y < 1.2;
    });
    expect(net).toBe(true);
    expect(ball.pos.z * side).toBeGreaterThan(0);
    expect([...jobs]).toEqual(['base']);
    expect(team.serveFault).toBe(false);
    // the user (or anyone of ours) digs it up anyway
    touch(team.players.get('L')!, 'dig');
    s.step();
    expect(team.serveFault).toBe(true);
  });

  it('once the other side has played it, our touches are ordinary ones', () => {
    const { s, team, touch, serve, run } = servingTeam(side);
    serve();
    run(0.6);
    touch(s.athlete('L', -side as 1 | -1, { x: 0, z: -side * 6 }), 'pass');
    s.step();
    touch(team.players.get('L')!, 'dig');
    s.step();
    expect(team.serveFault).toBe(false);
    expect(team.touches).toBe(1);
  });
});
