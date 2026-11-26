import { describe, expect, it } from 'vitest';
import { ASSIST, CONTACT } from '../src/config';
import { netYaw } from '../src/ai/brain';
import { DT, scene } from './scene';

// The scene builder is what the tests of the play stand on (tests/scene.ts). These hold what its
// header says of it: where it puts a player, and the three ways a scene is not the app.

describe('a scene puts a team on the court as a rally starts', () => {
  it("a team's player stands on their book spot facing the net, like the five the team places itself", () => {
    for (const side of [1, -1] as const) {
      const s = scene();
      const team = s.team(side, { user: 'OH1', place: 'receive' });
      const you = team.user!;
      const spot = team.formSpot('receive', 'OH1');
      expect({ x: you.pos.x, z: you.pos.z }).toEqual(spot);
      expect(you.yaw).toBe(netYaw(side));
      // and in another formation, when a test puts the team in one
      s.place(team, 'defense');
      expect({ x: you.pos.x, z: you.pos.z }).toEqual(team.formSpot('defense', 'OH1'));
      for (const [slot, a] of team.players) expect({ x: a.pos.x, z: a.pos.z }, slot).toEqual(team.formSpot('defense', slot));
    }
  });
});

describe('a scene is the simulation, not the app', () => {
  it('a player has every assist off unless the test gives them one; an athlete nobody plays has the game’s own', () => {
    const s = scene();
    const you = s.athlete('OH', 1, { x: -3, z: 3 }, { user: true });
    const mate = s.athlete('OPP', 1, { x: 3, z: 3 });
    expect(s.sim.contact.reach(you)).toBeCloseTo(CONTACT.spikeReach, 9);
    expect(s.sim.contact.reach(mate)).toBeCloseTo(CONTACT.spikeReach + ASSIST.ai * ASSIST.reachBonus, 9);
    // the app's setting, handed over as the app hands it
    const helped = scene({ hooks: { aimAssist: () => 1 } });
    const them = helped.athlete('OH', 1, { x: -3, z: 3 }, { user: true });
    expect(helped.sim.contact.reach(them)).toBeCloseTo(CONTACT.spikeReach + ASSIST.reachBonus, 9);
  });

  it('a ball that is sent arms nothing: the judge calls a rally only after a touch, or when the test arms it', () => {
    const s = scene();
    s.send({ from: { x: 0, y: 2, z: 3 }, to: { x: 0, y: 0.2, z: 6 }, apex: 3 }, { athlete: null, kind: 'free', side: -1 });
    expect(s.sim.judge.armed).toBe(false);
    s.run(3);
    expect(s.outcomes).toEqual([]);
    // armed, the same ball is called where it lands
    const armed = scene();
    armed.send({ from: { x: 0, y: 2, z: 3 }, to: { x: 0, y: 0.2, z: 6 }, apex: 3 }, { athlete: null, kind: 'free', side: -1 });
    armed.sim.judge.arm(armed.sim.ball);
    armed.run(3);
    expect(armed.outcomes.map((x) => x.o.kind)).toEqual(['in']);
  });

  it('fixed steps run no seat’s frame: a player sent back to a spot walks there only when their seat’s frame is played', () => {
    const walk = (seconds: number, frames: boolean) => {
      const s = scene();
      const you = s.athlete('OH', 1, { x: -3, z: 6 }, { user: true });
      const seat = s.sim.seats[0];
      seat.walkTo(1, 6, 0);
      for (let i = 0; i < seconds * 60; i++) {
        // the app's beat: the seat's frame, then two fixed steps
        if (frames) seat.frame(2 * DT);
        s.step(2);
      }
      return { x: you.pos.x, walking: seat.walking };
    };
    // one second of steps: nobody has played what the seat holds
    const stepped = walk(1, false);
    expect(stepped.x).toBe(-3);
    expect(stepped.walking).toBe(true);
    // two seconds with the seat's frame played: it jogs its player back, and says when they are there
    const framed = walk(2, true);
    expect(Math.abs(framed.x - 1)).toBeLessThan(0.2);
    expect(framed.walking).toBe(false);
  });
});
