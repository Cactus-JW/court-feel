import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CONTACT, SIM } from '../src/config';
import { Athlete } from '../src/game/athlete';
import type { TouchKind } from '../src/game/ballEntity';
import { SETTER_SPOT } from '../src/game/plays';
import { Simulation } from '../src/game/simulation';
import { solveApex } from '../src/physics/solve';
import { NO_HOOKS } from './simHooks';

const DT = 1 / SIM.hz;

/**
 * You are the outside, standing where a ball comes down to your hands. It comes from our setter's
 * spot, played by our setter as `kind`, and is in the air until it is in reach of a set.
 */
function stage(kind: TouchKind) {
  const sim = new Simulation(NO_HOOKS);
  const oh = new Athlete('OH', 1);
  oh.isUser = true;
  const s = new Athlete('S', 1);
  sim.athletes.push(oh, s);
  sim.me = oh;
  oh.place(-3.2, 1.6, 0);
  s.place(SETTER_SPOT.x, SETTER_SPOT.z, Math.PI / 2);
  const P = sim.contact.handsPoint(oh, new THREE.Vector3());
  const from = { x: SETTER_SPOT.x, y: 2.6, z: SETTER_SPOT.z };
  const v = { x: 0, y: 0, z: 0 };
  solveApex(from, { x: P.x, y: P.y, z: P.z }, P.y + 1.5, { x: 0, y: 0, z: 0 }, v);
  sim.ball.launch(from, v);
  sim.ball.lastTouch = { athlete: s, kind, t: 0, side: 1 };
  // fly it until a set could be looked for
  for (let i = 0; i < SIM.hz * 3; i++) {
    sim.simTime += DT;
    sim.ball.step(DT, sim.env);
    const c = sim.contact.setCatch(oh);
    if (c && c.t - sim.simTime < CONTACT.setLook * 0.5) break;
  }
  return { sim, oh };
}

describe('a hitter never gets the setter cues for a ball that is theirs to hit', () => {
  it('a pass that comes to you can be set (you set the second ball)', () => {
    const { sim, oh } = stage('pass');
    expect(sim.contact.wantsSet(oh)).toBe(true);
    expect(sim.contact.setPreview(oh)).not.toBeNull();
  });

  it('a ball your setter sets you is to hit: no set preview, so no set slow-mo, ring, bar or floor spot', () => {
    const { sim, oh } = stage('set');
    expect(sim.contact.wantsSet(oh)).toBe(false);
    expect(sim.contact.setPreview(oh)).toBeNull();
  });
});
