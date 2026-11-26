import { scene } from './scene';

// The named scenes: a start more than one test plays from, each built on `scene()`.

/** six brains on the home side, and a free ball coming over the net to them */
export function freeBallToATeam(seed: number) {
  const log: string[] = [];
  const s = scene({
    seed,
    hooks: {
      contact: (ev) => log.push(`${sim.simTime.toFixed(4)} ${ev.athlete.role} ${ev.kind} ${ev.grade}`),
      aiContact: (a, kind) => log.push(`${sim.simTime.toFixed(4)} ${a.role} ${kind}`),
      ballEvent: (e) => log.push(`${sim.simTime.toFixed(4)} ball ${e.kind}`),
    },
  });
  const { sim } = s;
  const team = s.team(1);
  // a player's athlete stands off the court and only watches
  s.athlete('OH', 1, { x: -7, z: 11 }, { user: true });
  s.send({ from: { x: 1, y: 2.2, z: -4 }, to: { x: -0.5, y: 1, z: 5 }, apex: 5 }, { athlete: null, kind: 'free', side: -1 });
  return { sim, team, log };
}
