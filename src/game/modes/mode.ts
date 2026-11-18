import * as THREE from 'three';
import type { PositionId, ServeKind, Settings } from '../../config';
import type { Emitter } from '../../core/events';
import type { Athlete } from '../athlete';
import type { AiHost, Brain } from '../brains';
import type { CallSheetView } from '../callRuns';
import type { ContactEvent } from '../contact';
import type { GameEvents } from '../gameEvents';
import type { Judge, Outcome } from '../judge';
import type { Tutorial } from '../tutorial';
import { makeRingTexture } from '../../world/textures';
import { drillBall } from '../attempt';

export type ModeId = 'free' | 'spike' | 'block' | 'receive' | 'setter' | 'serve' | 'rally';

export const MODE_INFO: Record<ModeId, { title: string; blurb: string }> = {
  free: { title: 'Free Play', blurb: 'A ball machine feeds you. Practise anything: spike, pass, block, set.' },
  spike: { title: 'Spike Drill', blurb: 'The setter sets you rep after rep. Timing, power and placement are scored.' },
  block: { title: 'Block Drill', blurb: 'An opposing hitter attacks. Read the set, move, time the block.' },
  receive: { title: 'Serve Receive / Dig', blurb: 'Pass serves and dig attacks to the setter target.' },
  setter: { title: 'Setter Drill', blurb: 'Run the offence: set your hitters and watch them finish.' },
  serve: {
    title: 'Serve Drill',
    blurb: 'Standing float, jump float or jump serve at a team in serve receive. Rated by the pass you force.',
  },
  rally: { title: 'Mini Rally', blurb: 'Six-a-side rallies in your chosen position. Win the point.' },
};

/** a mode id from outside the type system (URL, storage): own keys of MODE_INFO only */
export const isModeId = (v: unknown): v is ModeId => typeof v === 'string' && Object.hasOwn(MODE_INFO, v);

/**
 * The screen, as a drill writes on it. The HUD is one; a drill does not import it. (The drills
 * still say what to show, word for word. Reporting what happened and leaving the words to the
 * display is the next step of docs/adr/0010.)
 */
export interface DrillHud {
  /** the grade is drawn to one side, clear of the ball (a setter watching the set fly) */
  gradeAside: boolean;
  setTitle(t: string): void;
  setScore(t: string): void;
  setStreak(n: number): void;
  setCallSheet(v: CallSheetView | null): void;
  showBanner(text: string, kind?: 'good' | 'bad' | 'neutral', dur?: number): void;
  message(text: string, dur?: number): void;
  go(): void;
  call(
    who: string,
    word: string,
    sub: string,
    kind: 'in' | 'out',
    anchor: ((out: THREE.Vector3) => THREE.Vector3) | null,
    dur?: number,
  ): void;
  clearCall(): void;
}

/**
 * What a drill may use of the game. It is everything a brain may use (`AiHost`), and what a drill
 * needs on top: the judge, the cast of athletes, the user's seat, the lesson, and the few parts of
 * the display it still writes to itself. The app's `Game` is one; a drill does not import it.
 */
export interface DrillHost extends AiHost {
  /** a drill with a rally in it says when the ball is in play: the brains only read it */
  ballLive: boolean;
  readonly brains: ReadonlyMap<Athlete, Brain>;
  clearBrains(): void;
  readonly judge: Judge;
  addAthlete(a: Athlete, seed?: number, kitKind?: 'team' | 'coach'): unknown;
  removeAthlete(a: Athlete): void;

  // ---- the user's seat
  readonly me: Athlete;
  /** a command key was pressed (`COMMAND_KEYS`: the calls, their block, the next feed). True once for each press */
  keyPressed(code: string): boolean;
  readonly settings: Settings;
  /** the serve the user has picked: the Serve Drill sets it, the contact system reads it */
  serveKind: ServeKind;
  /** an autopilot plays the user's athlete (the start screen's demo) */
  readonly autoUser: boolean;
  /** set the user's body and camera facing (teleport) */
  placeUser(x: number, z: number, yaw: number): void;
  /** the user's athlete jogs back to a spot between reps */
  returnUser(x: number, z: number, yaw: number, maxT?: number): void;
  /** a drill should hold its next feed while this is true */
  readonly userReturning: boolean;
  /** the play wheel is open: a drill holds its next ball */
  readonly wheelOpen: boolean;
  readonly tutorial: Pick<
    Tutorial,
    'active' | 'serving' | 'lesson' | 'holdingFeed' | 'holdingResult' | 'showPath' | 'urgeRun' | 'noteFeed' | 'noteContact' | 'noteRepEnd'
  >;

  // ---- what a drill still tells the display itself
  readonly events: Pick<Emitter<GameEvents>, 'emit'>;
  readonly hud: DrillHud;
  crowd(amount: number, cheer?: boolean): void;
  readonly scene: { add(o: THREE.Object3D): unknown; remove(o: THREE.Object3D): unknown };
  readonly rig: { readonly mode: string; pitch: number };
  /** how each athlete is drawn right now (a replay poses them) */
  readonly views: { get(a: Athlete): { readonly root: THREE.Object3D } | undefined };
  readonly fx: { readonly replay: { readonly contact: THREE.Vector3 } };
}

/** A drill. Modes own their extra athletes and floor markers and clean them up. */
export abstract class Mode {
  abstract readonly id: ModeId;
  protected spawned: Athlete[] = [];
  /** extra lines for the F3 overlay */
  debugLines?(): string[];
  protected objects: THREE.Object3D[] = [];
  score = 0;
  streak = 0;
  bestStreak = 0;
  reps = 0;

  constructor(
    protected g: DrillHost,
    protected position: PositionId,
  ) {}

  /** the command keys, as something that reads keys expects them (`SetterCalls.readKeys`) */
  protected readonly keys = { consumePress: (code: string): boolean => this.g.keyPressed(code) };

  abstract setup(): void;
  abstract step(dt: number): void;
  frame(_dt: number): void {}
  /** each frame of a replay (the simulation is frozen, the replay poses the scene): redraw overlays from it */
  replayFrame(): void {}
  onContact(_ev: ContactEvent): void {}
  onOutcome(_o: Outcome): void {}
  abstract hint(): string;
  /** N key: restart / skip the current rep. `snap` puts the athlete on the ground at the start (tutorial Skip). */
  restartRep(_snap = false): void {}
  /** no live play is going on (the ball is down or between reps): replays may be watched */
  ballDead(): boolean {
    const b = this.g.ball;
    return !b.active || b.state.rest;
  }
  /**
   * The ball in the air is the user's to play: if it comes down in their court with no attempt at
   * it, that is the rep they review (R). Drills with teammates who play the ball on narrow it down.
   */
  userBall(): boolean {
    return drillBall(this.g.ball.lastTouch, this.g.me.side);
  }
  passTarget?(a: Athlete): { x: number; y: number; z: number; apex: number };
  setOptions?(a: Athlete): import('../contact').SetOption[];
  /** what the user setter picked with a key: a hitter, or the dump (null: no key) */
  setPick?(a: Athlete): import('../setterCalls').SetPick | null;
  /** the user sets in this drill: who they can pick now (the touch chips; the dump only from the front row). Null: they don't set */
  setterPicks?(): readonly import('../setterCalls').SetPick[] | null;
  /** the user setter's calls while a play can still be called (before the pass): the play wheel opens on them */
  playCalls?(): import('../setterCalls').SetterCalls | null;
  /** the ball in flight is the user's to set (shows where to stand for it) */
  userSetsNext?(): boolean;
  canServe?(a: Athlete): boolean;
  /** redraw the title and the score line (the first-run lesson shortens them, and has just ended) */
  refreshHud?(): void;
  /** the approach for the set in the air: where the feet go and when (the first-run lesson reads it) */
  approachLine?(): import('../tutorial').ApproachLine | null;

  teardown(): void {
    this.g.hud.setCallSheet(null);
    for (const a of this.spawned) this.g.removeAthlete(a);
    this.spawned = [];
    for (const o of this.objects) {
      this.g.scene.remove(o);
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as (THREE.Material & { map?: THREE.Texture | null }) | undefined;
        if (mat) {
          mat.map?.dispose();
          mat.dispose();
        }
      });
    }
    this.objects = [];
    this.g.clearBrains();
  }

  protected add(o: THREE.Object3D): THREE.Object3D {
    this.g.scene.add(o);
    this.objects.push(o);
    return o;
  }

  protected bumpStreak(ok: boolean): void {
    this.streak = ok ? this.streak + 1 : 0;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    this.g.hud.setStreak(this.streak);
  }
}

/** translucent target zone on the floor with a bright border */
export class ZoneMarker {
  readonly group = new THREE.Group();
  private fill: THREE.Mesh;
  private border: THREE.LineSegments;
  private t = 0;

  constructor(color = 0xffc23a) {
    this.fill = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false }),
    );
    this.fill.rotation.x = -Math.PI / 2;
    const edges = new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1));
    this.border = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    this.border.rotation.x = -Math.PI / 2;
    this.group.add(this.fill, this.border);
    this.group.position.y = 0.012;
    this.group.renderOrder = 2;
  }

  set(x0: number, x1: number, z0: number, z1: number): void {
    const w = Math.abs(x1 - x0);
    const d = Math.abs(z1 - z0);
    this.group.position.set((x0 + x1) / 2, 0.012, (z0 + z1) / 2);
    this.fill.scale.set(w, d, 1);
    this.border.scale.set(w, d, 1);
    this.group.visible = true;
  }

  update(dt: number): void {
    this.t += dt;
    (this.fill.material as THREE.MeshBasicMaterial).opacity = 0.12 + Math.sin(this.t * 4) * 0.05;
  }
}

export function makeFloorRing(color: number, size: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    // the court is pulled towards the camera with a polygon offset: pull the ring further, or the court draws over it
    new THREE.MeshBasicMaterial({
      map: makeRingTexture(0.18),
      color,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.011;
  m.renderOrder = 2;
  return m;
}
