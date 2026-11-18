/**
 * The proportions of a body, as fractions of its standing height. They are facts about the
 * athlete, not about how one is drawn: the simulation takes its reach from them, and the rig
 * (src/character/rig.ts) builds its bones to the same lengths, so the hand that is drawn is where
 * the contact system says it is.
 */
export interface RigDims {
  H: number;
  hipY: number;
  hipJointY: number;
  hipJointX: number;
  spineLen: number;
  chestLen: number;
  neckLen: number;
  headLen: number;
  clavX: number;
  clavY: number;
  shoulderX: number;
  upperArm: number;
  foreArm: number;
  hand: number;
  /** wrist to the knuckle line (where the fingers bend) */
  knuckle: number;
  /** wrist to the middle of the palm, and from the hand's centre plane to the palm's surface */
  palm: number;
  palmThick: number;
  thigh: number;
  shin: number;
  ankleY: number;
  footLen: number;
  heel: number;
}

export function dimsFor(H: number): RigDims {
  // anatomical proportions (fractions of standing height)
  return {
    H,
    hipY: 0.55 * H,
    hipJointY: 0.53 * H,
    hipJointX: 0.05 * H,
    spineLen: 0.12 * H, // spine bone (0.58H) -> chest (0.70H)
    chestLen: 0.135 * H, // chest -> neck base (0.835H)
    neckLen: 0.055 * H,
    headLen: 0.055 * H, // neck -> skull base (0.89H)
    clavX: 0.02 * H,
    clavY: 0.115 * H, // shoulder line at 0.815H
    shoulderX: 0.105 * H,
    upperArm: 0.186 * H,
    foreArm: 0.146 * H,
    hand: 0.108 * H,
    knuckle: 0.053 * H,
    palm: 0.034 * H,
    palmThick: 0.0085 * H,
    thigh: 0.245 * H,
    shin: 0.246 * H,
    ankleY: 0.039 * H,
    footLen: 0.14 * H,
    heel: 0.035 * H,
  };
}

/** standing reach implied by the rig (shoulder + arm + a little shrug) */
export function standingReach(H: number): number {
  const d = dimsFor(H);
  return d.hipY + 0.03 * H + d.spineLen + d.clavY + 0.003 * H + d.upperArm + d.foreArm + d.hand * 0.85 + 0.025 * H;
}
