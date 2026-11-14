import { PLAYBOOK } from '../config';
import { clamp } from '../core/mathx';
import { comboPlay, COMBOS, type Combo } from './combos';
import { isQuick, LANES, SETTER_PLAYS, SETTER_TARGET, type SetPlay } from './plays';
import { SETTER_KEYS, type SetterKey } from './setterCalls';

/**
 * Your own plays (start screen, Plays). A play gives every hitter a route: where their run
 * starts, where along the net they hit, and the tempo of their set. A saved play takes a place
 * on the play wheel instead of the built-in one there. What a route may be is limited to what
 * the hitters can run and the setter can set (PLAYBOOK): a quick is hit near the setter from a
 * short run, a back-row hitter takes off behind the 3 m line and has no quick.
 */

/** how soon the ball is hit: a quick (in the air as the setter touches it), a fast set, a medium one, a high ball */
export type Tempo = 'quick' | 'fast' | 'mid' | 'high';
export const TEMPO_LABEL: Record<Tempo, string> = { quick: 'Quick', fast: 'Fast', mid: 'Mid', high: 'High' };
const FRONT_TEMPOS: readonly Tempo[] = ['quick', 'fast', 'mid', 'high'];
/** the tempos a hitter can be given (the pipe: the bic's tempo, or the high pipe) */
export const TEMPOS: Record<SetterKey, readonly Tempo[]> = { OH: FRONT_TEMPOS, MB: FRONT_TEMPOS, OPP: FRONT_TEMPOS, PIPE: ['mid', 'high'] };

/** one hitter's route: the ball is hit `x` m along the net, after a run from (`sx`, `sz`), at `tempo` */
export interface Route {
  x: number;
  sx: number;
  sz: number;
  tempo: Tempo;
  /** the hitter's own call this route is, by its short name (two calls can share a route: the high ball and the hut) */
  call?: string;
}

export interface SavedPlay {
  name: string;
  routes: Record<SetterKey, Route>;
}

/** one entry per place on the wheel: your play there, or null for the built-in one */
export type Playbook = (SavedPlay | null)[];

const round2 = (v: number) => Math.round(v * 100) / 100;
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** the tempo of one of the hitters' own calls */
export function tempoOf(play: SetPlay): Tempo {
  if (isQuick(play)) return 'quick';
  const a = play.lane.apexAbove;
  return a < PLAYBOOK.fastBelow ? 'fast' : a < PLAYBOOK.highFrom ? 'mid' : 'high';
}

/** the route of one of the hitters' own calls (a quick is hit `inFront` of where the setter takes the pass) */
export function routeOf(play: SetPlay): Route {
  const x = play.inFront !== undefined ? SETTER_TARGET.x - play.inFront : play.lane.x;
  return { x: round2(x), sx: play.lane.sx, sz: play.lane.sz, tempo: tempoOf(play), call: play.short };
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.011;

/** is route `r` the hitter's own call `p`, run where it is run? */
function isCall(p: SetPlay, r: Route): boolean {
  const o = routeOf(p);
  return o.tempo === r.tempo && near(o.x, r.x) && near(o.sx, r.sx) && near(o.sz, r.sz);
}

/** a route kept to what can be run and set (PLAYBOOK); anything that is not a number falls back to the hitter's first call */
export function clampRoute(k: SetterKey, r: Partial<Route> | null | undefined): Route {
  const P = PLAYBOOK;
  const d = routeOf(SETTER_PLAYS[k][0]);
  const back = k === 'PIPE';
  const tempo = TEMPOS[k].includes(r?.tempo as Tempo) ? (r!.tempo as Tempo) : d.tempo;
  const quick = tempo === 'quick';
  const x = quick
    ? clamp(num(r?.x, d.x), P.quickX[0], P.quickX[1])
    : clamp(num(r?.x, d.x), -(back ? P.pipeX : P.hitX), back ? P.pipeX : P.hitX);
  let sx = clamp(num(r?.sx, d.sx), -P.startX, P.startX);
  // a quick and a back-row attack start close behind where they are hit
  if (quick || back) sx = clamp(sx, x - P.startOff, x + P.startOff);
  const [z0, z1] = back ? P.pipeZ : quick ? P.quickZ : P.frontZ;
  const out: Route = { x: round2(x), sx: round2(sx), sz: round2(clamp(num(r?.sz, d.sz), z0, z1)), tempo };
  // still the call it was made from? (a moved route is no longer that call)
  const own = SETTER_PLAYS[k].find((p) => p.short === r?.call);
  if (own && isCall(own, out)) out.call = own.short;
  return out;
}

const WHO: Record<SetterKey, string> = { OH: 'Outside', MB: 'Middle', OPP: 'Opposite', PIPE: 'Back row' };

/**
 * The set a route is. A route that is one of the hitter's own calls is that call (so it keeps
 * its name); any other is a new set: hit where the route says, at the tempo's height.
 */
export function routePlay(k: SetterKey, route: Partial<Route>): SetPlay {
  const r = clampRoute(k, route);
  const own = SETTER_PLAYS[k].find((p) => p.short === r.call) ?? SETTER_PLAYS[k].find((p) => isCall(p, r));
  if (own) return own;
  const word = TEMPO_LABEL[r.tempo];
  const label = `${WHO[k]} ${word.toLowerCase()} (your play)`;
  if (r.tempo === 'quick')
    return {
      name: 'Quick (your play)',
      short: word,
      lane: { ...LANES.MB, x: r.x, sx: r.sx, sz: r.sz, label },
      inFront: SETTER_TARGET.x - r.x,
    };
  const base = k === 'PIPE' ? LANES.L : k === 'OPP' ? LANES.OPP : LANES.OH;
  return {
    name: `${word} (your play)`,
    short: word,
    lane: {
      x: r.x,
      z: k === 'PIPE' || r.tempo === 'high' ? base.z : PLAYBOOK.fastZ,
      apexAbove: r.tempo === 'high' ? base.apexAbove : PLAYBOOK.apex[r.tempo],
      sx: r.sx,
      sz: r.sz,
      label,
    },
  };
}

/** every hitter's route in a play on the wheel (to start a new play from it) */
export function routesOf(c: Combo): Record<SetterKey, Route> {
  const out = {} as Record<SetterKey, Route>;
  for (const k of SETTER_KEYS) out[k] = clampRoute(k, routeOf(comboPlay(c, k) ?? SETTER_PLAYS[k][0]));
  return out;
}

/** a saved play as the wheel calls it */
export function toCombo(p: SavedPlay): Combo {
  const routes = {} as Record<SetterKey, SetPlay>;
  const calls = {} as Record<SetterKey, string>;
  for (const k of SETTER_KEYS) {
    routes[k] = routePlay(k, p.routes[k]);
    calls[k] = routes[k].short;
  }
  return { name: p.name, idea: 'Your play', calls, routes };
}

/** a play's name as typed: trimmed, one line, at most PLAYBOOK.nameMax characters ('' when nothing is left) */
export function cleanName(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, PLAYBOOK.nameMax) : '';
}

function sanitizePlay(raw: unknown): SavedPlay | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as { name?: unknown; routes?: Record<string, Partial<Route> | null> };
  const name = cleanName(src.name);
  if (!name || !src.routes || typeof src.routes !== 'object') return null;
  const routes = {} as Record<SetterKey, Route>;
  for (const k of SETTER_KEYS) routes[k] = clampRoute(k, typeof src.routes[k] === 'object' ? src.routes[k] : null);
  return { name, routes };
}

/**
 * Stored plays are untrusted (another build, or storage edited by hand): one entry per place on
 * the wheel; a play with no name or no routes is dropped, and every route is clamped.
 */
export function sanitizePlaybook(raw: unknown): Playbook {
  const src = Array.isArray(raw) ? raw : [];
  return COMBOS.map((_, i) => sanitizePlay(src[i]));
}

const KEY = 'courtfeel.plays.v1';
let book: Playbook | null = null;
let wheel: readonly Combo[] | null = null;

/** your saved plays, by place on the wheel */
export function playbook(): Playbook {
  if (book) return book;
  try {
    const raw = localStorage.getItem(KEY);
    book = sanitizePlaybook(raw ? JSON.parse(raw) : null);
  } catch {
    /* private mode / blocked storage / unparseable JSON: no saved plays */
    book = sanitizePlaybook(null);
  }
  return book;
}

/** save `play` to a place on the wheel (null: the built-in play is back) */
export function savePlay(slot: number, play: SavedPlay | null): void {
  const b = playbook();
  if (slot < 0 || slot >= b.length) return;
  b[slot] = play && sanitizePlay(play);
  wheel = null;
  try {
    localStorage.setItem(KEY, JSON.stringify(b));
  } catch {
    /* ignore: the play stays for this visit */
  }
}

/** the plays on the wheel, clockwise from the top: yours where you saved one, else the built-in ones */
export function wheelPlays(): readonly Combo[] {
  return (wheel ??= playbook().map((p, i) => (p ? toCombo(p) : COMBOS[i])));
}
