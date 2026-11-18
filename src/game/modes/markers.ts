import type { FloorPoly } from '../blockShadow';

/**
 * What a drill puts on the court for the player to read: a ring on the floor, the zone to hit, the
 * ball machine, the shadow of the block, where the feet go. A drill says what and where; it does
 * not build them. The display does (src/fx/drillMarkers.ts), and a game nobody is watching is
 * handed `NO_MARKERS`, which do nothing. (docs/adr/0010: the simulation has no scene.)
 */
export interface DrillMarkers {
  /** a ring on the floor, `size` m across */
  ring(color: number, size: number): RingMark;
  /** a ring in the air that turns: the setter's target, seen from across the court */
  halo(x: number, y: number, z: number): HaloMark;
  /** a lit rectangle on the floor: the zone to hit */
  zone(): ZoneMark;
  /** the ball machine of Free Play */
  machine(): MachineMark;
  /** the shadow of the block on their floor */
  blockShadow(): ShadowMark;
  /** where the feet go on an approach */
  approachGuide(): GuideMark;
  /** take everything off the court (the drill is over) */
  clear(): void;
  /** what is on the court, in the order it was put there. For tools that compare what is drawn; a drill has no use for it */
  readonly objects: readonly unknown[];
}

export interface RingMark {
  visible: boolean;
  /** centre it on a spot on the floor */
  place(x: number, z: number): void;
  colour(hex: number): void;
  /** ease its brightness towards `to` (0..1): a ring lights up, it does not blink */
  fade(to: number, dt: number): void;
}

export interface HaloMark {
  /** turn it by `angle` rad */
  turn(angle: number): void;
}

export interface ZoneMark {
  /** the rectangle it covers */
  set(x0: number, x1: number, z0: number, z1: number): void;
  /** let it breathe */
  update(dt: number): void;
}

export interface MachineMark {
  /** stand it on a spot, `scale` times its size (the attack feed stands tall) */
  place(x: number, z: number, scale: number): void;
  /** the lamp's colour: it lights before a ball comes */
  lamp(r: number, g: number, b: number): void;
  /** point the barrel the way the ball is sent */
  aim(pitch: number, yaw: number): void;
}

export interface ShadowMark {
  /** the patches of floor in the shadow, or null for none */
  draw(polys: readonly FloorPoly[] | null): void;
}

export interface ApproachGuideState {
  /** where the feet go for the plant (null: hide everything) */
  spot: { x: number; z: number } | null;
  /** where the run starts: the arrows lead from here towards the spot (null: the spot alone) */
  from: { x: number; z: number } | null;
  /** where the plant starts on that run (null: not known yet): the line to jump from */
  plant: { x: number; z: number } | null;
  /** the hitter's feet now */
  feet: { x: number; z: number };
  /** 0..1: the GO cue just fired */
  pulse: number;
  /** the ball is waiting for the run: the arrows call harder */
  urge: boolean;
}

export interface GuideMark {
  update(s: ApproachGuideState, dt: number): void;
}

/** markers for a game nobody is watching: every one is asked for and none is drawn */
export const NO_MARKERS: DrillMarkers = {
  ring: () => ({ visible: false, place() {}, colour() {}, fade() {} }),
  halo: () => ({ turn() {} }),
  zone: () => ({ set() {}, update() {} }),
  machine: () => ({ place() {}, lamp() {}, aim() {} }),
  blockShadow: () => ({ draw() {} }),
  approachGuide: () => ({ update() {} }),
  clear() {},
  objects: [],
};
