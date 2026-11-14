import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { isInsideRun, planToPoint, simulateApproach } from '../src/ai/approach';
import { AI, PLAYBOOK, PLAYER } from '../src/config';
import { Athlete } from '../src/game/athlete';
import { callSheet } from '../src/game/callRuns';
import { comboPlay, COMBOS } from '../src/game/combos';
import { clampRoute, routeOf, routePlay, routesOf, sanitizePlaybook, toCombo, type Route, type SavedPlay } from '../src/game/playbook';
import { attackHeight, isQuick, needsGoodPass, SETTER_PLAYS, SETTER_SPOT, SETTER_TARGET } from '../src/game/plays';
import { SETTER_KEYS, SetterCalls } from '../src/game/setterCalls';

/** the X with the outside moved inside on a medium set, and the middle's quick pushed along the net */
function myPlay(): SavedPlay {
  const routes = routesOf(COMBOS.find((c) => c.name === 'X')!);
  routes.OH = { x: -2.0, sx: -4.85, sz: 3.5, tempo: 'mid' };
  routes.MB = { ...routes.MB, x: -1.0 };
  return { name: 'Inside out', routes };
}

describe('your own plays (start screen, Plays)', () => {
  it('a route that is one of the hitter’s own calls is that call: an untouched play keeps every name', () => {
    for (const k of SETTER_KEYS) for (const p of SETTER_PLAYS[k]) expect(routePlay(k, routeOf(p)), `${k} ${p.short}`).toBe(p);
    for (const c of COMBOS) {
      const same = toCombo({ name: c.name, routes: routesOf(c) });
      expect(SETTER_KEYS.map((k) => same.calls[k])).toEqual(SETTER_KEYS.map((k) => c.calls[k]));
    }
  });
  it('a moved route is a new set: hit where you put it, at the tempo you chose', () => {
    const p = routePlay('OH', { x: -2.0, sx: -4.85, sz: 3.5, tempo: 'mid' });
    expect(SETTER_PLAYS.OH).not.toContain(p);
    expect(p.lane.x).toBe(-2.0);
    expect(p.lane.sx).toBe(-4.85);
    expect(p.lane.apexAbove).toBe(PLAYBOOK.apex.mid);
    // faster than a high ball: the hitter runs before the set, so it needs a good pass
    expect(needsGoodPass(p)).toBe(true);
    expect(isQuick(p)).toBe(false);
    // a high ball is the position's own high ball
    expect(routePlay('OH', { x: -3.0, sx: -4.85, sz: 3.7, tempo: 'high' }).lane.apexAbove).toBe(SETTER_PLAYS.OH[0].lane.apexAbove);
  });
  it('a quick is hit within a quick set’s reach of the setter, off a short run from close behind it', () => {
    const r = clampRoute('OH', { x: -4.0, sx: -4.9, sz: 4.5, tempo: 'quick' });
    expect(r.x).toBe(PLAYBOOK.quickX[0]);
    expect(Math.abs(r.sx - r.x)).toBeLessThanOrEqual(PLAYBOOK.startOff);
    expect(r.sz).toBe(PLAYBOOK.quickZ[1]);
    const p = routePlay('OH', r);
    expect(isQuick(p)).toBe(true);
    // (the set meets them `inFront` of where the setter takes the pass)
    expect(SETTER_TARGET.x - p.inFront!).toBeCloseTo(r.x);
  });
  it('a back-row hitter has no quick and takes off behind the 3 m line', () => {
    const r = clampRoute('PIPE', { x: 2.0, sx: 2.0, sz: 3.2, tempo: 'quick' });
    expect(r.tempo).not.toBe('quick');
    expect(r.sz).toBeGreaterThanOrEqual(PLAYBOOK.pipeZ[0]);
    expect(routePlay('PIPE', r).lane.z).toBe(SETTER_PLAYS.PIPE[0].lane.z);
  });
  it('a saved play takes its place on the wheel’s list of calls: the hitters get its routes, and the strip names it', () => {
    const mine = toCombo(myPlay());
    const c = new SetterCalls();
    expect(c.setCombo(mine)).toBe(true);
    expect(c.play('OH')).toBe(mine.routes!.OH);
    expect(c.play('OH').lane.x).toBe(-2.0);
    expect(c.play('OPP').short).toBe('X');
    const wheel = COMBOS.map((b, i) => (i === 1 ? mine : b));
    expect(c.combo(wheel)).toBe(mine);
    expect(callSheet(c, SETTER_KEYS, c.target()).items.find((i) => i.id === 'OH')).toMatchObject({ call: 'Mid' });
    // the hitter's key again still steps through their calls: the designed set is one more, after their own
    expect(c.step('OH')).toEqual({ i: SETTER_PLAYS.OH.length, n: SETTER_PLAYS.OH.length + 1 });
    c.press('OH');
    c.press('OH');
    expect(c.play('OH')).toBe(SETTER_PLAYS.OH[0]);
    expect(c.combo(wheel)).not.toBe(mine);
    // calling a built-in play again drops it
    expect(c.setCombo(COMBOS[0])).toBe(true);
    expect(c.step('OH').n).toBe(SETTER_PLAYS.OH.length);
    expect(SETTER_KEYS.map((k) => c.play(k))).toEqual(SETTER_KEYS.map((k) => comboPlay(COMBOS[0], k)));
  });
  it('stored plays are untrusted: one per place on the wheel, junk dropped, routes clamped to what can be run', () => {
    const wild = { x: 99, sx: -99, sz: 0, tempo: 'warp' } as unknown as Route;
    const book = sanitizePlaybook([
      null,
      { name: '   A   very long name for a play that goes on  ', routes: { OH: wild, MB: 'nope', OPP: null } },
      { name: '', routes: myPlay().routes },
      { routes: myPlay().routes },
      'junk',
    ]);
    expect(book.length).toBe(COMBOS.length);
    expect(book.filter(Boolean).length).toBe(1);
    const p = book[1]!;
    expect(p.name.length).toBeLessThanOrEqual(PLAYBOOK.nameMax);
    expect(p.name.startsWith('A very')).toBe(true);
    expect(p.routes.OH.x).toBe(PLAYBOOK.hitX);
    expect(p.routes.OH.sx).toBe(-PLAYBOOK.startX);
    expect(p.routes.OH.sz).toBe(PLAYBOOK.frontZ[0]);
    // nothing usable: the hitter's first call
    expect(routePlay('MB', p.routes.MB)).toBe(SETTER_PLAYS.MB[0]);
    expect(routePlay('PIPE', p.routes.PIPE)).toBe(SETTER_PLAYS.PIPE[0]);
    expect(sanitizePlaybook('nope').every((e) => e === null)).toBe(true);
  });
});

describe('a pin hitter going inside (AI.insideRun)', () => {
  const inside = [
    ['OH', '3'],
    ['OH', '2'],
    ['OPP', 'X'],
    ['OPP', 'Back 2'],
  ] as const;
  const plan = (k: 'OH' | 'OPP', short: string) => {
    const lane = SETTER_PLAYS[k].find((p) => p.short === short)!.lane;
    const a = new Athlete(k, 1);
    a.place(lane.sx, lane.sz, 0);
    const p = planToPoint(a, 0, new THREE.Vector3(lane.x, attackHeight(a), lane.z), 2.2, 0, 0, undefined, true)!;
    const off = simulateApproach(
      a,
      0,
      p.tStart,
      p.tPress,
      p.hold,
      p.dir,
      p.runYaw,
      p.airYaw,
      p.tPress + p.hold + 0.03,
      p.bend,
      p.total,
      p.carry,
    );
    return { lane, p, speed: Math.hypot(off.vel.x, off.vel.z), run: Math.hypot(off.pos.x - p.feet.x, off.pos.z - p.feet.z) };
  };
  it('the 3, the 2, the X and the back 2 are runs inside; a go or a high ball to the pin is not', () => {
    for (const [k, short] of inside) expect(plan(k, short).p.inside, short).toBe(true);
    expect(plan('OH', 'Go').p.inside).toBe(false);
    expect(plan('OH', 'High').p.inside).toBe(false);
    expect(plan('OPP', 'Back').p.inside).toBe(false);
    // straight at the net is never one, however long
    expect(isInsideRun(new THREE.Vector3(0, 0, -1), 1, 6)).toBe(false);
  });
  it('they do not brake for the jump: they leave the floor faster than off a pin approach and fly further to the ball', () => {
    const go = plan('OH', 'Go');
    for (const [k, short] of inside) {
      const r = plan(k, short);
      expect(r.p.carry, short).toBe(AI.insideRun.carry);
      expect(r.speed, short).toBeGreaterThan(go.speed + 1);
      expect(r.run, short).toBeGreaterThan(go.run + 0.3);
      // and the feet still come down under the ball
      expect(r.p.error, short).toBeLessThan(0.12);
    }
    expect(go.p.carry).toBe(PLAYER.plantCarry);
  });
  it('nothing gives the play away: an inside call starts within 1.6 m of where that hitter’s pin sets start', () => {
    for (const [k, short] of inside) {
      const { lane } = plan(k, short);
      const pin = SETTER_PLAYS[k][0].lane;
      expect(Math.hypot(lane.sx - pin.sx, lane.sz - pin.sz), short).toBeLessThan(1.6);
      // still outside the setter (the run goes in from the pin)
      expect(Math.abs(lane.sx)).toBeGreaterThan(Math.abs(SETTER_SPOT.x) + 2);
    }
  });
});
