// The court, the net and the simulation's clock: what the rules and the hall fix. Read by every layer.

export const COURT = {
  length: 18,
  width: 9,
  halfLength: 9,
  halfWidth: 4.5,
  attackLine: 3,
  lineWidth: 0.05,
  netHeightMen: 2.43,
  netHeightWomen: 2.24,
  /** vertical size of the net mesh (top band to bottom band) */
  netDepth: 1.0,
  /** the net extends a little past the sidelines */
  netHalfLength: 5.0,
  /** antennae sit on the outer edge of the side bands, directly above the sidelines */
  antennaX: 4.5 + 0.05,
  antennaAboveNet: 0.8,
  antennaRadius: 0.005,
  postX: 5.5,
  postRadius: 0.055,
  /** free zone around the court that is still "floor" */
  freeZoneSide: 4,
  freeZoneEnd: 6.5,
  /** arena walls (ball dies when it reaches these) */
  arenaHalfX: 15,
  arenaHalfZ: 21,
  ceiling: 12.5,
} as const;

export const SIM = {
  hz: 120,
  /** clamp for very long frames so we do not spiral */
  maxFrameDt: 0.1,
  /** how far ahead the ball predictor looks (s): under the 12.5 m roof no ball stays up longer than about 3.2 s */
  predictHorizon: 4.0,
  /**
   * the same outdoors, where nothing stops a ball overhead: one sent up at 25 m/s (a shanked dig of a hard
   * spike) peaks near 21.5 m and is in the air for 4.15 s, so 4 s would lose its landing. 6 s covers a ball
   * sent up at well over 30 m/s (timed with `stepBall`; tests/physics.test.ts).
   */
  predictHorizonOpenSky: 6.0,
};
