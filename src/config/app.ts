// The graphics levels and their governor, and the player's stored settings. Owner: the app.
//
// What each section controls:
//
// `QUALITY`: The graphics levels (`levels`: pixel ratio, MSAA (on at every level, for the court
// lines), shadow map, floor mirror) and Auto's quality governor: where it starts and how far it
// climbs, the most pixels any level draws, how slow a machine has to be, and for how long, before
// the picture gets cheaper, how long it must run fast before it gets richer (in a calm moment
// only), and how it finds a frame rate a cheaper picture cannot raise

import { ASSIST, type SetLevel } from './skills';
import type { BodyOverride, Hand, PositionId } from './body';
import type { VenueId } from './venues';
import { AUDIO, CAMERA } from './display';

/** the graphics levels, cheapest first (Settings, Camera, Graphics) */
export const GRAPHICS_LEVEL_IDS = ['veryLow', 'low', 'medium', 'high', 'veryHigh'] as const;

export type GraphicsLevel = (typeof GRAPHICS_LEVEL_IDS)[number];

/** the Graphics setting: a level of its own, or auto (the quality governor picks one) */
export type GraphicsSetting = 'auto' | GraphicsLevel;

export const GRAPHICS_SETTINGS: readonly GraphicsSetting[] = ['auto', ...GRAPHICS_LEVEL_IDS];

/** what one graphics level draws */
export interface QualityLevel {
  label: string;
  /** the most screen pixels per CSS pixel (never more than the screen has): a phone's screen has 3 */
  pixelRatio: number;
  /**
   * MSAA samples on the HDR picture (0: none). Every level keeps 4: without it the 5 cm court lines
   * drop out at a distance (at 844x390, Very low to Medium each lost some of the side, attack and
   * centre lines), and a player has to see the lines. It cost 0.6-1.3 ms a frame on those levels.
   */
  msaa: number;
  /** the key light's shadow map (texels a side) */
  shadowMap: number;
  /** the floor mirror's image, as a share of the picture's size (0: no floor mirror) */
  mirror: number;
}

/**
 * Graphics. Each level is a row; the Graphics setting picks one, or Auto lets the quality governor
 * (src/app/quality.ts) pick: the picture gets cheaper when the machine cannot keep up, so the play
 * never slows, and richer again when it can. None of it touches the play.
 *
 * The governor averages frames over `window` s. Under `slowFps` for `slowWindows` windows in a row
 * steps down a level. At `fastFps` or more for `upWindows` windows (40 s) it steps up, but only in a
 * calm moment (a menu, the pause, a replay, a dead ball): a step up resizes the picture, which costs
 * a frame, and may turn out slow, and neither should land in the middle of a rally. After a step up
 * it waits `probeCooldown` s, and its first window must hold the frame rate it had (`minGain` of it,
 * counted up to `fastFps`, so a 120 Hz phone at 80 fps keeps the sharper picture) or it steps back at
 * once. A step up that fails, or is slow again within `upFail` windows, doubles the wait before the
 * next try, up to `upMaxWindows` (320 s), so a frame rate on the edge between two levels does not
 * flicker. That is the cost of trying: on a device that runs High but not Very high, about 3 s of
 * slow frames every 5 minutes, nearly always in a calm moment.
 *
 * A step down that gains under `minGain` of the frame rate did not help (the screen is capped, say a
 * phone's low power mode at 30 fps or a 50 Hz screen, or the processor is the limit): the picture
 * goes back up, and that frame rate is the cap. Under a cap only `capBand` under it is slow, a
 * window that holds it (half of `capBand` under it) counts as fast, so a capped device still climbs
 * back after a slow moment, and `capBand` over it in play clears it (not in a menu, which can run
 * faster than play where the processor is the limit).
 *
 * Auto starts at `autoTop` on every device (a phone too: it is the level phones had before there was
 * a setting) and climbs as far as `autoCeiling`. Past `autoTop` only with no cap: a capped phone is
 * saving power or shedding heat, and Very high draws a phone's own pixels, about 2.5 times High's
 * work (measured on a laptop, 30.5 ms against 12.4 ms a frame at 844x390 @3x). Turned down: never
 * climbing past `autoTop` (the PR's first version); a phone that runs its own pixels at 60 fps then
 * never showed them, and the calm-moment rule removes the cost to the play that kept it out. A lost
 * graphics context while Auto is above `autoTop` keeps Auto at `autoTop` on that browser from then
 * on (the context loss is the browser running out of graphics memory).
 *
 * No level draws a buffer over `maxPixels` (a 4K frame, 3840x2160): a desktop at 2x with a large
 * window would otherwise ask Very high for 5120x2880, about 470 MB of MSAA colour alone; a phone's
 * 3x screen (2532x1170, 2796x1290) is well inside it. No step for `startCooldown` s after the game
 * starts (loading costs frames), nor `changeCooldown` s after a step down (the change itself costs
 * frames). Tuned on a laptop with integrated graphics.
 */
export const QUALITY: {
  levels: Record<GraphicsLevel, QualityLevel>;
  autoTop: GraphicsLevel;
  autoCeiling: GraphicsLevel;
  maxPixels: number;
  window: number;
  slowFps: number;
  slowWindows: number;
  fastFps: number;
  upWindows: number;
  upMaxWindows: number;
  upFail: number;
  minGain: number;
  capBand: number;
  startCooldown: number;
  changeCooldown: number;
  probeCooldown: number;
} = {
  levels: {
    veryLow: { label: 'Very low', pixelRatio: 0.6, msaa: 4, shadowMap: 512, mirror: 0 },
    low: { label: 'Low', pixelRatio: 0.8, msaa: 4, shadowMap: 1024, mirror: 0 },
    medium: { label: 'Medium', pixelRatio: 1, msaa: 4, shadowMap: 2048, mirror: 0.35 },
    high: { label: 'High', pixelRatio: 1.5, msaa: 4, shadowMap: 2048, mirror: 0.5 },
    veryHigh: { label: 'Very high', pixelRatio: 3, msaa: 4, shadowMap: 4096, mirror: 0.5 },
  },
  autoTop: 'high',
  autoCeiling: 'veryHigh',
  maxPixels: 3840 * 2160,
  window: 2,
  slowFps: 50,
  slowWindows: 2,
  fastFps: 57,
  upWindows: 20,
  upMaxWindows: 160,
  upFail: 5,
  minGain: 0.1,
  capBand: 0.15,
  startCooldown: 3,
  changeCooldown: 4,
  probeCooldown: 1,
};

/** user-adjustable settings (persisted) */
export interface Settings {
  sensitivity: number;
  fov: number;
  /** the field of view while the touch controls are on (a phone) */
  touchFov: number;
  invertY: boolean;
  womenNet: boolean;
  /** spike slow-mo: time slows as the ball reaches you in the air (never in a jump set) */
  slowmoAssist: boolean;
  /** time slows for your set's catch and release (on by default; the same on every level) */
  setSlowmo: boolean;
  /** your body jumps by itself to set a pass in system (the jump set; on by default). Off: the jump is yours (Space) */
  autoJumpSet: boolean;
  /**
   * your set's timing cues: the ring that closes on the ball as it reaches your hands, the bar
   * beside it and its pips, and the load tone. Off, you set by feel and the windows are wider (ASSIST.setByFeel)
   */
  setRing: boolean;
  /** when you set: who it goes to, their call over the hitter and the set as a dotted arc */
  setArc: boolean;
  /** your set's aim assist (0..1): the last steps onto the spot, the drift in a jump set, a little more reach */
  setAimAssist: number;
  /** set difficulty: how wide the green, the good band and the clean catch are (SET_LEVELS) */
  setLevel: SetLevel;
  /** when you set: the hitter you picked stays picked for the next ball (off: back to the outside) */
  keepSetPick: boolean;
  /** when you set: rings on the floor where your hitters hit from (off by default: the marker over the hitter and the arc say it) */
  hitterSpots: boolean;
  /** aim assist (0..1) for every touch but your set: a little more reach, a drift towards the ball in the air */
  aimAssist: number;
  /** the ring where the ball will land */
  landingMarker: boolean;
  /** the Spike and Serve Drills: the spot your run-up takes off from, and GO when to start it */
  runUpGuide: boolean;
  /** in the air, the collar around the crosshair: where a swing now would land in the timing window */
  spikeCollar: boolean;
  replays: boolean;
  shake: number;
  volume: number;
  firstPerson: boolean;
  /**
   * the key hint line at the bottom of the screen. Off by default (2026-11-22: the screen is for
   * the court). Saved before then as `showHints`, which was on for everyone: that is not carried over.
   */
  keyHints: boolean;
  /** touch controls: auto (on touch screens), always on, or off */
  touchControls: 'auto' | 'on' | 'off';
  /** touch aim sensitivity multiplier */
  touchSensitivity: number;
  /** your custom body per position (absent = the position's defaults); only your athlete uses it, never the AI */
  bodies: Partial<Record<PositionId, BodyOverride>>;
  /** where the court stands (see `VENUES`) */
  venue: VenueId;
  /** your hitting hand, one for every position (the AI stays right-handed); timing, power and reach are the same for both */
  hand: Hand;
  /** how rich the picture is (QUALITY.levels), or auto: the game picks by the frame rate */
  graphics: GraphicsSetting;
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1.0,
  fov: CAMERA.fov,
  touchFov: CAMERA.touchFov,
  invertY: false,
  womenNet: false,
  slowmoAssist: false,
  setSlowmo: true,
  autoJumpSet: true,
  setRing: true,
  setArc: true,
  setAimAssist: ASSIST.aim,
  setLevel: 'easy',
  keepSetPick: false,
  hitterSpots: false,
  aimAssist: ASSIST.aim,
  landingMarker: true,
  runUpGuide: true,
  spikeCollar: true,
  replays: true,
  shake: 1.0,
  volume: AUDIO.master,
  firstPerson: false,
  keyHints: false,
  touchControls: 'auto',
  touchSensitivity: 1.0,
  bodies: {},
  venue: 'hall',
  hand: 'right',
  graphics: 'auto',
};

export type NumericSettingKey = { [K in keyof Settings]: Settings[K] extends number ? K : never }[keyof Settings];

export type BooleanSettingKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

/**
 * Ranges of the numeric settings. The settings panel builds its sliders from these and the
 * loader clamps stored values to them, so the two can never disagree.
 */
export const SETTING_RANGES: Record<NumericSettingKey, { min: number; max: number; step: number }> = {
  sensitivity: { min: 0.2, max: 3, step: 0.05 },
  touchSensitivity: { min: 0.3, max: 3, step: 0.05 },
  fov: { min: 55, max: 100, step: 1 },
  touchFov: { min: 50, max: 100, step: 1 },
  aimAssist: { min: 0, max: 1, step: 0.05 },
  setAimAssist: { min: 0, max: 1, step: 0.05 },
  shake: { min: 0, max: 1.5, step: 0.05 },
  volume: { min: 0, max: 1, step: 0.05 },
};

export const TOUCH_CONTROL_MODES: readonly Settings['touchControls'][] = ['auto', 'on', 'off'];
