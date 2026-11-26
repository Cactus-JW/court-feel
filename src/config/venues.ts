// The five venues: looks and sound, except for the open sky (docs/adr/0009). Owner: the display.

import { ARENA } from './display';

/**
 * The venues: the same court in other places, chosen in Settings (Court) or with `venue=<id>` on a link.
 * A venue is how the place is drawn and lit and how its crowd sounds. The court, the net, the lines, the
 * free zone and the walls where a ball goes dead (`COURT`) are the same in every one. The single thing a
 * venue changes about play is `openSky` (docs/adr/0009). Colours are sRGB hex.
 */
export type VenueId = 'hall' | 'games' | 'afterhours' | 'seaside' | 'rooftop';

export interface VenueSpec {
  /** the name on the Settings chip */
  name: string;
  /** what stands round the court */
  build: 'hall' | 'games' | 'gym' | 'seaside' | 'rooftop';
  /**
   * No roof: the ball is not stopped at `COURT.ceiling`, it keeps flying and is judged where it comes down.
   * Indoors 12.5 m is the free playing space the rules ask for over the court; outdoors nothing is there to hit.
   */
  openSky: boolean;
  /** the crowd's sound, as a share of `AUDIO.crowd` (an empty gym has none) */
  crowdSound: number;
  floor: {
    /** maple boards, or a laid synthetic / painted hard court (no planks) */
    wood: boolean;
    /** colour outside the free zone, of the free zone and of the court */
    base: number;
    free: number;
    court: number;
    /** roughness of the three (the wood ones multiply the board map, so they run above 1) */
    rough: [number, number, number];
    /** the floor mirror, as a share of `ARENA.reflection.strength` (0 = off, and its pass is skipped) */
    mirror: number;
    /**
     * the surface of a painted outdoor court, seen close: the grit in the acrylic and the uneven roller coats,
     * as a share of full strength (0 = one even colour, as a laid indoor court is)
     */
    grain: number;
  };
  /** the sky dome, or null under a roof. Sun and moon: azimuth from -z towards +x and elevation (rad), size (rad) */
  sky: null | {
    zenith: number;
    mid: number;
    horizon: number;
    ground: number;
    /** how many stars, and how bright the brightest are (0..1) */
    stars: number;
    starLight: number;
    disc: null | { az: number; el: number; size: number; color: number; glow: number; glowSize: number };
    /** streaks of cloud near the horizon in this colour, or none */
    clouds: number | null;
  };
  light: {
    hemiSky: number;
    hemiGround: number;
    hemi: number;
    keyColor: number;
    key: number;
    /** where the key light stands (m); the shadow is cast from here */
    keyPos: [number, number, number];
    fillColor: number;
    fill: number;
    env: number;
    /** how soft the edge of a cast shadow is (the blur radius, in shadow-map texels): roof lights are wide, the sun is not */
    shadowSoft: number;
  };
  fog: { color: number; near: number; far: number };
  grade: { vignette: number; contrast: number; saturation: number };
  exposure: number;
  /** the athletes' rim and side fill, as shares of `CHARACTER.rim` and `CHARACTER.sideFill` (tuned for roof light) */
  body: { rim: number; side: number };
  /** light on the crowd, as a share of `ARENA.bowl.light` */
  crowd: number;
  /** how much the boards glow by themselves (LED panels indoors and at night; printed boards in daylight barely do) */
  boardGlow: number;
  /** the boards round the free zone: panel colours (from, to), the word and its colour; null for none. Invented marks only. */
  boards: null | [string, string, string, string][];
}

const HALL_BOARDS: [string, string, string, string][] = [
  ['#0a1c4a', '#16408f', 'COURT FEEL', '#ffffff'],
  ['#8f141c', '#d8343c', 'SPIKE', '#ffffff'],
  ['#0a1c4a', '#16408f', 'TRUE TO THE COURT', '#ffd45c'],
  ['#0e1626', '#1c2740', 'BLOCK', '#7fb4ff'],
];

export const VENUES: Record<VenueId, VenueSpec> = {
  hall: {
    name: 'Club hall',
    build: 'hall',
    openSky: false,
    crowdSound: 1,
    floor: { wood: true, base: 0xf2e2d0, free: 0x2a63c4, court: 0xffe0c0, rough: [1.4, 1.3, 1.2], mirror: 1, grain: 0 },
    sky: null,
    light: {
      hemiSky: 0xe2e9ff,
      hemiGround: 0xb08c62,
      hemi: ARENA.light.hemi,
      keyColor: 0xfff4e6,
      key: ARENA.light.key,
      keyPos: [1.5, 24, 3.5],
      fillColor: 0xdde6ff,
      fill: ARENA.light.fill,
      env: ARENA.light.env,
      shadowSoft: 4,
    },
    fog: { color: 0x0b0d14, near: 38, far: 90 },
    grade: ARENA.grade,
    exposure: 1,
    body: { rim: 1, side: 1 },
    crowd: 1,
    boardGlow: 0.55,
    boards: HALL_BOARDS,
  },
  /** a games arena: a laid synthetic court in colour blocks, the house lights down, the court in a pool of light */
  games: {
    name: 'Games arena',
    build: 'games',
    openSky: false,
    crowdSound: 1.25,
    floor: { wood: false, base: 0x161b66, free: 0x232a94, court: 0xe0674f, rough: [0.62, 0.6, 0.55], mirror: 0.35, grain: 0 },
    sky: null,
    light: {
      hemiSky: 0xdfe4ff,
      hemiGround: 0x8a6a7a,
      hemi: 0.34,
      keyColor: 0xffffff,
      key: 2.2,
      keyPos: [1.5, 24, 3.5],
      fillColor: 0xe6e0ff,
      fill: 0.45,
      env: 0.4,
      shadowSoft: 4,
    },
    fog: { color: 0x07081a, near: 70, far: 200 },
    grade: { vignette: 0.42, contrast: 0.2, saturation: 1.12 },
    exposure: 1,
    body: { rim: 1, side: 0.9 },
    crowd: 0.5,
    boardGlow: 0.5,
    boards: [
      ['#141a5c', '#1f2a8a', 'THE GAMES', '#ffffff'],
      ['#e0457a', '#f2765a', 'VOLLEYBALL', '#ffffff'],
      ['#141a5c', '#1f2a8a', 'COURT FEEL', '#ffd9c9'],
      ['#e0457a', '#f2765a', 'FINAL · DAY 9', '#ffffff'],
    ],
  },
  /** a painted hard court by the sea, the sun low over the water */
  seaside: {
    name: 'Seaside',
    build: 'seaside',
    openSky: true,
    crowdSound: 0.6,
    floor: { wood: false, base: 0xb86a4c, free: 0xc9694a, court: 0x2f86b4, rough: [0.85, 0.82, 0.8], mirror: 0, grain: 1 },
    sky: {
      zenith: 0x2a4688,
      mid: 0xb87a92,
      horizon: 0xffc27a,
      ground: 0x8a6a4a,
      stars: 0,
      starLight: 0,
      disc: { az: -0.95, el: 0.2, size: 0.045, color: 0xfff0c8, glow: 0.75, glowSize: 0.55 },
      clouds: 0xff9a6a,
    },
    light: {
      hemiSky: 0xa9b8e8,
      hemiGround: 0xc48a5a,
      hemi: 0.75,
      keyColor: 0xffb070,
      key: 2.3,
      keyPos: [-21, 13, -15],
      fillColor: 0x9fb4e8,
      fill: 0.35,
      env: 0.8,
      shadowSoft: 1.6,
    },
    fog: { color: 0xe8a878, near: 60, far: 260 },
    grade: { vignette: 0.26, contrast: 0.14, saturation: 1.1 },
    exposure: 0.92,
    body: { rim: 0.8, side: 0.5 },
    crowd: 1.15,
    boardGlow: 0.3,
    boards: [
      ['#0d5a7a', '#1a86b0', 'COURT FEEL', '#ffffff'],
      ['#c9532c', '#f08a4a', 'SEASIDE OPEN', '#ffffff'],
      ['#f2e2c0', '#fff4dc', 'TRUE TO THE COURT', '#0d4a66'],
      ['#0d5a7a', '#1a86b0', 'SIX A SIDE', '#ffe08a'],
    ],
  },
  /** the training gym after everyone has gone home: half the lamps on, the moon in the windows, nobody watching */
  afterhours: {
    name: 'After hours',
    build: 'gym',
    openSky: false,
    crowdSound: 0,
    floor: { wood: true, base: 0xe6cfae, free: 0xe6cfae, court: 0xf2dcbc, rough: [1.1, 1.1, 1.05], mirror: 1.15, grain: 0 },
    sky: null,
    light: {
      hemiSky: 0x8fa4d8,
      hemiGround: 0x8a6238,
      hemi: 0.26,
      keyColor: 0xffd9a8,
      key: 1.55,
      keyPos: [2, 22, 4],
      fillColor: 0x8fa8e8,
      fill: 0.32,
      env: 0.3,
      shadowSoft: 4,
    },
    fog: { color: 0x0a0b10, near: 38, far: 90 },
    grade: { vignette: 0.44, contrast: 0.2, saturation: 1.0 },
    exposure: 1,
    body: { rim: 0.8, side: 0.7 },
    crowd: 0,
    boardGlow: 0,
    boards: null,
  },
  /** a court on a city roof at night: a ball fence, festoon lights, the skyline all round, a full sky of stars */
  rooftop: {
    name: 'Rooftop',
    build: 'rooftop',
    openSky: true,
    crowdSound: 0.45,
    floor: { wood: false, base: 0x4a5160, free: 0x39465c, court: 0x2f8a66, rough: [0.9, 0.8, 0.78], mirror: 0.12, grain: 0.8 },
    sky: {
      zenith: 0x040716,
      mid: 0x0a1030,
      horizon: 0x3a2f52,
      ground: 0x07080f,
      stars: 3000,
      starLight: 0.8,
      disc: { az: 2.7, el: 0.45, size: 0.016, color: 0xf2f0e6, glow: 0.12, glowSize: 0.12 },
      clouds: null,
    },
    light: {
      hemiSky: 0x6f7fd0,
      hemiGround: 0x8a6a5a,
      hemi: 0.3,
      keyColor: 0xffe2c0,
      key: 1.8,
      keyPos: [4, 22, 6],
      fillColor: 0xa9b4ff,
      fill: 0.5,
      env: 0.5,
      shadowSoft: 2.4,
    },
    fog: { color: 0x141630, near: 60, far: 260 },
    grade: { vignette: 0.34, contrast: 0.18, saturation: 1.1 },
    exposure: 1,
    body: { rim: 0.9, side: 0.75 },
    crowd: 0.8,
    boardGlow: 0.5,
    boards: [
      ['#1a1f3a', '#2a3266', 'COURT FEEL', '#ffffff'],
      ['#b83a5a', '#f06a4a', 'ROOFTOP SIXES', '#ffffff'],
      ['#1a1f3a', '#2a3266', 'TRUE TO THE COURT', '#ffd45c'],
      ['#0e3a30', '#1a6a52', 'LEVEL 31', '#bfffe0'],
    ],
  },
};

export const VENUE_IDS = Object.keys(VENUES) as VenueId[];

export const isVenueId = (v: unknown): v is VenueId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(VENUES, v);
