// The touch controls as the input layer reads them. Owner: core.
//
// What each section controls:
//
// `TOUCH`: Touch controls: stick radius and dead zone, run threshold (with hysteresis), aim scale
// and button dead zone, air-is-HIT, roll-to-HIT, block-jumps

/** touch controls (phones / tablets): a joystick for the feet, the right half of the screen for the aim, hold buttons for the body */
export const TOUCH = {
  /** aim: a thumb travels far less than a mouse, so a drag turns this many times faster than mouse pixels (times the touch sensitivity setting) */
  lookScale: 2.6,
  /** a touch that starts on a button has to travel this far (px) before it also drags the aim */
  lookDeadZone: 7,
  /** joystick radius (px) for full deflection; a floating stick appears under the thumb */
  stickRadius: 56,
  /** deflection below this is a dead zone */
  stickDead: 0.1,
  /** push the stick past this deflection to approach / sprint (the outer ring), drop below `sprintOff` to stop running */
  sprintOn: 0.84,
  sprintOff: 0.6,
  /** while loading a jump or in the air, a touch anywhere on the right half winds up the arm (the thumb does not have to find HIT) */
  airHitAnywhere: true,
  /** rolling the thumb from JUMP onto HIT without lifting takes off and starts the wind-up */
  rollToHit: true,
  /** a hands-up block also loads a jump (release to take off); when the ball is dropping onto you the same button sets instead */
  blockJumps: true,
};
