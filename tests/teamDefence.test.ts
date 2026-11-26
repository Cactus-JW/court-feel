import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AI, COURT, SIM, type PositionId } from '../src/config';
import { wrapAngle, yawFromDir } from '../src/core/mathx';
import type { Athlete } from '../src/game/athlete';
import type { TouchKind } from '../src/game/ballEntity';
import { idleIntent } from '../src/game/intent';
import type { MiniRally } from '../src/game/modes/miniRally';
import { laneFor, SETTER_SPOT, setterTouchY } from '../src/game/plays';
import { makeBall, stepBall, type V3 } from '../src/physics/ball';
import { netYaw } from '../src/ai/brain';
import { SetterBrain } from '../src/ai/setter';
import { SLOTS, type Slot } from '../src/ai/team';
import { headlessGame } from './headlessGame';
import { scene } from './scene';

const DT = 1 / SIM.hz;
// (the book spots: each player's own habit, a little off them every rally, is tested on its own)
AI.sit.personal = 0;
const D = AI.defence;
const W = COURT.halfWidth;

/**
 * An all-AI home team (+z) in a real simulation: six brains, the ball, the clock and the dice.
 * `you`: a player has that slot (a seat, and hands that do nothing). `seed`: the dice (3 when not
 * given). `away`: a real team across the net too (`theirs` is then its outside), with a player in
 * that slot if one is named.
 */
function homeTeam(o: { you?: Slot; seed?: number; away?: { you?: Slot } } = {}) {
  // no touches: nobody's pass, set or block meets the ball, so what is read here is what the players
  // read and where they go, with the ball never played
  const s = scene({ seed: o.seed ?? 3, touches: 'none' });
  const { sim } = s;
  const ball = sim.ball;
  const team = s.team(1, { user: o.you });
  const away = o.away ? s.team(-1, { user: o.away.you }) : null;
  /** one of theirs, who plays their touches: their outside, where its approach starts */
  const theirs = away ? away.players.get('OH1')! : s.athlete('OH', -1, { x: laneFor('OH', -1).sx, z: laneFor('OH', -1).sz });
  /** a team (ours when not given) in a formation, its player in it too (a team places its own brains' bodies, never the player's) */
  const place = (form: 'receive' | 'defense' | 'offense', of = team) => {
    of.place(form);
    const you = of.user;
    if (!you || !of.userSlot) return;
    const p = of.formSpot(form, of.userSlot);
    you.place(p.x, p.z, netYaw(of.side));
  };
  place('defense');
  if (away) place('defense', away);
  /** a touch: the ball leaves `from` for `to` with this apex */
  const touch = (kind: TouchKind, side: 1 | -1, from: V3, to: V3, apex: number, athlete: Athlete | null = theirs) => {
    s.send({ from, to, apex }, { athlete, kind, side });
  };
  /** the ball at `p` moving at `v`, just played by `athlete` */
  const put = (p: V3, v: V3, athlete: Athlete | null, kind: TouchKind = 'pass', side: 1 | -1 = 1) => {
    s.send({ from: p, v }, { athlete, kind, side });
  };
  /** a hard spike from `from` straight at `to` (ball centre on the floor) at `speed` m/s */
  const spike = (from: V3, to: V3, speed: number) => {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const flat = Math.hypot(dx, dz);
    const t = flat / speed;
    const vy = (to.y - from.y + 0.5 * 9.81 * t * t) / t;
    s.send({ from, v: { x: dx / t, y: vy, z: dz / t } }, { athlete: theirs, kind: 'spike', side: -1 });
  };
  /** play for `seconds`, calling `each` after every step */
  const run = (seconds: number, each?: () => void) => {
    s.run(seconds, () => {
      each?.();
      return false;
    });
  };
  const brain = (slot: Slot) => team.brains.get(team.players.get(slot)!)!;
  /**
   * Play for up to `seconds` with this player sent to the ball (`job`), or until `until` is true
   * after a step. The coordinator hands out the jobs at the end of every step, to whoever it would
   * send: this player is given theirs again after each. Returns whether `until` became true.
   */
  const sent = (slot: Slot, job: 'receive' | 'free' | 'set', seconds: number, until: () => boolean) => {
    const b = brain(slot);
    b.job = job;
    return s.run(seconds, () => {
      b.job = job;
      return until();
    });
  };
  return { s, team, away, ball, touch, put, spike, run, brain, sent, theirs, place };
}

/** a whole Mini Rally with nobody watching, you in `pos`: the drill itself says where a ball that is only kept up goes */
function miniRally(pos: PositionId) {
  const h = headlessGame('rally', pos, 3);
  return { sim: h.sim, rally: h.mode as MiniRally };
}

/**
 * their set is for their outside, a hitter we have seen hit line every time: our pin blocker takes
 * the line (`pinShade`), the libero digs cross outside the block's shadow
 */
function lineHitter(t: ReturnType<typeof homeTeam>) {
  t.team.theirSetFor = () => t.theirs;
  t.team.scout.cross.set(t.theirs, 0);
}

/** their setter sets their outside high (our right) */
function setOutside(t: ReturnType<typeof homeTeam>) {
  const lane = laneFor('OH', -1);
  t.touch('set', -1, { x: -SETTER_SPOT.x, y: 2.6, z: -SETTER_SPOT.z }, { x: lane.x, y: 3.25, z: lane.z }, 3.25 + lane.apexAbove);
}

describe('the defence reads their set (Mini Rally, perimeter)', () => {
  it('a defender holds its base until it has read the set, then reads to its spot', () => {
    const t = homeTeam();
    setOutside(t);
    t.run(0.1);
    const S = t.brain('S');
    expect(S.job).toBe('base');
    expect(S.spot).toEqual(t.team.formSpot('defense', 'S'));
    expect(t.brain('OH1').job).toBe('block');
    t.run(0.6);
    // the setter at right back digs the line; the libero at left back digs cross; the back-row outside plays middle back
    expect(S.spot.x).toBeCloseTo(W - D.lineIn, 1);
    expect(S.spot.z).toBeCloseTo(D.digDepth, 1);
    expect(t.brain('L').spot.x).toBeLessThan(0);
    expect(t.brain('L').spot.z).toBeCloseTo(D.digDepth, 1);
    expect(t.brain('OH2').spot.z).toBeCloseTo(D.middleBack, 1);
    // the off-blocker leaves the net; the pin blocker stays to block
    expect(t.brain('OH1').job).toBe('base');
    expect(t.brain('OH1').spot.x).toBeCloseTo(-(W - D.offIn), 1);
    expect(t.brain('OH1').spot.z).toBeCloseTo(D.offOff, 1);
    expect(t.brain('OPP').job).toBe('block');
  });

  it('the defenders are on their way before the hit: the setter is most of the way to the line', () => {
    const t = homeTeam();
    const S = t.team.players.get('S')!;
    const startX = S.pos.x;
    setOutside(t);
    t.run(1.1);
    const target = W - D.lineIn;
    expect((S.pos.x - startX) / (target - startX)).toBeGreaterThan(0.6);
  });

  it('after the hit the defenders stay where they read to: nobody runs back to base', () => {
    const t = homeTeam();
    setOutside(t);
    t.run(1.1);
    const lane = laneFor('OH', -1);
    t.spike({ x: lane.x, y: 3.25, z: lane.z }, { x: -2.6, y: 0.1, z: 6.5 }, 22);
    t.run(0.2);
    const S = t.brain('S');
    expect(S.job).toBe('base');
    expect(S.spot.x).toBeCloseTo(W - D.lineIn, 1);
    expect(S.spot.z).toBeCloseTo(D.digDepth, 1);
  });

  it('a hard hit is chased only a reaction time after it', () => {
    const t = homeTeam();
    setOutside(t);
    t.run(1.1);
    const lane = laneFor('OH', -1);
    t.spike({ x: lane.x, y: 3.25, z: lane.z }, { x: -1.0, y: 0.1, z: 7.0 }, 20);
    const hitT = t.s.sim.simTime;
    // the moment the digger steers for the ball, or dives for it (it may still be moving from its read when the hit comes)
    let steers = -1;
    let receiver: Athlete | null = null;
    let ticksSince = 0;
    t.run(0.6, () => {
      // (the players step before the coordinator picks the digger: judge from the tick after)
      if (receiver) ticksSince++;
      receiver ??= t.team.receiver;
      if (
        receiver &&
        ticksSince > 0 &&
        steers < 0 &&
        (Math.hypot(receiver.cmd.moveX, receiver.cmd.moveZ) > 0.05 || receiver.state === 'dive')
      )
        steers = t.s.sim.simTime - hitT;
    });
    expect(receiver).not.toBeNull();
    expect(steers).toBeGreaterThan(D.hitReact - 3 * D.hitReactSd);
    expect(steers).toBeLessThan(D.hitReact + 0.2);
  });
});

describe('going for every ball (Mini Rally)', () => {
  it('a ball off our own block flying out over our side is still chased: out, it is their point', () => {
    const t = homeTeam();
    const mb = t.team.players.get('MB')!;
    // off the block's outside hand, wide of our sideline
    t.touch('block', 1, { x: 3.6, y: 3.0, z: 0.3 }, { x: W + 2.0, y: 0, z: 5.0 }, 4.2, mb);
    t.run(0.4);
    const r = t.team.receiver;
    expect(r).not.toBeNull();
    expect(r).not.toBe(mb);
    expect(t.team.brains.get(r!)!.job).toBe('receive');
  });

  it('a ball out of reach on foot: the defender sent runs at it and dives for it, and a team-mate runs with them, to where the dive pops it up (toward the middle)', () => {
    const t = homeTeam();
    lineHitter(t);
    setOutside(t);
    t.run(1.1);
    const lane = laneFor('OH', -1);
    // a roll shot over the block, dropping short into the open court 3.8 m from the cross digger, 1 s after the hit
    const L = t.team.players.get('L')!;
    const to = { x: L.pos.x + 3.8 * Math.sin(1.2), y: 0.1, z: L.pos.z - 3.8 * Math.cos(1.2) };
    t.touch('spike', -1, { x: lane.x, y: 3.25, z: lane.z }, to, 3.4);
    let dived: Athlete | null = null;
    let sentWhenDived: Athlete | null = null;
    let two = 0;
    let towardMiddle = false;
    const mid = { x: 0, z: COURT.halfLength / 2 };
    const fromMid = (q: { x: number; z: number }) => Math.hypot(q.x - mid.x, q.z - mid.z);
    // (a ball at the very edge of their reach: whether it is one they get to or one they throw
    // themselves at anyway, they go to the floor for it)
    const anyway = AI.dive.anyway;
    AI.dive.anyway = 1;
    t.run(1.0, () => {
      const r = t.team.receiver;
      if (!dived) {
        dived = [...t.team.players.values()].find((a) => a.state === 'dive') ?? null;
        sentWhenDived = r;
      }
      if (!r) return;
      const runners = [...t.team.brains.values()].filter(
        (b) => b.athlete !== r && b.job === 'base' && Math.hypot(b.spot.x - to.x, b.spot.z - to.z) < 1.5,
      );
      two = Math.max(two, runners.length);
      if (runners.some((b) => fromMid(b.spot) < fromMid(to) - 0.5)) towardMiddle = true;
    });
    AI.dive.anyway = anyway;
    expect(dived).not.toBeNull();
    expect(dived).toBe(sentWhenDived);
    expect(two).toBeGreaterThan(0);
    expect(towardMiddle).toBe(true);
  });
});

describe('who takes the ball (Mini Rally)', () => {
  /** our receive formation (or defence), `user` marked as the user, and their serve (or roll shot) down at `to` */
  const ballAt = (to: { x: number; z: number }, user: Slot | null, serve = true) => {
    const t = homeTeam({ you: user ?? undefined });
    t.place(serve ? 'receive' : 'defense');
    if (serve) t.touch('serve', -1, { x: 0, y: 2.8, z: -10 }, { x: to.x, y: 0.75, z: to.z }, 4.0);
    else t.touch('spike', -1, { x: -4.0, y: 3.25, z: -0.9 }, { x: to.x, y: 0.75, z: to.z }, 3.6);
    t.run(0.05);
    return t;
  };

  it('a serve that drops next to the middle passer is theirs, even when you are the libero beside them', () => {
    // 0.6 m from the back-row outside, 1.9 m from the libero
    const t = ballAt({ x: 0.6, z: 6.4 }, 'L');
    expect(t.team.receiver).toBe(t.team.players.get('OH2'));
  });

  it('a serve coming down on you is yours, even when the libero could run over and take it: serve receive goes by lanes', () => {
    // a high, slow float 0.2 m from you (the outside, in left back), 4.8 m from the libero
    const t = homeTeam({ you: 'OH1' });
    t.place('receive');
    const you = t.team.players.get('OH1')!;
    t.touch('serve', -1, { x: 0, y: 2.8, z: -10 }, { x: -2.3, y: 0.75, z: 6.1 }, 6.0);
    t.run(0.05);
    expect(t.team.receiver).toBe(you);
    t.run(0.3);
    expect(t.team.receiver).toBe(you);
  });

  it("a serve in the seam between two passers is the libero's", () => {
    const t = ballAt({ x: 1.25, z: 6.35 }, null);
    expect(t.team.receiver).toBe(t.team.players.get('L'));
  });

  it("a roll shot dropping a metre from the deep defender is theirs, not the libero's 2.6 m away, even when you are the libero", () => {
    const t = ballAt({ x: -0.9, z: 8.3 }, 'L', false);
    expect(t.team.receiver).toBe(t.team.players.get('OH2'));
  });

  it("in defence a ball an AI libero gets to in time is the libero's, even a metre from a team-mate; one it can't reach is not", () => {
    // the same roll shot: the libero gets there, so it takes it
    const t = ballAt({ x: -0.9, z: 8.3 }, null, false);
    const L = t.team.players.get('L')!;
    expect(t.team.reachTime(L, { x: -0.9, y: 0.75, z: 8.3 })).toBeGreaterThan(
      t.team.reachTime(t.team.players.get('OH2')!, { x: -0.9, y: 0.75, z: 8.3 }),
    );
    expect(t.team.receiver).toBe(L);
    // a hard, flat one at the deep defender: the libero's feet can't get there, the one it comes at digs it
    const q = homeTeam();
    q.team.place('defense');
    const deep = q.team.players.get('OH2')!;
    // (the deep defender stepped up to where it comes down)
    deep.place(0, 6.6, 0);
    q.spike({ x: -4.0, y: 3.25, z: -0.9 }, { x: 0, y: 0.75, z: 6.6 }, 22);
    q.run(0.05);
    expect(q.team.receiver).toBe(deep);
  });

  describe('the libero calls the ball it takes ("MINE!")', () => {
    /** their free ball (a bump over) or their tip comes down at `to`; the libero placed at `L` */
    const over = (kind: TouchKind, to: { x: number; z: number }, L: { x: number; z: number }) => {
      const t = homeTeam();
      t.team.place('defense');
      t.team.players.get('L')!.place(L.x, L.z, 0);
      t.touch(kind, -1, { x: 0, y: 1.0, z: -5 }, { x: to.x, y: 0.75, z: to.z }, 5.5);
      t.run(0.05);
      return { t, L: t.team.players.get('L')! };
    };

    it('a free ball it takes, even one in its own lap', () => {
      const { t, L } = over('pass', { x: -2.6, z: 6.0 }, { x: -2.9, z: 6.2 });
      expect(t.team.receiver).toBe(L);
      expect(t.team.liberoCall).toBe(t.ball.lastTouch);
    });

    it('a ball it takes from a team-mate who would get there first', () => {
      // their tip drops 1 m in front of the deep defender, 2.7 m from the libero: the libero gets there in time
      const { t, L } = over('tip', { x: -0.5, z: 7.6 }, { x: -2.9, z: 6.2 });
      const p = { x: -0.5, y: 0.75, z: 7.6 };
      expect(t.team.reachTime(t.team.players.get('OH2')!, p)).toBeLessThan(t.team.reachTime(L, p));
      expect(t.team.receiver).toBe(L);
      expect(t.team.liberoCall).toBe(t.ball.lastTouch);
    });

    it('not a ball of theirs that comes to it first: nobody else was going', () => {
      const { t, L } = over('tip', { x: -2.6, z: 6.0 }, { x: -2.9, z: 6.2 });
      expect(t.team.receiver).toBe(L);
      expect(t.team.liberoCall).toBeNull();
    });

    it('not a hard-driven ball: one down too soon to call is not reached for past whoever it comes at (the libero takes it only if its feet get there)', () => {
      const t = homeTeam();
      t.team.place('defense');
      const deep = t.team.players.get('OH2')!;
      deep.place(-1.4, 6.6, 0);
      // the libero 1.5 m from it: its arms would get there, its feet would not
      t.team.players.get('L')!.place(-2.9, 6.6, 0);
      t.spike({ x: -4.0, y: 3.25, z: -0.9 }, { x: -1.4, y: 0.75, z: 6.6 }, 22);
      t.run(0.02);
      expect(t.team.receiver).toBe(deep);
      expect(t.team.liberoCall).toBeNull();
    });

    it('never when you are the libero', () => {
      const t = homeTeam({ you: 'L' });
      t.place('defense');
      t.touch('pass', -1, { x: 0, y: 1.0, z: -5 }, { x: -2.6, y: 0.75, z: 6.0 }, 5.5);
      t.run(0.05);
      expect(t.team.liberoCall).toBeNull();
    });
  });

  it('serve receive goes by lanes whoever the libero is: a serve in front of the passer beside it is theirs', () => {
    const t = ballAt({ x: 0.6, z: 6.4 }, null);
    expect(t.team.receiver).toBe(t.team.players.get('OH2'));
  });

  /** their block sends our attack back down at (-1.8, 3.0); you (our outside) 0.6 m from it, the libero at `L` */
  const offTheirBlock = (L: { x: number; z: number }, apex = 3.6) => {
    const t = homeTeam({ you: 'OH1' });
    t.place('defense');
    const you = t.team.players.get('OH1')!;
    you.place(-1.9, 2.4, 0);
    t.team.players.get('L')!.place(L.x, L.z, 0);
    t.touch('block', -1, { x: -1.5, y: 3.0, z: -0.2 }, { x: -1.8, y: 0.75, z: 3.0 }, apex);
    t.run(0.05);
    return { t, you, L: t.team.players.get('L')! };
  };

  it("a ball off their block that the libero, covering, gets to is the libero's, even with you nearer", () => {
    const { t, L } = offTheirBlock({ x: -0.6, z: 3.6 });
    expect(t.team.receiver).toBe(L);
  });

  it('the libero coming in to a ball off the block someone else was sent to calls it and takes it', () => {
    const { t, you, L } = offTheirBlock({ x: 2.5, z: 7.5 });
    expect(t.team.receiver).toBe(you);
    L.place(-0.6, 3.6, 0);
    t.run(0.05);
    expect(t.team.receiver).toBe(L);
  });

  it('a ball first called yours that the libero takes is always called MINE!, however little time is left', () => {
    // a low ball off their block (down in under `AI.pick.mine` s): too soon to call off an AI
    // team-mate, but you were told "Your ball!", so the libero taking it must say so
    const { t, you, L } = offTheirBlock({ x: 2.5, z: 7.5 }, 3.0);
    expect(t.team.receiver).toBe(you);
    L.place(-0.9, 3.4, 0);
    t.run(0.05);
    expect(t.team.receiver).toBe(L);
    expect(t.team.liberoCall).toBe(t.ball.lastTouch);
  });
});

describe('moving with the play: the situations (Mini Rally)', () => {
  const BACK = ['S', 'L', 'OH2'] as const;
  const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

  it('a team is always in one situation, read from the ball', () => {
    const t = homeTeam();
    expect(t.team.situation).toBe('dead');
    t.touch('serve', -1, { x: 2, y: 2.6, z: -9 }, { x: -1, y: 0.8, z: 6 }, 3.6);
    t.run(0.05);
    expect(t.team.situation).toBe('theirServe');
    const L = t.team.players.get('L')!;
    t.touch('pass', 1, { x: -1, y: 0.8, z: 6 }, { x: SETTER_SPOT.x, y: 2.4, z: SETTER_SPOT.z }, 4.6, L);
    t.run(0.05);
    expect(t.team.situation).toBe('ourFirstBall');
    t.touch('set', 1, { x: SETTER_SPOT.x, y: 2.4, z: SETTER_SPOT.z }, { x: -3.6, y: 3.2, z: 0.8 }, 5.5, t.team.players.get('S')!);
    t.run(0.05);
    expect(t.team.situation).toBe('ourSet');
    t.touch('spike', 1, { x: -3.6, y: 3.2, z: 0.8 }, { x: 2, y: 0.2, z: -6 }, 3.3, t.team.players.get('OH1')!);
    t.run(0.05);
    expect(t.team.situation).toBe('ourAttack');
    t.touch('dig', -1, { x: 2, y: 0.6, z: -6 }, { x: 1, y: 2.4, z: -1 }, 4.5);
    t.run(0.05);
    expect(t.team.situation).toBe('theirFirstBall');
    t.touch('set', -1, { x: 1, y: 2.4, z: -1 }, { x: 3.6, y: 3.2, z: -0.8 }, 5.5);
    t.run(0.05);
    expect(t.team.situation).toBe('theirSet');
    t.spike({ x: 3.6, y: 3.2, z: -0.8 }, { x: -1.5, y: 0.1, z: 5.5 }, 22);
    t.run(0.02);
    expect(t.team.situation).toBe('theirHit');
    // off our block and down on our side: ours to keep alive
    t.touch('block', 1, { x: 3.4, y: 2.8, z: 0.3 }, { x: 1, y: 0.8, z: 5 }, 4.2, t.team.players.get('OPP')!);
    t.run(0.05);
    expect(t.team.situation).toBe('scramble');
    // their ball coming over without an attack
    t.touch('pass', -1, { x: 0, y: 1.0, z: -5 }, { x: -1.5, y: 0.8, z: 5.5 }, 5.5);
    t.run(0.05);
    expect(t.team.situation).toBe('theirFree');
  });

  it('base defence moves along the net with the ball while they have it, and the read starts from there when they set it', () => {
    for (const bx of [3, -3]) {
      const t = homeTeam();
      t.touch('dig', -1, { x: bx, y: 0.8, z: -6 }, { x: bx, y: 2.4, z: -2 }, 4.5);
      t.run(0.2);
      for (const slot of BACK) {
        const book = t.team.formSpot('defense', slot);
        const spot = t.brain(slot).spot;
        // towards the ball's side, a step or so, no deeper and no shallower
        expect(Math.sign(spot.x - book.x), slot).toBe(Math.sign(bx));
        expect(Math.abs(spot.x - book.x), slot).toBeGreaterThan(0.4);
        expect(Math.abs(spot.x - book.x), slot).toBeLessThanOrEqual(AI.sit.ballSideMax + 1e-9);
        expect(spot.z, slot).toBeCloseTo(book.z, 9);
      }
      // their set goes up: nobody steps back to the book spot before reading it
      const before = BACK.map((slot) => ({ ...t.brain(slot).spot }));
      t.touch('set', -1, { x: bx, y: 2.4, z: -2 }, { x: bx, y: 3.25, z: -0.8 }, 5.5);
      t.run(0.05);
      BACK.forEach((slot, i) => expect(dist(t.brain(slot).spot, before[i]), slot).toBeLessThan(0.05));
    }
  });

  it('a pin blocker fronts its hitter once they have the ball', () => {
    // (their team is on the court; their outside is a player whose hands do nothing, so it stands where it is put)
    const t = homeTeam({ away: { you: 'OH1' } });
    const away = t.away!;
    // their opposite (on our left) wide at its approach start, their outside (on our right) inside
    const wide = away.players.get('OPP')!;
    wide.place(-4.6, -3.4, Math.PI);
    const inside = away.players.get('OH1')!;
    inside.place(2.4, -3.6, Math.PI);
    t.touch('dig', -1, { x: 0, y: 0.8, z: -6 }, { x: 0, y: 2.4, z: -2 }, 4.5, away.players.get('L')!);
    t.run(0.2);
    const left = t.brain('OH1').spot;
    const right = t.brain('OPP').spot;
    // out to (at most `frontMax`) the wide hitter's line, in to the inside one's; still at the net
    expect(left.x).toBeCloseTo(-AI.sit.frontMax, 9);
    expect(right.x).toBeCloseTo(2.4, 9);
    expect(left.z).toBeLessThan(1);
    expect(right.z).toBeLessThan(1);
  });

  it('their serve, once read: the setter is off to the target, the front row to their approaches, and the passer next to the receiver backs it up', () => {
    const t = homeTeam();
    t.team.place('receive');
    t.touch('serve', -1, { x: 2, y: 2.6, z: -9 }, { x: -2.4, y: 0.8, z: 6.2 }, 3.6);
    t.run(0.1);
    // not before it is read
    expect(t.brain('S').spot).not.toEqual(t.team.formSpot('offense', 'S'));
    t.run(AI.sit.serveRead);
    const got = (['OH1', 'OH2', 'L'] as const).find((slot) => t.brain(slot).job === 'receive')!;
    expect(got).toBeDefined();
    expect(t.brain('S').spot).toEqual(t.team.formSpot('offense', 'S'));
    for (const slot of ['MB', 'OPP'] as const) expect(t.brain(slot).job, slot).toBe('attack');
    const ball = t.team.focus!;
    for (const slot of ['OH2', 'L'] as const) {
      if (slot === got) continue;
      const book = t.team.formSpot('receive', slot);
      const spot = t.brain(slot).spot;
      // nearer the ball than the book spot, but not on top of the receiver
      expect(dist(spot, ball), slot).toBeLessThan(dist(book, ball) - 0.3);
      expect(dist(spot, ball), slot).toBeGreaterThanOrEqual(AI.sit.backUpKeep - 1e-9);
    }
  });

  it('our first ball called out of system: the hitters wait deeper for the high ball, and the back row follows the pass', () => {
    const t = homeTeam();
    t.team.place('offense');
    const L = t.team.players.get('L')!;
    // a pass 3 m off the net, out on the left
    t.touch('pass', 1, { x: L.pos.x, y: 0.8, z: L.pos.z }, { x: -2.5, y: 2.4, z: 3.2 }, 4.8, L);
    t.run(AI.setterRead + 0.2);
    expect(t.team.read?.call).toBe('out');
    const lane = laneFor('OPP', 1);
    expect(t.brain('OPP').hitter!.holdSpot!.z).toBeCloseTo(lane.sz + AI.sit.outDeep, 9);
    // in system they wait at their approach start
    const good = homeTeam();
    good.team.place('offense');
    const l2 = good.team.players.get('L')!;
    good.touch('pass', 1, { x: l2.pos.x, y: 0.8, z: l2.pos.z }, { x: SETTER_SPOT.x, y: 2.4, z: SETTER_SPOT.z }, 4.6, l2);
    good.run(AI.setterRead + 0.2);
    expect(good.team.read?.call).toBe('in');
    expect(good.brain('OPP').hitter!.holdSpot).toBeNull();
  });

  it('a scramble: those not playing the ball close on where it comes down, without crowding whoever plays it', () => {
    const t = homeTeam();
    // off our block, down deep in our right corner
    t.touch('block', 1, { x: 0.3, y: 2.7, z: 0.3 }, { x: 3.4, y: 0.8, z: 7.6 }, 4.4, t.team.players.get('MB')!);
    t.run(0.1);
    expect(t.team.situation).toBe('scramble');
    const ball = t.team.focus!;
    let followers = 0;
    for (const slot of BACK) {
      const b = t.brain(slot);
      if (b.job !== 'base') continue;
      const book = t.team.formSpot('defense', slot);
      if (dist(book, ball) <= AI.sit.chaseKeep) continue;
      followers++;
      expect(dist(b.spot, ball), slot).toBeLessThan(dist(book, ball) - 0.3);
      expect(dist(b.spot, ball), slot).toBeGreaterThanOrEqual(AI.sit.chaseKeep - 1e-9);
    }
    expect(followers).toBeGreaterThan(0);
  });

  it('every player stands a little off the book spot, their own habit for the rally: no two rallies line up the same', () => {
    AI.sit.personal = 0.15;
    const t = homeTeam();
    const line = () => SLOTS.map((slot) => ({ ...t.team.anchor('defense', slot, t.team.players.get(slot)!) }));
    const one = line();
    t.team.place('defense');
    const two = line();
    AI.sit.personal = 0;
    SLOTS.forEach((slot, i) => {
      const book = t.team.formSpot('defense', slot);
      expect(dist(one[i], book), slot).toBeGreaterThan(0);
      expect(dist(one[i], book), slot).toBeLessThan(0.9);
      expect(dist(one[i], two[i]), slot).toBeGreaterThan(0);
    });
  });
});

describe('running a ball down (Mini Rally)', () => {
  const turned = (a: Athlete, to: { x: number; z: number }) =>
    Math.abs(wrapAngle((a.cmd.faceYaw ?? 99) - yawFromDir(to.x - a.pos.x, to.z - a.pos.z)));

  it('a backup running down a second ball faces where it is going, not the way a setter stands; under the ball it squares up to set', () => {
    // the setter is away at the net: the libero's ball, down by the end line 2.5 m behind it
    const far = homeTeam();
    far.team.place('offense');
    const oh2 = far.team.players.get('OH2')!;
    const L = far.team.players.get('L')!;
    far.team.players.get('S')!.place(4.0, 0.8, 0);
    const to = { x: L.pos.x - 0.6, z: L.pos.z + 2.5 };
    far.touch('pass', 1, { x: oh2.pos.x, y: 0.8, z: oh2.pos.z }, { x: to.x, y: 0.75, z: to.z }, 4.6, oh2);
    far.run(0.1);
    expect(far.brain('L').job).toBe('set');
    expect(turned(L, to)).toBeLessThan(0.5);
    // the same ball coming down right by it: it stands as a setter does, side on to the net
    const near = homeTeam();
    near.team.place('offense');
    const l2 = near.team.players.get('L')!;
    near.team.players.get('S')!.place(4.0, 0.8, 0);
    const o2 = near.team.players.get('OH2')!;
    near.touch('pass', 1, { x: o2.pos.x, y: 0.8, z: o2.pos.z }, { x: l2.pos.x + 0.2, y: 0.75, z: l2.pos.z + 0.3 }, 4.6, o2);
    near.run(0.1);
    expect(near.brain('L').job).toBe('set');
    expect(l2.cmd.faceYaw).toBeCloseTo(Math.PI / 2, 5);
  });

  it('a coverer sent running for a ball off the block is up and running, not low; the ones still watching stay low', () => {
    const t = homeTeam();
    for (const b of t.team.brains.values()) b.job = 'cover';
    t.s.step();
    for (const b of t.team.brains.values()) expect(b.athlete.low).toBe(1);
    // off their block, fast over the cover and down in our deep right corner
    t.touch('block', -1, { x: 0, y: 2.9, z: 0.2 }, { x: 3.8, y: 0.75, z: 8.4 }, 3.2, t.theirs);
    t.run(0.3);
    const sent = [...t.team.brains.values()].find((b) => b.job === 'receive')!;
    expect(sent).toBeDefined();
    expect(sent.athlete.cmd.sprint).toBe(true);
    expect(sent.athlete.low).toBe(0);
    expect(t.team.players.get('MB')!.low).toBe(1);
  });

  it('the setter releasing to the net, and a team-mate running with a diver, are in a hurry: they turn and run', () => {
    const t = homeTeam();
    t.touch('pass', -1, { x: 0, y: 1.0, z: -5 }, { x: -1.5, y: 0.8, z: 5.5 }, 5.5);
    t.run(0.1 + AI.transition.read);
    const S = t.team.players.get('S')!;
    expect(t.brain('S').run).toBe(true);
    expect(turned(S, t.team.formSpot('offense', 'S'))).toBeLessThan(0.5);
    // a defender just holding its base shuffles, facing the net
    expect(t.brain('OH2').run).toBe(false);
  });

  it('a ball out of reach even at full stretch: now and then they dive for it anyway, and never when it is hopelessly far', () => {
    /** the libero is sent for a ball dropping `d` m in front of it: does it dive? */
    const dives = (anyway: number, d: number) => {
      const keep = AI.dive.anyway;
      AI.dive.anyway = anyway;
      const t = homeTeam();
      const L = t.team.players.get('L')!;
      L.place(0, 8.5, 0);
      t.put({ x: 0, y: 2.0, z: 8.5 - d }, { x: 0, y: 0, z: 0 }, t.theirs, 'spike', -1);
      // (seen a while ago: the run is what is measured here)
      t.ball.lastTouch!.t -= 1;
      const dived = t.sent('L', 'receive', 0.9, () => L.state === 'dive');
      AI.dive.anyway = keep;
      return dived;
    };
    // between "they get it" and "hopeless" there are balls only the will to go gets a dive for
    const gaps = [3.5, 3.75, 4, 4.25, 4.5, 4.75, 5, 5.25, 5.5, 5.75, 6];
    const only = gaps.filter((d) => dives(1, d) && !dives(0, d));
    expect(only.length).toBeGreaterThan(0);
    // far beyond `anywayFar` nobody throws themselves at it
    expect(dives(1, 8.4)).toBe(false);
  });

  it('a ball only one arm reaches at full stretch is dived for, not left: a scrape still keeps it alive (CONTACT.diveOut.reach)', () => {
    // 4 m in front of the libero, dropping from 2 m: past both arms at the end of the dive, within one
    const t = homeTeam();
    const L = t.team.players.get('L')!;
    L.place(0, 8.5, 0);
    t.put({ x: 0, y: 2.0, z: 8.5 - 4 }, { x: 0, y: 0, z: 0 }, t.theirs, 'spike', -1);
    t.ball.lastTouch!.t -= 1;
    const keep = AI.dive.anyway;
    // (no throwing themselves at a hopeless one: this one is reached)
    AI.dive.anyway = 0;
    let dived: boolean;
    try {
      dived = t.sent('L', 'receive', 0.9, () => L.state === 'dive');
    } finally {
      AI.dive.anyway = keep;
    }
    expect(dived).toBe(true);
  });
});

describe('blocking from the net (Mini Rally)', () => {
  /** our right-side blocker starts `off` m off the net as their outside is set; returns how far off the net it was when it went up (NaN: it never did) */
  const blockFrom = (off: number) => {
    const t = homeTeam();
    const opp = t.team.players.get('OPP')!;
    opp.place(3.4, off, 0);
    setOutside(t);
    let wentUp = NaN;
    t.run(1.6, () => {
      if (Number.isNaN(wentUp) && opp.action?.kind === 'block') wentUp = Math.abs(opp.pos.z);
    });
    return wentUp;
  };

  it('a pin blocker at the net goes up there', () => {
    expect(blockFrom(0.7)).toBeLessThanOrEqual(AI.blockNet);
  });

  it('a pin blocker caught off the net runs in first: it never goes up from out in the court', () => {
    for (const off of [1.6, 2.2, 3.4]) {
      const from = blockFrom(off);
      // (late from the net, or not at all)
      if (!Number.isNaN(from)) expect(from, `from ${off} m`).toBeLessThanOrEqual(AI.blockNet);
    }
    expect(blockFrom(1.6)).toBeLessThanOrEqual(AI.blockNet);
  });
});

describe('the second ball (Mini Rally)', () => {
  it('our pass going over the net: the setter reads the overpass, stays, calls nothing; the front row waits at the net', () => {
    const t = homeTeam();
    t.team.place('offense');
    const L = t.team.players.get('L')!;
    // the libero's pass sails over the net, coming down 3 m into their court
    t.touch('pass', 1, { x: L.pos.x, y: 0.8, z: L.pos.z }, { x: 0.5, y: 0.5, z: -3 }, 4.6, L);
    t.run(AI.setterRead + 0.2);
    expect(t.team.overpass(t.s.sim)).toBe(true);
    expect(t.brain('S').job).not.toBe('set');
    expect(t.team.read).toBeNull();
    for (const slot of ['OH1', 'MB', 'OPP'] as const) expect(t.brain(slot).job).toBe('block');
  });

  it('the same pass to the setter is set as usual', () => {
    const t = homeTeam();
    t.team.place('offense');
    const L = t.team.players.get('L')!;
    t.touch('pass', 1, { x: L.pos.x, y: 0.8, z: L.pos.z }, { x: SETTER_SPOT.x, y: 2.4, z: SETTER_SPOT.z }, 4.6, L);
    t.run(AI.setterRead + 0.2);
    expect(t.team.overpass(t.s.sim)).toBe(false);
    expect(t.brain('S').job).toBe('set');
  });

  it('a pass the setter calls HELP on, nearest to you: it is your ball (someone always plays it)', () => {
    const t = homeTeam({ you: 'OH2' });
    t.place('offense');
    const L = t.team.players.get('L')!;
    const you = t.team.players.get('OH2')!;
    you.place(-3.4, 8.0, 0);
    // a shanked pass, deep into our left corner: the setter at the net can't get there
    t.touch('pass', 1, { x: L.pos.x, y: 0.8, z: L.pos.z }, { x: -3.8, y: 0.75, z: 8.2 }, 5.5, L);
    t.run(AI.setterRead + 0.2);
    expect(t.team.read?.call).toBe('help');
    expect(t.team.freeBall(t.s.sim)).toBe(you);
  });

  it("a shanked dig flying metres out of everyone's reach is their point: the setter calls nothing on it", () => {
    const t = homeTeam();
    t.team.place('offense');
    const L = t.team.players.get('L')!;
    // off the arms and away, down 8 m outside our left sideline
    t.touch('dig', 1, { x: L.pos.x, y: 0.8, z: L.pos.z }, { x: -13, y: 0.75, z: 2.2 }, 4.0, L);
    t.run(AI.setterRead + 0.2);
    expect(t.team.read).toBeNull();
  });

  /** a pass from the back-row outside the setter (away right, at the net) can't get to, down at `to` */
  const helpBall = (to: { x: number; z: number }, apex: number) => {
    const t = homeTeam();
    t.team.place('offense');
    const oh2 = t.team.players.get('OH2')!;
    t.team.players.get('S')!.place(4.0, 0.8, 0);
    t.touch('pass', 1, { x: oh2.pos.x, y: 0.8, z: oh2.pos.z }, { x: to.x, y: 0.75, z: to.z }, apex, oh2);
    t.run(AI.setterRead + 0.2);
    return { t, L: t.team.players.get('L')! };
  };

  it('a pass the setter calls HELP on that the libero gets to a few metres off the net: the libero sets it, a high ball to a pin', () => {
    const { t, L } = helpBall({ x: -2.6, z: 4.0 }, 3.6);
    expect(t.team.read?.call).toBe('help');
    expect(t.brain('L').job).toBe('set');
    expect(t.team.secondBy).toBe(L);
    expect(t.team.freeBall(t.s.sim)).toBeNull();
  });

  it('a shanked pass the libero runs down by the end line is still set to a pin: a much rougher set than one from a few metres off the net', () => {
    const near = helpBall({ x: -2.6, z: 4.0 }, 3.6);
    const far = helpBall({ x: -2.6, z: 8.3 }, 3.6);
    expect(far.t.team.read?.call).toBe('help');
    expect(far.t.brain('L').job).toBe('set');
    expect(far.t.team.secondBy).toBe(far.L);
    expect(far.t.team.freeBall(far.t.s.sim)).toBeNull();
    expect(far.t.brain('L').setter.sloppy).toBeGreaterThan(near.t.brain('L').setter.sloppy + 0.3);
  });

  it('a HELP ball the libero cannot get to either: whoever is closest and gets under it in time sets it', () => {
    const t = homeTeam();
    t.team.place('offense');
    const oh2 = t.team.players.get('OH2')!;
    t.team.players.get('S')!.place(4.0, 0.8, 0);
    // the libero is away in the far corner; the pass comes down by the left-side hitter
    t.team.players.get('L')!.place(4.0, 8.5, 0);
    const oh1 = t.team.players.get('OH1')!;
    t.touch('pass', 1, { x: oh2.pos.x, y: 0.8, z: oh2.pos.z }, { x: oh1.pos.x + 0.5, y: 0.75, z: oh1.pos.z + 0.5 }, 4.5, oh2);
    t.run(AI.setterRead + 0.2);
    expect(t.team.read?.call).toBe('help');
    expect(t.brain('OH1').job).toBe('set');
    expect(t.team.secondBy).toBe(oh1);
    expect(t.team.freeBall(t.s.sim)).toBeNull();
    // a hitter is no setter: never as clean as the libero's easiest
    expect(t.brain('OH1').setter.sloppy).toBeGreaterThanOrEqual(AI.backupSet.otherBase);
    // and the high ball goes to the other pin (the one setting it can't hit it)
    const call = t.team.callSet(t.s.sim, oh1);
    expect(call.hitter).toBe(t.team.players.get('OPP'));
  });

  it('a backup set is harder with less time, further from the setter spot, after a long run, most of all one away from the net', () => {
    const t = homeTeam();
    const L = t.team.players.get('L')!;
    const B = AI.backupSet;
    L.place(0, 5, 0);
    const at = (x: number, z: number) => ({ x, y: 2, z });
    const easy = t.team.backupDifficulty(L, 1.5, at(0.5, 4.2));
    expect(easy).toBe(B.base);
    expect(t.team.backupDifficulty(L, 0.3, at(0.5, 4.2))).toBeGreaterThan(easy);
    expect(t.team.backupDifficulty(L, 1.5, at(-2, 5.5))).toBeGreaterThan(easy);
    // the same 5 m run: across the court, and back towards the end line
    L.place(0, 3.5, 0);
    const across = t.team.backupDifficulty(L, 1.5, at(-4, 0.5 + 3.0));
    L.place(1, 0.9, 0);
    const away = t.team.backupDifficulty(L, 1.5, at(1, 5.9));
    expect(away).toBeGreaterThan(across);
    // barely reached: no set is tried (over `noSet`)
    expect(t.team.backupDifficulty(L, 0.01, at(0.5, 4.2))).toBeGreaterThan(B.noSet);
    // anyone else starts from a rougher set than the libero
    expect(t.team.backupDifficulty(t.team.players.get('OH1')!, 1.5, at(-3.5, 3.5))).toBeGreaterThanOrEqual(B.otherBase);
  });

  it('a second ball nobody could set is just kept up: somewhere in our court off the net, never the same place or the same height twice; yours goes up high behind the 3 m line', () => {
    // (you are our outside at the net; the back-row outside is the team-mate who keeps it up)
    const { sim, rally } = miniRally('OH');
    const team = rally.home;
    const mate = team.players.get('OH2')!;
    team.touches = 1;
    // (played from deep in the left corner)
    sim.ball.launch({ x: -3.5, y: 0.7, z: 7.5 }, { x: 0, y: -2, z: 0 });
    sim.ball.lastTouch = { athlete: team.players.get('L')!, kind: 'dig', t: sim.simTime, side: 1 };
    const target = () => rally.passTarget(mate);
    const ups = Array.from({ length: 60 }, target);
    for (const T of ups) {
      expect(T.z).toBeGreaterThanOrEqual(AI.up.net);
      expect(T.z).toBeLessThanOrEqual(COURT.halfLength + AI.up.out);
      expect(Math.abs(T.x)).toBeLessThanOrEqual(W + AI.up.out);
      const d = Math.hypot(T.x + 3.5, T.z - 7.5);
      expect(d).toBeLessThanOrEqual(AI.up.far + 1e-6);
      expect(T.apex).toBeGreaterThanOrEqual(AI.up.apex[0]);
      expect(T.apex).toBeLessThanOrEqual(AI.up.apex[1]);
    }
    const span = (f: (T: (typeof ups)[number]) => number) => Math.max(...ups.map(f)) - Math.min(...ups.map(f));
    // (it used to be one spot, the middle of the court on the 3 m line, 5.2 m high)
    expect(span((T) => T.x)).toBeGreaterThan(3);
    expect(span((T) => T.z)).toBeGreaterThan(3);
    expect(span((T) => T.apex)).toBeGreaterThan(2);
    // most of them go towards the middle of the court, where the team is
    const mid = (q: { x: number; z: number }) => Math.hypot(q.x, q.z - COURT.halfLength / 2);
    expect(ups.filter((T) => mid(T) < mid({ x: -3.5, z: 7.5 })).length).toBeGreaterThan(40);
    const yours = rally.passTarget(sim.me);
    expect(yours.z).toBeGreaterThan(COURT.attackLine + AI.backRow.clear);
    expect(yours.z).toBeLessThan(4.5);
    expect(yours.apex).toBeGreaterThan(5);
  });

  it("an AI free ball over goes where they aren't: short over the net when they are deep, to a deep corner when they are up", () => {
    const { rally } = miniRally('S');
    const mate = rally.home.players.get('OH1')!;
    rally.home.touches = 2;
    const target = () => rally.passTarget(mate);
    // (their whole team, spread across their court)
    const xs = [-3, -1.8, -0.6, 0.6, 1.8, 3];
    const them = [...rally.away.players.values()];
    // all of them back, deep in their court
    them.forEach((a, i) => a.place(xs[i], -7.5, 0));
    for (let i = 0; i < 5; i++) {
      const T = target();
      expect(T.z).toBeGreaterThan(-3);
      expect(T.z).toBeLessThan(0);
    }
    // all of them up at the net
    them.forEach((a, i) => a.place(xs[i], -1.0, 0));
    for (let i = 0; i < 5; i++) {
      const T = target();
      expect(T.z).toBeLessThan(-6.5);
      expect(Math.abs(T.x)).toBeGreaterThan(2);
    }
  });
});

describe('a hard ball is played as well as it can be, and no better (Mini Rally)', () => {
  const avg = (m: number[]) => m.reduce((a, b) => a + b, 0) / m.length;
  /**
   * The libero behind the 3 m line with a setter's brain, the ball as hard to set as `sloppy`, and
   * its call: a high ball to the outside's pin (`toUser`: the outside is you). `drop` drops the
   * ball onto its hands and plays the step it is set in.
   */
  const liberoSetting = (sloppy: number, toUser = false) => {
    const s = scene({ seed: 3 });
    const lane = laneFor('OH', 1);
    const target = { x: lane.x, y: 3.25, z: lane.z };
    const hitter = s.athlete('OH', 1, { x: lane.sx, z: lane.sz }, { user: toUser });
    const passer = s.athlete('OH', 1, { x: 0, z: 8.5 });
    const L = s.athlete(
      'L',
      1,
      { x: 0, z: 4 },
      {
        brain: (a) => {
          const sb = new SetterBrain(a, { x: 0, z: 4 }, Math.PI / 2);
          sb.sloppy = sloppy;
          sb.call = () => ({ target, apex: target.y + lane.apexAbove, hitter });
          return sb;
        },
      },
    );
    const drop = () => {
      L.place(0, 4);
      s.send({ from: { x: -0.14, y: L.height + 0.22, z: 4 }, v: { x: 0, y: -2, z: 0 } }, { athlete: passer, kind: 'pass', side: 1 });
      s.step();
    };
    return { s, L, target, drop };
  };
  /**
   * `n` sets by the libero from behind the 3 m line to the outside's pin, `sloppy` as hard as the
   * ball made it: how far each passes from where it was meant to meet the hitter's hand
   */
  const liberoSets = (sloppy: number, toUser: boolean, n = 30) => {
    const { s, L, target, drop } = liberoSetting(sloppy, toUser);
    const misses: number[] = [];
    for (let i = 0; i < n; i++) {
      // the ball drops onto the libero's hands
      drop();
      expect(s.sim.ball.lastTouch?.athlete).toBe(L);
      // where the set comes down through the hitter's contact height
      const b = makeBall();
      Object.assign(b.p, s.sim.ball.state.p);
      Object.assign(b.v, s.sim.ball.state.v);
      for (let k = 0; k < 4 * SIM.hz && !(b.v.y < 0 && b.p.y < target.y); k++) stepBall(b, DT, s.sim.env, []);
      misses.push(Math.hypot(b.p.x - target.x, b.p.z - target.z));
    }
    return misses;
  };

  it("the libero's set off a hard ball misses its hitter: a hard ball can't be set perfectly", () => {
    expect(avg(liberoSets(0, false))).toBeLessThan(0.2);
    expect(avg(liberoSets(1, false))).toBeGreaterThan(0.6);
  });

  it('however rough, a backup set is still a high ball: it never comes off flat, a line drive over the net', () => {
    const { s, target, drop } = liberoSetting(1);
    for (let i = 0; i < 60; i++) {
      drop();
      const b = makeBall();
      Object.assign(b.p, s.sim.ball.state.p);
      Object.assign(b.v, s.sim.ball.state.v);
      let top = b.p.y;
      for (let k = 0; k < 2 * SIM.hz && b.v.y > 0; k++) {
        stepBall(b, DT, s.sim.env, []);
        top = Math.max(top, b.p.y);
      }
      // (the setter's own apex wobble on top: a few centimetres)
      expect(top).toBeGreaterThan(target.y + AI.backupSet.minApex - 0.25);
    }
  });

  it('a set to the user is always clean, however hard the ball was', () => {
    const toYou = liberoSets(1, true);
    expect(toYou).toEqual(liberoSets(0, true));
    expect(avg(toYou)).toBeLessThan(0.2);
  });

  it('an AI dive keeps the ball alive and no more: it pops up somewhere toward the middle, never the same place twice, not to the setter; your own dive still passes to the setter', () => {
    // (you are our libero; the team-mate who dives is the back-row outside)
    const { sim, rally } = miniRally('L');
    const mate = rally.home.players.get('OH2')!;
    const at = { x: 4, y: 0.35, z: 8 };
    sim.ball.launch(at, { x: 2, y: -4, z: 3 });
    sim.ball.lastTouch = { athlete: rally.away.players.get('OH1')!, kind: 'spike', t: sim.simTime, side: -1 };
    mate.state = 'dive';
    const target = () => rally.passTarget(mate);
    const ups = Array.from({ length: 40 }, target);
    const fromMid = (q: { x: number; z: number }) => Math.hypot(q.x, q.z - COURT.halfLength / 2);
    const U = AI.diveUp;
    for (const q of ups) {
      const d = Math.hypot(q.x - at.x, q.z - at.z);
      expect(d).toBeGreaterThanOrEqual(U.carry[0] - 1e-6);
      expect(d).toBeLessThanOrEqual(U.carry[1] + 1e-6);
      expect(fromMid(q)).toBeLessThan(fromMid(at));
      expect(q.apex).toBeGreaterThanOrEqual(at.y + U.apex[0]);
      expect(q.apex).toBeLessThanOrEqual(at.y + U.apex[1]);
    }
    expect(Math.max(...ups.map((q) => q.x)) - Math.min(...ups.map((q) => q.x))).toBeGreaterThan(1.5);
    expect(Math.max(...ups.map((q) => q.apex)) - Math.min(...ups.map((q) => q.apex))).toBeGreaterThan((U.apex[1] - U.apex[0]) / 2);
    sim.me.state = 'dive';
    const yours = rally.passTarget(sim.me);
    expect(yours.apex).toBeGreaterThan(at.y + U.apex[1] + 0.5);
    expect(Math.abs(yours.z)).toBeLessThan(2.5);
  });

  it('a setter who gets there after the ball has dropped below their hands digs it up (platform or dive) instead of watching it drop', () => {
    const t = homeTeam();
    const S = t.team.players.get('S')!;
    S.place(2, 2.5, 0);
    // a pass that got away: 1.5 m beside the setter, already under the hands, going away
    t.put({ x: 3.5, y: S.height - 0.1, z: 2.5 }, { x: 1.2, y: 0, z: 0 }, t.team.players.get('OH2')!);
    // (seen a while ago)
    t.ball.lastTouch!.t -= 1;
    const dug = t.sent('S', 'set', 0.6, () => S.action?.kind === 'pass' || S.state === 'dive');
    expect(dug).toBe(true);
  });
});

describe('early transition (Mini Rally)', () => {
  it('on their free ball the setter releases to the net and the front row leaves the net to approach', () => {
    const t = homeTeam();
    t.touch('pass', -1, { x: 0, y: 1.0, z: -5 }, { x: -1.5, y: 0.8, z: 5.5 }, 5.5);
    t.run(0.1 + AI.transition.read);
    const S = t.brain('S');
    expect(S.job).toBe('base');
    const target = t.team.formSpot('offense', 'S');
    expect(S.spot).toEqual(target);
    for (const slot of ['OH1', 'MB', 'OPP'] as const) expect(t.brain(slot).job, slot).toBe('attack');
  });

  /** their first ball, then their second: `second` ('set', or 'pass' for a bump-up) to their own 3 m line */
  const theirSecond = (second: 'set' | 'pass', o: Parameters<typeof homeTeam>[0] = {}) => {
    const t = homeTeam(o);
    // (with their team on the court, their libero digs and their setter plays the second)
    t.touch('dig', -1, { x: 0, y: 0.8, z: -6 }, { x: 1, y: 2.4, z: -2 }, 4.5, t.away?.players.get('L') ?? t.theirs);
    t.run(0.2);
    t.touch(second, -1, { x: 1, y: 1.0, z: -2 }, { x: 0.5, y: 0.8, z: -3.4 }, 5.0, t.away?.players.get('S') ?? t.theirs);
    return t;
  };

  it('their second ball is bumped up, not set: we call the free ball before it is sent over, the setter releases, the front row drops off the net, the back row splits the court', () => {
    const t = theirSecond('pass');
    // not before it has been read
    t.run(AI.transition.read - 0.05);
    expect(t.team.freeCall).toBe(false);
    for (const slot of ['OH1', 'MB', 'OPP'] as const) expect(t.brain(slot).job, slot).not.toBe('attack');
    t.run(0.15);
    expect(t.team.freeCall).toBe(true);
    expect(t.brain('S').spot).toEqual(t.team.formSpot('offense', 'S'));
    for (const slot of ['OH1', 'MB', 'OPP'] as const) {
      expect(t.brain(slot).job, slot).toBe('attack');
      expect(t.brain(slot).spot, slot).toEqual(t.team.formSpot('offense', slot));
    }
    // the libero in the middle of the court behind them, the back-row outside beside it
    const L = t.brain('L').spot;
    const oh2 = t.brain('OH2').spot;
    expect(Math.abs(L.x)).toBeLessThan(2);
    expect(L.z).toBeGreaterThan(4.5);
    expect(L.z).toBeLessThan(6.5);
    expect(oh2.x).toBeGreaterThan(L.x + 2);
    expect(oh2.z).toBeLessThan(7);
  });

  it('their second ball is a set: nobody leaves the net, it is an attack coming', () => {
    const t = theirSecond('set');
    t.run(AI.transition.read + 0.2);
    expect(t.team.freeCall).toBe(false);
    expect(t.brain('MB').job).toBe('block');
    for (const slot of ['OH1', 'MB', 'OPP'] as const) expect(t.brain(slot).job, slot).not.toBe('attack');
    expect(t.brain('S').spot).not.toEqual(t.team.formSpot('offense', 'S'));
  });

  it('a bumped second ball one of theirs goes up to hit after all: we stay in defence', () => {
    // (their outside is a player: under the ball as it is bumped up, they press jump and go up for it)
    const t = theirSecond('pass', { away: { you: 'OH1' } });
    const theirs = t.theirs;
    theirs.place(0.5, -3.6, Math.PI);
    t.s.sim.seatOf(theirs)!.hear(DT, { ...idleIntent(), yaw: Math.PI, pressed: ['jump'], held: ['jump'] });
    let up = true;
    t.run(AI.transition.read + 0.2, () => {
      up &&= theirs.state === 'load' || theirs.state === 'air';
    });
    // (off the floor from the bump until we have read it, and after)
    expect(up).toBe(true);
    expect(t.team.freeCall).toBe(false);
  });

  it('their free ball: the libero takes the one it gets to comfortably, even dropping in front of the middle; not one it would have to chase', () => {
    const t = homeTeam();
    const mb = t.team.players.get('MB')!;
    // a high, slow free ball coming down 3 m off the net near the middle: the middle is closest
    t.touch('pass', -1, { x: 0, y: 1.0, z: -5 }, { x: mb.pos.x - 0.6, y: 0.8, z: 3.0 }, 7.0);
    t.run(0.1);
    expect(t.brain('L').job).toBe('receive');
    expect(t.brain('MB').job).not.toBe('receive');
    // a flat, quick one to the far front corner: the libero would be late, the nearest player plays it
    const q = homeTeam();
    const opp = q.team.players.get('OPP')!;
    q.touch('pass', -1, { x: 3, y: 2.2, z: -1.5 }, { x: opp.pos.x + 0.3, y: 0.8, z: 1.6 }, 3.0);
    q.run(0.1);
    expect(q.brain('L').job).not.toBe('receive');
    expect(q.brain('OPP').job).toBe('receive');
  });

  it('the setter never takes their free ball: one dropping at its feet is passed by the next closest, and the setter sets it', () => {
    for (const at of [
      { x: 2.8, z: 6.2 },
      { x: 3.6, z: 7.6 },
      { x: 1.9, z: 5.2 },
    ]) {
      const t = homeTeam();
      const S = t.team.players.get('S')!;
      // (the setter is in right back in defence: a free ball right onto it, and around it)
      t.touch('pass', -1, { x: 0, y: 1.0, z: -5 }, { x: at.x, y: 0.8, z: at.z }, 6.5);
      t.run(0.6);
      expect(t.team.receiver, `${at.x}, ${at.z}`).not.toBeNull();
      expect(t.team.receiver).not.toBe(S);
      expect(t.brain('S').job).not.toBe('receive');
      // it is on its way to the net to set
      expect(t.brain('S').spot).toEqual(t.team.formSpot('offense', 'S'));
    }
    // (a quick, flat one dropping by the setter that nobody else gets to in time is the setter's:
    // dug, and someone else sets)
    const q = homeTeam();
    q.touch('pass', -1, { x: 0, y: 2.2, z: -1.5 }, { x: 3.6, y: 0.8, z: 7.6 }, 3.0);
    q.run(0.3);
    expect(q.team.receiver).toBe(q.team.players.get('S'));
    // (their attack at the setter is still the setter's to dig)
    const h = homeTeam();
    const S = h.team.players.get('S')!;
    h.spike({ x: -4, y: 3.25, z: -0.9 }, { x: S.pos.x, y: 0.1, z: S.pos.z }, 20);
    h.run(0.3);
    expect(h.team.receiver).toBe(S);
  });

  it('a free ball over from more than 6 m off the net is bumped, never played overhand; nearer the net it can be', () => {
    const forms = (z: number) => {
      const seen = new Set<string>();
      for (let seed = 1; seed <= 12; seed++) {
        const t = homeTeam({ seed });
        const L = t.team.players.get('L')!;
        const mate = t.team.players.get('OH2')!;
        L.place(0, z, 0);
        // our second ball, kept up high: it comes down slowly right onto the libero
        t.team.touches = 2;
        t.touch('pass', 1, { x: 2, y: 1.0, z: z - 2 }, { x: 0, y: 1.0, z: z - 0.1 }, 5.5, mate);
        const b = t.brain('L');
        t.run(1.6, () => {
          b.job = 'free';
          const act = L.action;
          if (act?.kind === 'pass') seen.add(act.form);
        });
      }
      return seen;
    };
    const deep = forms(AI.freeOver.bumpFrom + 1);
    expect(deep.has('platform')).toBe(true);
    expect(deep.has('hands')).toBe(false);
    expect(forms(AI.freeOver.bumpFrom - 2).has('hands')).toBe(true);
  });

  it('on a soft block the passer can get to easily, the setter releases; on a hard hit the setter releases and the front row leaves the net once it reads the hit', () => {
    const t = homeTeam();
    const mb = t.team.players.get('MB')!;
    // a soft block pops the ball up and back into our court
    t.touch('block', 1, { x: 0.3, y: 2.7, z: 0.3 }, { x: -1.5, y: 0.8, z: 5.0 }, 4.3, mb);
    t.run(0.1 + AI.transition.read);
    expect(t.brain('S').spot).toEqual(t.team.formSpot('offense', 'S'));

    const h = homeTeam();
    lineHitter(h);
    setOutside(h);
    h.run(1.1);
    const lane = laneFor('OH', -1);
    h.spike({ x: lane.x, y: 3.25, z: lane.z }, { x: -1.5, y: 0.1, z: 5.5 }, 22);
    h.run(D.hitReact - 3 * D.hitReactSd - 0.02);
    // nobody can leave before they have seen the hit
    for (const slot of ['OH1', 'MB', 'OPP'] as const) expect(h.brain(slot).job, slot).not.toBe('attack');
    h.run(6 * D.hitReactSd + 0.1);
    // the setter releases even on a hard hit (it reads the dig isn't its own)
    expect(h.brain('S').spot).toEqual(h.team.formSpot('offense', 'S'));
    // and the front row transitions off the net to approach (a blocker still in the air: as it lands)
    for (const slot of ['OH1', 'MB', 'OPP'] as const) {
      if (h.team.players.get(slot)!.airborne) continue;
      expect(h.brain(slot).job, slot).toBe('attack');
      expect(h.brain(slot).spot, slot).toEqual(h.team.formSpot('offense', slot));
    }
  });
});

describe('the front row transitions after every block (Mini Rally)', () => {
  it('blockers back on the floor after their hit got by leave the net for their approach starts', () => {
    const t = homeTeam();
    const front = ['OH1', 'MB', 'OPP'] as const;
    for (const slot of front) t.team.players.get(slot)!.place(t.team.formSpot('defense', slot).x, 0.7, 0);
    // their hit off our block's hands, dropping deep into our court
    const mb = t.team.players.get('MB')!;
    t.touch('block', 1, { x: 0.3, y: 3.0, z: 0.3 }, { x: 1.5, y: 0.1, z: 7.5 }, 3.4, mb);
    t.run(1.2);
    for (const slot of front) {
      const a = t.team.players.get(slot)!;
      if (a === t.team.receiver) continue;
      expect(t.brain(slot).job, slot).toBe('attack');
      // off the net, on the way to (or at) the approach start
      expect(Math.abs(a.pos.z), slot).toBeGreaterThan(1.8);
    }
  });

  it('a ball our block sends back over: the blockers stay at the net to block again', () => {
    const t = homeTeam();
    const front = ['OH1', 'MB', 'OPP'] as const;
    for (const slot of front) t.team.players.get(slot)!.place(t.team.formSpot('defense', slot).x, 0.7, 0);
    const mb = t.team.players.get('MB')!;
    t.touch('block', 1, { x: 0.3, y: 3.0, z: 0.1 }, { x: 0.5, y: 0.1, z: -4.0 }, 3.3, mb);
    t.run(0.8);
    for (const slot of front) {
      expect(t.brain(slot).job, slot).not.toBe('attack');
      expect(Math.abs(t.team.players.get(slot)!.pos.z), slot).toBeLessThan(1.2);
    }
  });

  it('a middle still at the net when the dig goes up backs off it before running the quick: no standing quick', () => {
    const t = homeTeam();
    const mb = t.team.players.get('MB')!;
    const L = t.team.players.get('L')!;
    mb.place(0, 0.7, 0);
    // our libero digs it high to the setter's spot: about 1.3 s in the air
    const at = { x: SETTER_SPOT.x, y: 2.4, z: SETTER_SPOT.z };
    t.touch('dig', 1, { x: L.pos.x, y: 0.7, z: L.pos.z }, at, 5.2, L);
    const hb = t.brain('MB').hitter!;
    let maxOff = 0;
    let started = -1;
    t.run(1.6, () => {
      if (hb.phase === 'ready') maxOff = Math.max(maxOff, Math.abs(mb.pos.z));
      if (started < 0 && hb.phase === 'approach' && mb.speed > 0.5) started = Math.abs(mb.pos.z);
    });
    expect(maxOff).toBeGreaterThanOrEqual(AI.transition.approachOff);
    expect(started).toBeGreaterThan(AI.transition.approachOff - 0.3);
  });
});

describe('covering our hitter (Mini Rally)', () => {
  /** our pass, then the setter's high ball to `slot`; run until the cover is set up */
  const setTo = (slot: 'OH1' | 'OPP') => {
    const t = homeTeam();
    t.team.place('offense');
    // (the set is sent here a moment after the pass, long before the pass would be at the setter:
    // the hitters' runs are timed to the pass, so they don't run their approaches here)
    for (const b of t.team.brains.values()) if (b.hitter) b.hitter.enabled = false;
    const S = t.team.players.get('S')!;
    const hitter = t.team.players.get(slot)!;
    const lane = laneFor(slot === 'OH1' ? 'OH' : 'OPP', 1);
    t.touch('pass', 1, { x: 0, y: 1, z: 6 }, { x: SETTER_SPOT.x, y: 2.4, z: SETTER_SPOT.z }, 4.5, t.team.players.get('L')!);
    t.run(0.05);
    t.touch('set', 1, { x: S.pos.x, y: 2.5, z: S.pos.z }, { x: lane.x, y: 3.25, z: lane.z }, 3.25 + lane.apexAbove, S);
    t.team.onSet(hitter);
    t.run(AI.cover.read - 0.04);
    // nobody covers before they have seen the set go
    expect([...t.team.brains.values()].filter((b) => b.job === 'cover')).toHaveLength(0);
    t.run(0.45);
    const covers = [...t.team.brains.values()].filter((b) => b.job === 'cover');
    expect(covers).toHaveLength(5);
    expect(covers.map((b) => b.athlete)).not.toContain(hitter);
    // everyone on the way there, and nobody in front of the middle at the net
    for (const b of covers) {
      expect(b.spot.z).toBeGreaterThanOrEqual(AI.cover.net - 0.01);
      const a = b.athlete;
      expect(Math.hypot(a.pos.x - b.spot.x, a.pos.z - b.spot.z) < 0.4 || a.speed > 1, t.team.slotOf(a)).toBe(true);
    }
    const spot = (s: Slot) => {
      expect(t.brain(s).job, s).toBe('cover');
      return t.brain(s).spot;
    };
    return { t, lane, spot };
  };

  it('on a set to the outside: the middle at the net inside the hitter, the setter on the 3 m line, the left back behind on the sideline, two deep', () => {
    const { lane, spot } = setTo('OH1');
    const mb = spot('MB');
    const s = spot('S');
    const l = spot('L');
    expect(mb.z).toBeLessThan(1.5);
    expect(mb.x).toBeGreaterThan(lane.x + 1);
    expect(s.z).toBeCloseTo(3, 0);
    expect(s.x).toBeGreaterThan(lane.x);
    expect(s.x).toBeLessThan(mb.x);
    expect(l.x).toBeLessThan(-COURT.halfWidth + 1.2);
    expect(l.z).toBeGreaterThan(2.5);
    expect(l.z).toBeLessThan(4.5);
    // the middle back down the line, the opposite cross court
    expect(spot('OH2').z).toBeGreaterThan(5.5);
    expect(spot('OPP').z).toBeGreaterThan(5.5);
    expect(spot('OH2').x).toBeLessThan(spot('OPP').x);
  });

  it('on a set to the opposite, the middle back comes over behind the hitter (the setter has left right back)', () => {
    const { lane, spot } = setTo('OPP');
    expect(spot('MB').x).toBeLessThan(lane.x - 1);
    expect(spot('S').z).toBeCloseTo(3, 0);
    const mbk = spot('OH2');
    expect(mbk.x).toBeGreaterThan(COURT.halfWidth - 1.2);
    expect(mbk.z).toBeGreaterThan(2.5);
    expect(mbk.z).toBeLessThan(4.5);
  });
});

describe('the back-row setter releases after their attack (Mini Rally)', () => {
  it('on their hard spike at our libero, the back-row setter is running to the net before the dig', () => {
    const t = homeTeam();
    const S = t.brain('S');
    const target = t.team.formSpot('offense', 'S');
    // a hard spike down the line at the libero (left back)
    t.spike({ x: -4.0, y: 3.25, z: -0.9 }, { x: -2.9, y: 0.1, z: 6.2 }, 22);
    t.run(0.05);
    expect(t.team.receiver).toBe(t.team.players.get('L'));
    // just before the release delay the setter is still defending
    t.run(D.hitReact - 3 * D.hitReactSd - 0.07);
    expect(S.spot).not.toEqual(target);
    // after the delay it releases to the net, while the ball is still unplayed
    t.run(6 * D.hitReactSd + 0.07);
    expect(S.job).toBe('base');
    expect(S.spot).toEqual(target);
    expect(t.ball.lastTouch?.kind).toBe('spike');
  });

  it('the release comes a reaction time after their hit, not on the hit', () => {
    const t = homeTeam();
    const S = t.brain('S');
    const target = t.team.formSpot('offense', 'S');
    t.spike({ x: -4.0, y: 3.25, z: -0.9 }, { x: -2.9, y: 0.1, z: 6.2 }, 22);
    t.run(D.hitReact - 3 * D.hitReactSd - 0.02);
    expect(S.spot).not.toEqual(target);
    t.run(6 * D.hitReactSd + 0.04);
    expect(S.spot).toEqual(target);
  });

  it('on their hard spike at the setter, the setter stays and digs', () => {
    const t = homeTeam();
    const S = t.brain('S');
    const target = t.team.formSpot('offense', 'S');
    t.spike({ x: 3.0, y: 3.25, z: -0.5 }, { x: 2.8, y: 0.1, z: 6.2 }, 22);
    t.run(0.05);
    expect(t.team.receiver).toBe(t.team.players.get('S'));
    t.run(D.hitReact + 3 * D.hitReactSd + 0.1);
    expect(S.job).toBe('receive');
    expect(S.spot).not.toEqual(target);
  });
});

describe('the middle back reads our block as it goes up (Mini Rally)', () => {
  /** their outside set to our right; from `upAt` s our pin blocker (OPP) and middle are held in the air at these x (hands: `reach`) */
  function blockUp(midX: number, reach = 0, upAt = 0.6) {
    const t = homeTeam();
    const pin = t.team.players.get('OPP')!;
    const mid = t.team.players.get('MB')!;
    const pinX = 3.5;
    let up = -1;
    setOutside(t);
    const hold = () => {
      if (t.s.sim.simTime < upAt) return;
      if (up < 0) up = t.s.sim.simTime;
      for (const [a, x, r] of [
        [pin, pinX, 0],
        [mid, midX, reach],
      ] as const) {
        a.state = 'air';
        a.pos.x = x;
        a.pos.y = 0.8;
        a.reachX = r;
      }
    };
    return { t, pinX, hold, upAt: () => up };
  }

  it('a late middle leaves a seam: the middle back steps up onto it before their hitter swings, a reaction time after the block goes up', () => {
    const { t, pinX, hold, upAt } = blockUp(3.5 - 1.2);
    const OH2 = t.brain('OH2');
    t.run(0.6 + D.react - 3 * D.reactSd - 0.02, hold);
    expect(upAt()).toBeGreaterThan(0);
    expect(OH2.spot.z).toBeCloseTo(D.middleBack, 1);
    t.run(0.5, hold);
    // still their set in the air: the step up comes before the hit
    expect(t.ball.lastTouch?.kind).toBe('set');
    expect(OH2.spot.z).toBeCloseTo(D.middleBackSeam, 1);
    // on the line from their hitter through the seam: cross of the pin blocker (within the middle back's range)
    expect(OH2.spot.x).toBeLessThan(pinX);
    expect(Math.abs(OH2.spot.x)).toBeLessThanOrEqual(D.middleBackMaxX + 1e-9);
  });

  it('a closed block: the middle back stays deep through the attack', () => {
    const { t, hold } = blockUp(3.5 - AI.middle.closeGap);
    t.run(1.1, hold);
    expect(t.brain('OH2').spot.z).toBeCloseTo(D.middleBack, 1);
    const lane = laneFor('OH', -1);
    t.spike({ x: lane.x, y: 3.25, z: lane.z }, { x: -2.6, y: 0.1, z: 6.5 }, 22);
    t.run(0.2);
    expect(t.brain('OH2').spot.z).toBeCloseTo(D.middleBack, 1);
  });

  it('a late middle whose reach closes the seam: the middle back reads the hands, not the bodies, and stays deep', () => {
    // the body 1.2 m inside the pin blocker, but the hands stretched 0.6 m towards it
    const { t, hold } = blockUp(3.5 - 1.2, 0.6);
    t.run(1.1, hold);
    expect(t.brain('OH2').spot.z).toBeCloseTo(D.middleBack, 1);
  });
});

describe('the setter releases on every ball that is not its own (Mini Rally)', () => {
  /** the setter is sent to the net `after` s after the touch, not before it has read it */
  const releases = (t: ReturnType<typeof homeTeam>, after: number) => {
    const S = t.brain('S');
    const target = t.team.formSpot('offense', 'S');
    t.run(0.05);
    expect(t.team.receiver).not.toBeNull();
    expect(t.team.receiver).not.toBe(t.team.players.get('S'));
    expect(S.spot).not.toEqual(target);
    t.run(after);
    expect(S.job).toBe('base');
    expect(S.spot).toEqual(target);
    expect(S.run).toBe(true);
  };

  it('a ball off our own block coming down hard on our side, a team-mate on it: the setter is off to the net before the dig', () => {
    const t = homeTeam();
    const mb = t.team.players.get('MB')!;
    // off the middle's hands at over 10 m/s (no "soft block"): down in front of the left back
    t.put({ x: -2.0, y: 2.6, z: 0.4 }, { x: 0.5, y: -2, z: 10 }, mb, 'block', 1);
    expect(t.ball.speed()).toBeGreaterThan(AI.transition.softSpeed);
    releases(t, D.hitReact + 3 * D.hitReactSd + 0.05);
  });

  it('our attack coming back off their block, a team-mate on it: the setter is off to the net', () => {
    const t = homeTeam();
    t.touch('block', -1, { x: -1.5, y: 3.0, z: -0.2 }, { x: -1.8, y: 0.75, z: 3.0 }, 3.6);
    releases(t, D.hitReact + 3 * D.hitReactSd + 0.05);
  });

  it('their overpass: the setter goes to the net once it has read it, and keeps going all the way down', () => {
    const t = homeTeam();
    // their dig flies over, high and deep to our middle back
    t.touch('dig', -1, { x: 1, y: 0.8, z: -5 }, { x: 0.3, y: 0.75, z: 7.6 }, 6.0);
    releases(t, D.hitReact + 3 * D.hitReactSd + 0.05);
    const target = t.team.formSpot('offense', 'S');
    t.run(1.0, () => expect(t.brain('S').spot).toEqual(target));
  });

  it('a front row that has left the net for an easy ball never turns back to it half way', () => {
    const t = homeTeam();
    t.touch('free', -1, { x: 1, y: 0.8, z: -5 }, { x: -1.0, y: 0.75, z: 6.0 }, 6.0);
    let left = false;
    t.run(1.5, () => {
      const off = t.brain('MB').job === 'attack';
      if (left) expect(off).toBe(true);
      left ||= off;
    });
    expect(left).toBe(true);
  });
});

describe("your ball or the libero's (Mini Rally)", () => {
  it("a serve between you and the libero that the libero gets to is the libero's", () => {
    const t = homeTeam({ you: 'OH2' });
    t.place('receive');
    // 0.9 m from you (the middle passer), 1.6 m from the libero
    t.touch('serve', -1, { x: 0, y: 2.8, z: -10 }, { x: 0.9, y: 0.75, z: 6.4 }, 4.0);
    t.run(0.05);
    expect(t.team.receiver).toBe(t.team.players.get('L'));
  });

  it('a serve at you that the libero cannot get to in time is yours, and nobody steps at it', () => {
    const t = homeTeam({ you: 'OH1' });
    t.place('receive');
    const you = t.team.players.get('OH1')!;
    t.touch('serve', -1, { x: 2, y: 2.6, z: -9 }, { x: -2.6, y: 0.8, z: 6.1 }, 3.6);
    t.run(AI.sit.serveRead + 0.1);
    expect(t.team.receiver).toBe(you);
    // the passers beside you hold their spots: a team-mate stepping at your ball looks like taking it
    for (const slot of ['OH2', 'L'] as const) expect(t.brain(slot).spot, slot).toEqual(t.team.formSpot('receive', slot));
  });

  it('a ball called yours stays yours: the libero takes it early or not at all', () => {
    const ball = (late: boolean) => {
      const t = homeTeam({ you: 'OH1' });
      t.place('defense');
      const you = t.team.players.get('OH1')!;
      const L = t.team.players.get('L')!;
      you.place(-1.9, 2.4, 0);
      L.place(4, 8.5, 0);
      // their free ball dropping next to you, the libero too far off to call it
      t.touch('free', -1, { x: 0, y: 1.0, z: -4 }, { x: -1.8, y: 0.75, z: 3.0 }, 5.0);
      t.run(0.05);
      expect(t.team.receiver).toBe(you);
      // the libero turns up beside the ball: at once, or only when it has long been called yours
      if (late) t.run(AI.pick.call + 0.1);
      L.place(-1.2, 3.4, 0);
      t.run(0.05);
      return t.team.receiver === L;
    };
    expect(ball(false)).toBe(true);
    expect(ball(true)).toBe(false);
  });
});

describe('a jump serve is read off the toss (Mini Rally)', () => {
  /** our receive formation with their server tossing: for a jump serve, or a float */
  const tossed = (jump: boolean) => {
    const t = homeTeam({ away: {} });
    const away = t.away!;
    t.team.place('receive');
    away.serving = true;
    t.s.sim.ballLive = false;
    // their server walks back behind the line, waits and tosses
    const server = away.brains.get(away.serve(new THREE.Vector3(0, 0, 6), jump))!.server;
    const up = t.s.run(8, () => server.phase !== 'walk' && server.phase !== 'wait');
    expect(up).toBe(true);
    t.run(0.3);
    // (the toss still in the air, the serve not yet hit)
    expect(t.ball.lastTouch?.kind).toBe('feed');
    return t;
  };

  it('the three passers step back for a jump serve; the setter and the front row stay', () => {
    const t = tossed(true);
    expect(t.team.jumpServe).toBe(true);
    for (const slot of ['OH1', 'OH2', 'L'] as const) {
      const book = t.team.formSpot('receive', slot);
      expect(t.brain(slot).spot.x, slot).toBeCloseTo(book.x, 6);
      expect(t.brain(slot).spot.z, slot).toBeCloseTo(book.z + AI.sit.jumpBack, 6);
    }
    for (const slot of ['S', 'MB', 'OPP'] as const) expect(t.brain(slot).spot, slot).toEqual(t.team.formSpot('receive', slot));
  });

  it('for a float they stay where they are', () => {
    const t = tossed(false);
    expect(t.team.jumpServe).toBe(false);
    for (const slot of SLOTS) expect(t.brain(slot).spot, slot).toEqual(t.team.formSpot('receive', slot));
  });
});

describe('nobody dives backwards at a serve or a spike (Mini Rally)', () => {
  /** the libero, facing the net at (0, 6), is sent for a ball dropping (dx, dz) m from it: does it dive? */
  const dives = (kind: TouchKind, dx: number, dz: number) => {
    const keep = AI.dive.anyway;
    AI.dive.anyway = 1;
    const t = homeTeam();
    const L = t.team.players.get('L')!;
    L.place(0, 6, 0);
    t.put({ x: dx, y: 2.0, z: 6 + dz }, { x: 0, y: 0, z: 0 }, t.theirs, kind, -1);
    // (seen a while ago: the run is what is measured here)
    t.ball.lastTouch!.t -= 1;
    const dived = t.sent('L', 'receive', 0.9, () => L.state === 'dive');
    AI.dive.anyway = keep;
    return dived;
  };
  const gaps = [2, 2.25, 2.5, 2.75];

  it('a serve or a spike dropping behind them is never dived for; out to the side or in front it is', () => {
    for (const kind of ['serve', 'spike'] as const) {
      for (const d of gaps) expect(dives(kind, 0, d), `${kind} ${d} m behind`).toBe(false);
      expect(
        gaps.some((d) => dives(kind, d, 0)),
        `${kind} to the side`,
      ).toBe(true);
      expect(
        gaps.some((d) => dives(kind, 0, -d)),
        `${kind} in front`,
      ).toBe(true);
    }
  });

  it('a ball that is neither (their free ball going over them) is still run down and dived for', () => {
    expect(gaps.some((d) => dives('dig', 0, d))).toBe(true);
  });
});

describe('a dive is a reaction, and backwards only at the end of a chase (Mini Rally)', () => {
  /**
   * The libero, facing the net at (0, 6) and sent for the ball, which is at `p` moving at `v`
   * off a `kind` touch `ago` s ago (`cover`: low behind our hitter, reading the block). When it
   * dives: how long after the touch, the share of the dive pointing away from the net, how fast
   * it was running the dive's way (and its shuffle speed) and how square it was turned to it.
   * null: no dive.
   */
  const dive = (kind: TouchKind, side: 1 | -1, p: V3, v: V3, ago: number, cover = false) => {
    const keep = AI.dive.anyway;
    AI.dive.anyway = 1;
    try {
      const t = homeTeam();
      const L = t.team.players.get('L')!;
      const b = t.brain('L');
      L.place(0, 6, 0);
      t.put(p, v, side === 1 ? t.team.players.get('OH2')! : t.theirs, kind, side);
      t.ball.lastTouch!.t -= ago;
      if (cover) b.coverT = t.s.sim.simTime;
      // (how it was moving and turned going into the step it dives in)
      let vx = L.vel.x;
      let vz = L.vel.z;
      let yaw = L.yaw;
      const dived = t.sent('L', 'receive', 1.5, () => {
        if (L.state === 'dive') return true;
        vx = L.vel.x;
        vz = L.vel.z;
        yaw = L.yaw;
        return false;
      });
      if (!dived) return null;
      // (the dive's way: where the body goes off the floor)
      const dl = Math.hypot(L.vel.x, L.vel.z);
      const dx = L.vel.x / dl;
      const dz = L.vel.z / dl;
      return {
        after: t.s.sim.simTime - t.ball.lastTouch!.t,
        back: dz,
        run: vx * dx + vz * dz,
        shuffle: L.stats.shuffleSpeed,
        turned: Math.cos(wrapAngle(yaw - yawFromDir(dx, dz))),
      };
    } finally {
      AI.dive.anyway = keep;
    }
  };
  /** the ball leaving `from` straight for `to` (ball centre) at `speed` m/s along the floor */
  const at = (from: V3, to: V3, speed: number) => {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const t = Math.hypot(dx, dz) / speed;
    return { x: dx / t, y: (to.y - from.y + 0.5 * 9.81 * t * t) / t, z: dz / t };
  };

  it('a hard ball off the block that only a dive started before anyone could react would reach is not dived for; the same ball read in time is', () => {
    // off their block at 20 m/s, 2.5 m to the side of a coverer: a dive at it would have to start at once
    const from = { x: 0.5, y: 2.4, z: 0.3 };
    const v = at(from, { x: 2.5, y: 0.2, z: 6 }, 20);
    expect(dive('block', -1, from, v, 1, true)).not.toBeNull();
    expect(dive('block', -1, from, v, 0, true)).toBeNull();
  });

  it('nobody dives before a real reaction to the touch (AI.dive.react)', () => {
    // a ball off our own block dropping 3 m to the side: slower, so there is time to dive for it
    const from = { x: 0.5, y: 2.6, z: 0.4 };
    const d = dive('block', 1, from, at(from, { x: 3.0, y: 0.2, z: 6 }, 9), 0);
    expect(d).not.toBeNull();
    expect(d!.after).toBeGreaterThanOrEqual(AI.dive.react);
  });

  it('a hard ball flying past behind them is never dived for backwards, whoever touched it', () => {
    const from = { x: 0.5, y: 2.6, z: 0.5 };
    for (const [kind, side] of [
      ['block', -1],
      ['block', 1],
      ['pass', 1],
    ] as const)
      for (const behind of [1.5, 2, 2.5, 3]) {
        const d = dive(kind, side, from, at(from, { x: 0.3, y: 0.2, z: 6 + behind }, 17), 1);
        expect(d && d.back > AI.dive.back, `${kind} ${side}, ${behind} m behind`).toBeFalsy();
      }
  });

  it('a ball going over them is run down, and dived for at the end of the run: turned, running flat out the way they dive', () => {
    // a ball dropping from 4 m, 5-7 m behind them (our own dig flying deep, off the court): a chase
    let dived = 0;
    for (const behind of [5, 6, 7]) {
      const d = dive('dig', 1, { x: 0.3, y: 4.0, z: 6 + behind }, { x: 0, y: 0, z: 0 }, 1);
      if (!d || d.back <= AI.dive.back) continue;
      dived++;
      expect(d.run, `${behind} m behind`).toBeGreaterThan(d.shuffle);
      expect(d.turned, `${behind} m behind`).toBeGreaterThan(AI.dive.chase);
    }
    expect(dived).toBeGreaterThan(0);
  });
});

describe('given the ball (Mini Rally)', () => {
  it('a hitter running in for a set that is not coming, sent to play the ball, breaks off the approach', () => {
    const t = homeTeam();
    t.team.place('offense');
    const b = t.brain('OH1');
    b.hitter!.phase = 'approach';
    t.put({ x: -3, y: 3, z: 5 }, { x: 0, y: 0, z: 0 }, t.team.players.get('L')!, 'pass', 1);
    b.job = 'free';
    t.s.step();
    expect(b.hitter!.phase).toBe('ready');
  });
});

describe('who the setter sets (Mini Rally)', () => {
  it('never a hitter still on the floor after a dive: they are not up in time', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const t = homeTeam({ seed });
      t.team.place('offense');
      const S = t.team.players.get('S')!;
      const oh = t.team.players.get('OH1')!;
      oh.dive(0);
      t.put({ x: SETTER_SPOT.x, y: 2.6, z: SETTER_SPOT.z }, { x: 0, y: -1, z: 0 }, t.team.players.get('L')!);
      expect(t.team.callSet(t.s.sim, S).hitter, `seed ${seed}`).not.toBe(oh);
    }
  });
});

describe('a set the hitter cannot get to (Mini Rally)', () => {
  /** our setter's set to the outside, `T` s in the air; does the outside leave the floor for it? */
  const jumps = (to: V3, apex: number) => {
    const t = homeTeam();
    t.team.place('offense');
    const S = t.team.players.get('S')!;
    const oh = t.team.players.get('OH1')!;
    t.team.touches = 2;
    t.team.setFor = oh;
    t.touch('set', 1, { x: S.pos.x, y: 2.6, z: S.pos.z }, to, apex, S);
    let up = false;
    t.run(2.2, () => {
      t.team.setFor = oh;
      if (oh.state === 'air') up = true;
    });
    return up;
  };
  const lane = laneFor('OH', 1);

  it('a high ball to the pin is run in for and jumped at', () => {
    expect(jumps({ x: lane.x, y: 3.2, z: lane.z }, 3.2 + lane.apexAbove)).toBe(true);
  });

  it('a ball fired flat past the pin before they can get there is not jumped for: nobody goes up beside a ball they cannot touch', () => {
    expect(jumps({ x: lane.x, y: 3.2, z: lane.z }, 3.25)).toBe(false);
  });

  it('nor is a set on its way over the net', () => {
    expect(jumps({ x: lane.x, y: 3.2, z: -1.2 }, 3.2 + lane.apexAbove)).toBe(false);
  });
});

describe('a ball at the net (Mini Rally)', () => {
  /**
   * Their dig drops just on our side of the net. Their setter can still play it (it comes down on
   * the tape: 0.1 m over at their setter's hands, 0.7 m into our court by the time it is low), or
   * it is a real overpass (0.65 m over at their setter's hands, 1.5 m into our court).
   */
  const tightPass = (over: boolean) => {
    const t = homeTeam({ away: {} });
    const to = over ? { x: 1.5, y: 0.75, z: 1.5 } : { x: 1.5, y: 0.75, z: 0.7 };
    t.touch('dig', -1, { x: 0, y: 0.8, z: -6 }, to, over ? 5.0 : 6.0, t.away!.players.get('L')!);
    t.run(0.6);
    expect(t.away!.overpass(t.s.sim)).toBe(over);
    return t;
  };

  it('their tight pass that their setter still plays is not ours: nobody is sent to it, the blockers stay, the setter stays back', () => {
    const t = tightPass(false);
    // (left alone it would come down on our side)
    expect(t.team.focus!.z).toBeGreaterThan(0);
    expect(t.team.receiver).toBeNull();
    expect(t.team.situation).toBe('theirFirstBall');
    for (const slot of SLOTS) expect(t.brain(slot).job, slot).not.toBe('receive');
    expect(t.brain('S').spot).not.toEqual(t.team.formSpot('offense', 'S'));
    for (const slot of ['OH1', 'OPP'] as const) expect(Math.abs(t.brain(slot).spot.z), slot).toBeLessThan(1);
  });

  it('a real overpass is ours: someone is sent to it and the setter releases', () => {
    const t = tightPass(true);
    expect(t.team.receiver).not.toBeNull();
    expect(t.team.situation).toBe('theirFree');
    expect(t.brain('S').spot).toEqual(t.team.formSpot('offense', 'S'));
  });

  it('their tight set their hitter is going up for is not ours until it has crossed the net', () => {
    const t = homeTeam({ away: {} });
    const away = t.away!;
    // (their second touch, their setter's: it is for their outside)
    away.touches = 1;
    away.onSet(t.theirs);
    const lane = laneFor('OH', -1);
    // a set drifting over the tape: left alone it would come down on our side
    t.touch('set', -1, { x: -SETTER_SPOT.x, y: 2.6, z: -SETTER_SPOT.z }, { x: lane.x, y: 0.75, z: 1.2 }, 5.0, away.players.get('S')!);
    t.run(0.4);
    expect(away.setFor).toBe(t.theirs);
    expect(t.team.focus!.z).toBeGreaterThan(0);
    expect(t.team.receiver).toBeNull();
    expect(t.team.situation).toBe('theirSet');
    // (the blockers on that side stay up at the net for it)
    for (const slot of ['MB', 'OPP'] as const) expect(t.brain(slot).job, slot).toBe('block');
  });

  /** our pass comes down to the setter's hands `z` m off the net, right at the setting spot */
  const passTo = (z: number) => {
    const t = homeTeam();
    t.team.place('offense');
    const L = t.team.players.get('L')!;
    const S = t.team.players.get('S')!;
    t.touch('pass', 1, { x: L.pos.x, y: 0.8, z: L.pos.z }, { x: SETTER_SPOT.x, y: setterTouchY(S), z }, 4.5, L);
    t.run(AI.setterRead + 0.1);
    return t.team.read?.call;
  };

  it('a pass coming down on the tape is called out of system, however close to the setting spot; a metre off the net it is in system', () => {
    expect(passTo(1.0)).toBe('in');
    expect(passTo(0.2)).toBe('out');
  });

  it('nobody dives into the net: a ball coming down at it is not dived for, the same ball out in the court is', () => {
    /** the libero, 2.5 m behind a dropping ball that is `off` m off the net: does it dive? */
    const dives = (off: number) => {
      const keep = AI.dive.anyway;
      AI.dive.anyway = 1;
      const t = homeTeam();
      const L = t.team.players.get('L')!;
      L.place(0, off + 2.5, 0);
      t.put({ x: 0, y: 2.0, z: off }, { x: 0, y: 0, z: 0 }, t.team.players.get('OH2')!, 'pass', 1);
      t.ball.lastTouch!.t -= 1;
      const dived = t.sent('L', 'free', 0.9, () => {
        // (and never through the net)
        expect(L.pos.z).toBeGreaterThan(0);
        return L.state === 'dive';
      });
      AI.dive.anyway = keep;
      return dived;
    };
    expect(dives(3.5)).toBe(true);
    expect(dives(0.3)).toBe(false);
  });
});

describe('after the ball (Mini Rally)', () => {
  it('a platform put out for a ball that never came comes back in: nobody runs back to their spot in a passing crouch', () => {
    const t = homeTeam();
    const L = t.team.players.get('L')!;
    L.startAction('pass', t.s.sim.simTime);
    t.s.sim.ballLive = false;
    t.run(AI.passDrop + 0.1);
    expect(L.action).toBeNull();
  });

  it('serve receive is played in lanes: a serve short of the middle passer is theirs, not yours two metres to the side', () => {
    const t = homeTeam({ you: 'OH1' });
    t.place('receive');
    const mid = t.team.players.get('OH2')!;
    // the middle passer has stepped back for a jump serve; it comes down 0.6 m to their side, 2.4 m in front
    mid.place(0, 7.6, 0);
    t.touch('serve', -1, { x: 0, y: 3.2, z: -9.5 }, { x: -0.6, y: 0.75, z: 5.3 }, 3.6);
    t.run(0.05);
    expect(t.team.receiver).toBe(mid);
  });
});
