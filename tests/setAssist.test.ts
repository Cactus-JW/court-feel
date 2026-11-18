import { describe, expect, it } from 'vitest';
import { ASSIST, CONTACT, FX, SIM, TIMING } from '../src/config';
import { Athlete } from '../src/game/athlete';
import { setStepAssist } from '../src/game/setAssist';
import { SetRadar } from '../src/ui/setRadar';

const DT = 1 / SIM.hz;
const SPOT = { x: 1, z: 0.8 };

/** a setter standing `off` m from the spot (towards +x), stepped for `sec` with the assist; `stick` is what the player holds */
function walk(off: number, assist: number, sec: number, stick = { x: 0, z: 0 }) {
  const a = new Athlete('S', 1);
  a.isUser = true;
  a.place(SPOT.x + off, SPOT.z, Math.PI / 2);
  let t = 0;
  let steered = false;
  let overshoot = 0;
  for (let i = 0; i < SIM.hz * sec; i++) {
    t += DT;
    a.cmd = { moveX: stick.x, moveZ: stick.z, sprint: false, faceYaw: Math.PI / 2 };
    steered = setStepAssist(a.cmd, a.pos, SPOT, assist) || steered;
    a.step(DT, t);
    overshoot = Math.max(overshoot, SPOT.x - a.pos.x);
  }
  return { a, d: Math.hypot(a.pos.x - SPOT.x, a.pos.z - SPOT.z), steered, overshoot };
}

describe("aim assist for the set's footwork (it helps the body, never the ball)", () => {
  it('near the spot, hands off the stick, your body takes the last steps onto it and stands still for the touch', () => {
    const r = walk(0.5, ASSIST.aim, 1);
    expect(r.steered).toBe(true);
    // on the spot: the ball is centred on the hands, and the feet have been still long enough
    expect(r.d).toBeLessThan(CONTACT.setCentreOk / 2);
    expect(r.a.stillT).toBeGreaterThan(TIMING.setFeetReady);
  });
  it('it arrives, it does not run through the spot', () => {
    expect(walk(0.5, 1, 1).overshoot).toBeLessThan(0.05);
  });
  it('at 0 it is off: nothing moves you', () => {
    const r = walk(0.5, 0, 1);
    expect(r.steered).toBe(false);
    expect(r.d).toBeCloseTo(0.5, 6);
  });
  it('it only finishes what you started: from further away than its reach you walk there yourself', () => {
    const far = ASSIST.setStep.radius * ASSIST.aim + 0.2;
    const r = walk(far, ASSIST.aim, 1);
    expect(r.steered).toBe(false);
    expect(r.d).toBeCloseTo(far, 6);
  });
  it('more assist reaches further', () => {
    expect(walk(1.0, 1, 1.2).d).toBeLessThan(CONTACT.setCentreOk);
    expect(walk(1.0, 0.3, 1.2).steered).toBe(false);
  });
  it('your stick still counts: push away and you leave the spot, even at full assist', () => {
    const r = walk(0.05, 1, 2, { x: 1, z: 0 });
    expect(r.d).toBeGreaterThan(ASSIST.setStep.radius);
  });
  it('the last steps are a shuffle, never a sprint', () => {
    const cmd = { moveX: 0, moveZ: 0, sprint: true };
    setStepAssist(cmd, { x: SPOT.x + 0.4, z: SPOT.z }, SPOT, 1);
    expect(cmd.sprint).toBe(false);
    expect(cmd.moveX).toBeLessThan(0);
  });
});

describe('where to stand, in first person (the dial under the crosshair)', () => {
  const half = FX.setRadar.size / 2;
  it('up on the dial is where you look: a spot ahead of you is above your feet, one to your right is right of them', () => {
    // looking along -z (yaw 0), as UserController moves you
    const ahead = SetRadar.offset(0, -0.35, 0);
    expect(ahead.y).toBeCloseTo(-half / 2, 6);
    expect(ahead.x).toBeCloseTo(0, 6);
    const right = SetRadar.offset(0.35, 0, 0);
    expect(right.x).toBeCloseTo(half / 2, 6);
    expect(right.y).toBeCloseTo(0, 6);
  });
  it('it turns with you: the same spot is ahead once you face it', () => {
    // the setter faces the outside (-x): yaw PI / 2
    const o = SetRadar.offset(-0.35, 0, Math.PI / 2);
    expect(o.y).toBeCloseTo(-half / 2, 6);
    expect(o.x).toBeCloseTo(0, 6);
  });
  it('a spot beyond the dial is pinned to its edge, in the direction to go', () => {
    const o = SetRadar.offset(3, 0, 0);
    expect(o.far).toBe(true);
    expect(o.x).toBeCloseTo(half, 6);
    expect(SetRadar.offset(0.2, 0.2, 0).far).toBe(false);
  });
});
