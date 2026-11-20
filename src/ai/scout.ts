import { AI, COURT } from '../config';
import type { Athlete } from '../game/athlete';
import type { Touch } from '../game/ballEntity';
import type { AiHost } from '../game/brains';
import { attackKind } from './defence';

/**
 * A team's scouting report on the other side's hitters (AI.wing.scout): how often each one hits
 * cross rather than line off a pin attack. On a real court the whole team scouts, not the one
 * blocker in front: so it watches every pin spike of theirs whoever is at the net, the user
 * blocking there too. Both our wings, our middle and our perimeter defence read it.
 */
export class Scout {
  /** each of their hitters: 0 always line, 1 always cross */
  readonly cross = new Map<Athlete, number>();
  /** the last spike of theirs it noted: each one counts once */
  private shotRef: Touch | null = null;

  /** our read of their hitter `h`; one we have not seen yet (or nobody), `scoutStart` */
  crossOf(h: Athlete | null): number {
    return (h && this.cross.get(h)) ?? AI.wing.scoutStart;
  }

  /**
   * Watch their spike, for team `side` (once a step will do: each spike counts once). A pin attack
   * (a tip is not a shot to read) moves our read of its hitter `scout` of the way to line (0), when
   * it would land in our line digger's lane (`AI.defence.lineLane`, out wide too), or to cross (1),
   * anywhere inside that. One that does not come down on our side (into the net) shows nothing.
   */
  watch(g: AiHost, side: 1 | -1): void {
    const lt = g.ball.lastTouch;
    if (!lt || lt === this.shotRef || lt.kind !== 'spike' || lt.side === side) return;
    this.shotRef = lt;
    const h = lt.athlete;
    const { pos } = g.ball;
    if (!h || attackKind(pos.x, Math.abs(pos.z)) !== 'pin') return;
    const pred = g.ball.ensurePrediction(g.env, g.simTime);
    if (pred.landT < 0 || Math.sign(pred.land.z) !== side) return;
    const line = Math.sign(pos.x) * pred.land.x > COURT.halfWidth - AI.defence.lineLane;
    const seen = this.crossOf(h);
    this.cross.set(h, seen + AI.wing.scout * ((line ? 0 : 1) - seen));
  }
}
