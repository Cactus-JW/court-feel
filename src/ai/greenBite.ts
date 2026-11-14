import { AI } from '../config';
import type { Athlete } from '../game/athlete';
import type { Touch } from '../game/ballEntity';
import type { Game } from '../game/game';

/**
 * Your green set beats their middle: an exact set at the called tempo shows nothing early, so
 * the middle has to go on what it sees, and what it sees is a hitter you did not set. This is
 * what a combination play is for: the middle goes up with the quick and the ball goes to the
 * hitter coming round behind it.
 */

/** is `lt` the user's green set? */
export function userGreen(g: Game, lt: Touch | null | undefined): boolean {
  const us = g.contact.lastSetResult;
  return !!lt && lt.kind === 'set' && !!us?.green && lt.athlete === us.athlete && lt.t === us.t;
}

/**
 * The hitter their middle bites on: one the setter did not set, near the net and either up
 * (planting or in the air: a quick) or running in. The one up comes first (a middle's eyes go
 * to the first tempo), then the nearest along the net. Null when nobody else is going: the
 * middle then just guesses a side.
 */
export function decoyFor(g: Game, blocker: Athlete, set: Touch): Athlete | null {
  const B = AI.greenBite;
  const setTo = g.contact.lastSet?.hitter ?? null;
  let best: Athlete | null = null;
  let bestScore = Infinity;
  for (const h of g.athletes ?? []) {
    if (h.side === blocker.side || h === setTo || h === set.athlete || h.isUser) continue;
    if (Math.abs(h.pos.z) > B.maxOff) continue;
    const up = h.state === 'air' || h.state === 'load';
    // running at the net (z shrinking), not jogging back to base
    const running = h.state === 'ground' && h.speed > B.runSpeed && h.vel.z * h.side < -1;
    if (!up && !running) continue;
    const score = Math.abs(h.pos.x - blocker.pos.x) + (up ? 0 : B.runPenalty);
    if (score < bestScore) {
      bestScore = score;
      best = h;
    }
  }
  return best;
}
