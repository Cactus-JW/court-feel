import { describe, expect, it } from 'vitest';
import { ASSIST, SIM } from '../src/config';
import { Athlete } from '../src/game/athlete';
import { idleIntent, type Intent } from '../src/game/intent';
import { SETTER_SPOT } from '../src/game/plays';
import { Simulation } from '../src/game/simulation';
import { solveApex } from '../src/physics/solve';
import { NO_HOOKS } from './simHooks';

// What the game does for a player, as their seat does it (src/game/seat.ts): these are rules of the
// play, so a seat in a bare simulation has them, with no app, no settings screen and no camera.

const STEP = 1 / SIM.hz;
const FRAME = 1 / 60;
const STEPS_A_FRAME = Math.round(FRAME / STEP);
/** a setter faces down the net, towards their outside hitter */
const DOWN_THE_NET = Math.PI / 2;

/**
 * A setter with a seat, and a pass on its way to the setter's spot. The setter stands `off` m short
 * of where their feet have to be for it. `setAssist` is the Set aim assist setting, `theirs`
 * whether the drill says the ball is theirs to set.
 */
function aSetterAndAPass(o: { off: number; setAssist: number; theirs?: boolean }) {
  const sim = new Simulation({ ...NO_HOOKS, setAssist: () => o.setAssist });
  const setter = new Athlete('S', 1);
  setter.place(SETTER_SPOT.x, SETTER_SPOT.z, DOWN_THE_NET);
  sim.athletes.push(setter);
  const seat = sim.addSeat(setter);
  sim.drill = { step: () => {}, onOutcome: () => {}, userSetsNext: () => o.theirs ?? true };
  const from = { x: -3, y: 1, z: 6 };
  const v = { x: 0, y: 0, z: 0 };
  solveApex(from, { x: SETTER_SPOT.x, y: 2.4, z: SETTER_SPOT.z + 0.3 }, 5, { x: 0, y: 0, z: 0 }, v);
  sim.ball.launch(from, v);
  sim.ball.lastTouch = { athlete: null, kind: 'pass', t: 0, side: 1 };
  // where the feet have to be, and when the ball comes down onto the hands there
  const spot = { ...sim.contact.setSpot(setter, { x: 0, y: 0, z: 0 })! };
  const arrives = sim.contact.setCatch(setter)!.t;
  setter.place(spot.x - o.off, spot.z, DOWN_THE_NET);
  const fromSpot = (): number => Math.hypot(setter.pos.x - spot.x, setter.pos.z - spot.z);
  /** play until the ball reaches the hands, the seat hearing `hands` every frame */
  const untilTheBallArrives = (hands: () => Intent): void => {
    while (sim.simTime < arrives - STEP / 2) {
      seat.hear(FRAME, hands());
      for (let i = 0; i < STEPS_A_FRAME; i++) sim.step(STEP);
    }
  };
  return { sim, setter, seat, fromSpot, untilTheBallArrives };
}

/** nothing held, looking down the net */
function handsOff(): Intent {
  const intent = idleIntent();
  intent.yaw = DOWN_THE_NET;
  return intent;
}

describe('the set-step assist is the seat’s', () => {
  // A setter gets near the ball with their own feet and the last steps look after themselves: their
  // eyes are on the ball. The assist takes those last steps, and it helps the body, never the ball.
  it('hands off the stick, half a metre from the spot, the setter’s feet are on it when the ball arrives', () => {
    const { setter, fromSpot, untilTheBallArrives } = aSetterAndAPass({ off: 0.5, setAssist: ASSIST.aim });
    expect(fromSpot()).toBeCloseTo(0.5, 6);
    untilTheBallArrives(handsOff);
    expect(fromSpot()).toBeLessThan(0.06);
    // and still, for the touch
    expect(setter.speed).toBeLessThan(0.3);
  });

  it('an autopilot’s feet are not helped: it says where it goes outright, and the help would fight it', () => {
    const { fromSpot, untilTheBallArrives } = aSetterAndAPass({ off: 0.5, setAssist: ASSIST.aim });
    untilTheBallArrives(() => ({ ...handsOff(), helped: false }));
    expect(fromSpot()).toBeCloseTo(0.5, 6);
  });

  it('at 0 it is off', () => {
    const { fromSpot, untilTheBallArrives } = aSetterAndAPass({ off: 0.5, setAssist: 0 });
    untilTheBallArrives(handsOff);
    expect(fromSpot()).toBeCloseTo(0.5, 6);
  });

  it('a ball that is not theirs to set moves nobody', () => {
    const { fromSpot, untilTheBallArrives } = aSetterAndAPass({ off: 0.5, setAssist: ASSIST.aim, theirs: false });
    untilTheBallArrives(handsOff);
    expect(fromSpot()).toBeCloseTo(0.5, 6);
  });

  it('getting near is the player’s: from further out than the assist reaches, nothing moves them', () => {
    const out = ASSIST.setStep.radius * ASSIST.aim + 0.3;
    const { fromSpot, untilTheBallArrives } = aSetterAndAPass({ off: out, setAssist: ASSIST.aim });
    untilTheBallArrives(handsOff);
    expect(fromSpot()).toBeCloseTo(out, 6);
  });
});
