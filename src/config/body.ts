// An athlete's body: the positions, the custom body, how it moves, jumps, dives and turns. Owner: the simulation.
//
// What each section controls:
//
// `POSITIONS`: Per-position height, jump, speeds, power, ball control
//
// `BODY`: Slider ranges for the custom height, vert and spike power (Athlete)
//
// `PLAYER`: Acceleration/deceleration, plant carry, jump weighting (approach vs load), apex hang,
// the set jump (`setJump`: how high the hop is, when the body goes up for it), landing recovery, a
// dive and how long getting up from it takes (`diveTime`, `diveGetUp`, or a long slide to a stop
// and the get-up), air turning, where team-mates at the net meet shoulder to shoulder (`shoulder`),
// the dive (`diveSpeed`, `diveDecel`, `diveArm`, `diveDown`, `diveTime`), the walk back between
// reps (`walkBack`: how long the jog may take before the player is put on the spot, how near counts
// as back, when the game lets go of a player who walks themselves)

export type PositionId = 'OH' | 'OPP' | 'MB' | 'S' | 'L';

export interface PositionStats {
  id: PositionId;
  name: string;
  short: string;
  blurb: string;
  height: number;
  /** jump (approach) height above standing reach */
  jump: number;
  /** standing jump as a fraction of approach jump */
  standingJumpFrac: number;
  /** top approach / sprint speed */
  approachSpeed: number;
  shuffleSpeed: number;
  accel: number;
  /** power multiplier for spikes */
  power: number;
  /** passing/defence skill (reduces pass error) */
  ballControl: number;
  /** jersey colour for libero override etc. */
  jersey?: number;
}

export const POSITIONS: Record<PositionId, PositionStats> = {
  OH: {
    id: 'OH',
    name: 'Outside Hitter',
    short: 'OH',
    blurb: 'Left-side attacker. High balls, big swings, passes serve too.',
    height: 1.95,
    jump: 0.86,
    standingJumpFrac: 0.66,
    approachSpeed: 5.3,
    shuffleSpeed: 3.3,
    accel: 15,
    power: 1.0,
    ballControl: 0.75,
  },
  OPP: {
    id: 'OPP',
    name: 'Opposite',
    short: 'OPP',
    blurb: 'Right-side weapon. Biggest jump and power, blocks the outside.',
    height: 1.99,
    jump: 0.9,
    standingJumpFrac: 0.66,
    approachSpeed: 5.2,
    shuffleSpeed: 3.2,
    accel: 14.5,
    power: 1.08,
    ballControl: 0.6,
  },
  MB: {
    id: 'MB',
    name: 'Middle Blocker',
    short: 'MB',
    blurb: 'Tallest. Quick tempo attacks and reading blocks along the net.',
    height: 2.04,
    jump: 0.82,
    standingJumpFrac: 0.72,
    approachSpeed: 4.8,
    shuffleSpeed: 3.6,
    accel: 16,
    power: 0.95,
    ballControl: 0.5,
  },
  S: {
    id: 'S',
    name: 'Setter',
    short: 'S',
    blurb: 'Runs the offence. Sets every second ball, dumps when it is open.',
    height: 1.9,
    jump: 0.74,
    standingJumpFrac: 0.7,
    approachSpeed: 5.0,
    shuffleSpeed: 3.6,
    accel: 17,
    power: 0.82,
    ballControl: 0.95,
  },
  L: {
    id: 'L',
    name: 'Libero',
    short: 'L',
    blurb: 'Back-row defender. Fastest feet, cleanest passing, different jersey.',
    height: 1.82,
    jump: 0.66,
    standingJumpFrac: 0.7,
    approachSpeed: 5.6,
    shuffleSpeed: 4.0,
    accel: 19,
    power: 0.75,
    ballControl: 1.0,
  },
};

/** a position id from outside the type system (URL, storage): own keys of POSITIONS only */
export const isPositionId = (v: unknown): v is PositionId => typeof v === 'string' && Object.hasOwn(POSITIONS, v);

/** the user's own body, customisable per position in the settings: height, vertical (approach) jump and spike power */
export interface BodyOverride {
  height: number;
  jump: number;
  power: number;
}

/** slider ranges for the custom body (values outside are clamped, also when loaded from storage) */
export const BODY = {
  height: { min: 1.6, max: 2.2, step: 0.01 },
  /** approach jump above standing reach (the position's standing jump keeps its fraction of it) */
  jump: { min: 0.4, max: 1.1, step: 0.01 },
  /** spike power multiplier: 1 = a Perfect full-power spike leaves the hand at CONTACT.spikePerfect */
  power: { min: 0.6, max: 1.3, step: 0.01 },
};

/** the hand you spike, tip and serve with; passing, setting and blocking use both hands */
export type Hand = 'right' | 'left';

export const PLAYER = {
  /** ground movement */
  decel: 20,
  backpedalScale: 0.72,
  sideScale: 0.92,
  airControl: 0.6,
  /** fraction of horizontal approach speed kept through the plant */
  plantCarry: 0.38,
  /** two players meet at this distance (m, centre to centre) when their shoulders touch: team-mates at the net (a closing middle drifting into its pin blocker) stop there */
  shoulder: 0.5,
  /** jump load (Space hold) */
  loadMin: 0.09,
  loadMax: 0.3,
  /** jump height weighting: how much comes from approach speed vs load */
  jumpFromApproach: 0.55,
  jumpFromLoad: 0.45,
  /** gravity multiplier near the apex: a little hang time */
  apexGravityScale: 0.82,
  apexBand: 1.1,
  /** the plant brakes the run at this rate (m/s²) down to the carried speed */
  plantBrake: 24,
  /**
   * The set jump (`src/game/setJump.ts`): a controlled hop, `height` of the standing jump, off the
   * shortest plant, timed so the top of the jump falls in the middle of the touch (real setters
   * meet the ball at the top, with a hop well under their block jump). The body goes up only if
   * the hop carries the hands to within `near` m of the ball while drifting no faster than
   * `maxDrift` m/s (a setter flying through the ball stays down and sets off the floor), and no
   * later than `late` s after the moment to plant.
   */
  setJump: { height: 0.7, near: 0.35, maxDrift: 1.5, late: 0.05 },
  landRecover: 0.2,
  /**
   * A dive (AI defenders, at a ball the platform can't reach on foot): the body goes hands-first
   * along the floor at `diveSpeed` m/s or the run's speed, sliding to a stop at `diveDecel` m/s²; the
   * hands are at full stretch, `diveArm` m past the feet and `CONTACT.diveLow` m off the floor,
   * `diveDown` s after it starts, and the player is up again after `diveTime` s, or `diveGetUp` s
   * after a longer slide stops (`Athlete.diveUpT`), the last `diveGetUp` s of it pushing up off the
   * floor (then `landRecover` s more to be moving). With a run-up that is a ball about 2.5-3 m away
   * dug off the floor (a sprawl or a pancake). The slide is a body on its chest and thighs on a
   * hardwood court: a friction coefficient of about 0.4, so about 4 m/s² of braking, and a dive from
   * a 5 m/s sprint slides about 3 m (an estimate from that, not a measurement; MatusGib,
   * 2026-11-20: a diver "should slide on the floor more and travel a larger distance on the ground
   * not just fall over"; it was 6 m/s², 2 m from a sprint).
   * From hitting the floor to standing takes a player about a second: the push up from the chest
   * alone is 0.5-0.7 s. 1.5 s for the whole dive (it was 1.1 s, with 0.4 s to get up: back on the
   * feet almost as they landed) is an estimate from that, not a measured figure: no study of
   * get-up times after a volleyball dive was found (MatusGib, 2026-11-15: a bit longer).
   */
  diveSpeed: 3.5,
  diveDecel: 4,
  diveArm: 1.0,
  diveDown: 0.3,
  diveTime: 1.5,
  diveGetUp: 0.6,
  bodyTurnRate: 14,
  /**
   * airborne: max body rotation from the takeoff yaw, and its rate. In the air the arm aims,
   * not the hips: with a free turn, aiming cross-court swung the contact point away from the
   * ball and the timing felt random.
   */
  airTurnMax: 0.35,
  airTurnRate: 4,
  /**
   * The walk back between reps: a drill sends the player's athlete back to its spot at a jog, with
   * no cut (the rep reset used to cut the screen to black: playtest, 142263c, 2026-11-02). It is on
   * the spot within `near` m. A player who takes the stick walks themselves, and the game lets go
   * once they are within `nearSteered` m. One not back after `maxT` s is put on the spot (the
   * screen dips, it does not cut). One who steered is never put there: `giveUp` s after `maxT`
   * the game stops waiting where they stand. The jog gives way while the body is being moved by
   * anything else (a move command above `idle`), slows over the last `ease` m and is a sprint
   * from more than `sprintFrom` m out. All seven tuned by play in that commit, with no measurement
   * recorded: a drill may give its own `maxT`.
   */
  walkBack: { maxT: 2.6, near: 0.1, nearSteered: 0.9, giveUp: 2, idle: 0.05, ease: 0.6, sprintFrom: 2.5 },
};
