import * as THREE from 'three';
import { FX } from '../config';
import { lerp, smooth01 } from '../core/mathx';
import { BONE_ORDER } from '../character/rig';
import type { AthleteView } from '../character/athleteView';

/**
 * Fixed-size ring buffer of rendered frames (ball + every athlete's root and
 * bone rotations) and FX events, played back in slow motion from a
 * cinematic camera after a Perfect spike, or on demand (R) for the player's
 * last attempt. No allocation while recording.
 *
 * Athletes spawned while a drill runs (the spike drill's opposing block,
 * turned on with B) get a slot of their own from `addView`; a replay hides
 * them for the part of the recording from before they were there.
 *
 * Anything else that moves and has to be seen again (the antennae and the
 * net's top, where the user looked) is a `ReplayChannel`: a few numbers a
 * frame, written from the live scene and posed back from the recording.
 *
 * A replay plays at one slow speed, or (`start` with `marks`) at real speed
 * that slows to it around the moments in `marks`: the whole point, like TV.
 */
const BONES = BONE_ORDER.length;
const PER_ATHLETE = 4 + 3 + BONES * 4; // root xyz + yaw, hips position, bone quats
/** frames a second the buffer is sized for (`record` keeps at most one every 1/70 s) */
const RECORD_FPS = 60;

export interface ReplayEvent {
  t: number;
  kind: string;
  data: Record<string, number>;
}

/** something else the replay keeps a frame of: `size` numbers written from the live scene, posed back between two frames */
export interface ReplayChannel {
  size: number;
  /** the live scene into `out` from `o` */
  write(out: Float32Array, o: number): void;
  /** pose the scene `u` of the way from the frame at `a` to the frame at `b` */
  read(d: Float32Array, a: number, b: number, u: number): void;
}

export class Replay {
  private frames: number;
  private times: Float64Array;
  private ball: Float32Array; // pos xyz + quat xyzw + visible
  private data: Float32Array;
  private head = -1;
  private count = 0;
  private maxAthletes = 14;
  private nAthletes = 0;
  /** per slot: time of the first frame recorded with that athlete in it (Infinity: none yet) */
  private since: Float64Array;
  /** per slot: hidden by the playback (not there yet at that point of the recording) */
  private hidden: Uint8Array;
  private channels: { c: ReplayChannel; off: number }[] = [];
  private extraSize = 0;
  private extra = new Float32Array(0);
  /** the moments a whole-point replay slows down for (sim time; empty: slow all the way) */
  private marks: number[] = [];
  views: AthleteView[] = [];
  events: ReplayEvent[] = [];
  // playback
  playing = false;
  t0 = 0;
  t1 = 0;
  cursor = 0;
  speed = FX.replaySlow;
  focus = new THREE.Vector3();
  /** the contact being replayed (`focus` follows the ball during playback) */
  contact = new THREE.Vector3();
  impact = new THREE.Vector3();
  contactT = 0;
  impactT = 0;
  private evIdx = 0;
  onEvent: ((e: ReplayEvent) => void) | null = null;

  constructor(seconds = 4.5) {
    this.frames = Math.ceil(seconds * RECORD_FPS);
    this.times = new Float64Array(this.frames);
    this.ball = new Float32Array(this.frames * 8);
    this.data = new Float32Array(this.frames * this.maxAthletes * PER_ATHLETE);
    this.since = new Float64Array(this.maxAthletes).fill(Infinity);
    this.hidden = new Uint8Array(this.maxAthletes);
  }

  /** a fresh buffer for these athletes (a new drill) */
  setViews(views: AthleteView[]): void {
    this.stop();
    this.views = views.slice(0, this.maxAthletes);
    this.nAthletes = this.views.length;
    this.since.fill(Infinity);
    this.count = 0;
    this.head = -1;
    this.events.length = 0;
  }

  /** record `c` too, from now on (what was recorded before is dropped) */
  addChannel(c: ReplayChannel): void {
    this.channels.push({ c, off: this.extraSize });
    this.extraSize += c.size;
    this.extra = new Float32Array(this.frames * this.extraSize);
    this.count = 0;
    this.head = -1;
  }

  /** how many seconds the buffer holds */
  get seconds(): number {
    return this.frames / RECORD_FPS;
  }

  /** an athlete added while the drill runs: recorded from the next frame on, the buffer is kept */
  addView(v: AthleteView): void {
    if (this.views.includes(v) || this.nAthletes >= this.maxAthletes) return;
    this.views.push(v);
    this.since[this.nAthletes] = Infinity;
    this.nAthletes++;
  }

  record(t: number, ballMesh: THREE.Object3D, ballVisible: boolean): void {
    if (this.playing) return;
    if (this.count > 0 && t - this.times[this.head] < 1 / 70) return;
    this.head = (this.head + 1) % this.frames;
    this.count = Math.min(this.frames, this.count + 1);
    const f = this.head;
    this.times[f] = t;
    const b = f * 8;
    const p = ballMesh.position;
    const q = ballMesh.quaternion;
    this.ball.set([p.x, p.y, p.z, q.x, q.y, q.z, q.w, ballVisible ? 1 : 0], b);
    let o = f * this.maxAthletes * PER_ATHLETE;
    for (let i = 0; i < this.nAthletes; i++) {
      const v = this.views[i];
      if (this.since[i] === Infinity) this.since[i] = t;
      const r = v.root;
      this.data[o++] = r.position.x;
      this.data[o++] = r.position.y;
      this.data[o++] = r.position.z;
      this.data[o++] = r.rotation.y;
      const hp = v.rig.bones.hips.position;
      this.data[o++] = hp.x;
      this.data[o++] = hp.y;
      this.data[o++] = hp.z;
      for (const n of BONE_ORDER) {
        const bq = v.rig.bones[n].quaternion;
        this.data[o++] = bq.x;
        this.data[o++] = bq.y;
        this.data[o++] = bq.z;
        this.data[o++] = bq.w;
      }
    }
    for (const { c, off } of this.channels) c.write(this.extra, f * this.extraSize + off);
    // forget events that fell out of the buffer
    const oldest = this.times[(this.head - this.count + 1 + this.frames) % this.frames];
    while (this.events.length && this.events[0].t < oldest) this.events.shift();
  }

  addEvent(t: number, kind: string, data: Record<string, number>): void {
    if (this.playing) return;
    // (a whole point: every touch, the ball down, the float breaking)
    if (this.events.length > 256) this.events.shift();
    this.events.push({ t, kind, data });
  }

  get oldestT(): number {
    if (!this.count) return 0;
    return this.times[(this.head - this.count + 1 + this.frames) % this.frames];
  }

  get newestT(): number {
    return this.count ? this.times[this.head] : 0;
  }

  /**
   * Play from `from` to `to`. With `marks` (sim times) it runs at real speed and slows to
   * `FX.replaySlow` around each of them (`FX.replayPoint`); without, it is slow all the way.
   */
  start(from: number, to: number, marks: number[] = []): boolean {
    if (this.count < 10) return false;
    this.t0 = Math.max(from, this.oldestT);
    this.t1 = Math.min(to, this.newestT);
    if (this.t1 - this.t0 < 0.3) return false;
    this.marks = marks.slice().sort((a, b) => a - b);
    this.cursor = this.t0;
    this.speed = this.speedAt(this.t0);
    this.playing = true;
    this.evIdx = 0;
    while (this.evIdx < this.events.length && this.events[this.evIdx].t < this.t0) this.evIdx++;
    return true;
  }

  stop(): void {
    this.playing = false;
    // athletes the playback hid are back in the live scene
    for (let i = 0; i < this.nAthletes; i++) {
      if (!this.hidden[i]) continue;
      this.hidden[i] = 0;
      this.views[i].root.visible = true;
    }
  }

  /** how fast the recording plays at `t`: slow all the way, or slow only around a mark */
  speedAt(t: number): number {
    if (!this.marks.length) return FX.replaySlow;
    let d = Infinity;
    for (const m of this.marks) d = Math.min(d, Math.abs(t - m));
    const P = FX.replayPoint;
    return lerp(FX.replaySlow, 1, smooth01((d - P.slowHold) / P.slowRamp));
  }

  /** advance playback and pose the scene; returns false when finished */
  advance(dt: number, ballMesh: THREE.Object3D): boolean {
    if (!this.playing) return false;
    this.speed = this.speedAt(this.cursor);
    this.cursor += dt * this.speed;
    if (this.cursor >= this.t1) {
      this.stop();
      return false;
    }
    while (this.evIdx < this.events.length && this.events[this.evIdx].t <= this.cursor) {
      this.onEvent?.(this.events[this.evIdx]);
      this.evIdx++;
    }
    // find the two frames around the cursor
    let a = -1;
    let b = -1;
    for (let k = 0; k < this.count; k++) {
      const f = (this.head - k + this.frames) % this.frames;
      if (this.times[f] <= this.cursor) {
        a = f;
        b = k === 0 ? f : (f + 1) % this.frames;
        break;
      }
    }
    if (a < 0) return true;
    const ta = this.times[a];
    const tb = this.times[b];
    // recording pauses while the ball is dead: never interpolate across such a gap
    const u = tb > ta && tb - ta < 0.25 ? (this.cursor - ta) / (tb - ta) : 0;
    const ba = a * 8;
    const bb = b * 8;
    ballMesh.position.set(
      this.lerp(this.ball[ba], this.ball[bb], u),
      this.lerp(this.ball[ba + 1], this.ball[bb + 1], u),
      this.lerp(this.ball[ba + 2], this.ball[bb + 2], u),
    );
    _qa.set(this.ball[ba + 3], this.ball[ba + 4], this.ball[ba + 5], this.ball[ba + 6]);
    _qb.set(this.ball[bb + 3], this.ball[bb + 4], this.ball[bb + 5], this.ball[bb + 6]);
    ballMesh.quaternion.slerpQuaternions(_qa, _qb, u);
    ballMesh.visible = this.ball[ba + 7] > 0.5;
    this.focus.copy(ballMesh.position);
    for (let i = 0; i < this.nAthletes; i++) {
      const v = this.views[i];
      // spawned after this point of the recording: its slot holds nothing yet, it was not there
      if (ta < this.since[i]) {
        if (!this.hidden[i]) {
          this.hidden[i] = 1;
          v.root.visible = false;
        }
        continue;
      }
      if (this.hidden[i]) {
        this.hidden[i] = 0;
        v.root.visible = true;
      }
      const oa = (a * this.maxAthletes + i) * PER_ATHLETE;
      const ob = (b * this.maxAthletes + i) * PER_ATHLETE;
      const d = this.data;
      v.root.position.set(this.lerp(d[oa], d[ob], u), this.lerp(d[oa + 1], d[ob + 1], u), this.lerp(d[oa + 2], d[ob + 2], u));
      v.root.rotation.y = this.lerp(d[oa + 3], d[ob + 3], u);
      v.rig.bones.hips.position.set(
        this.lerp(d[oa + 4], d[ob + 4], u),
        this.lerp(d[oa + 5], d[ob + 5], u),
        this.lerp(d[oa + 6], d[ob + 6], u),
      );
      let k = 7;
      for (const n of BONE_ORDER) {
        _qa.set(d[oa + k], d[oa + k + 1], d[oa + k + 2], d[oa + k + 3]);
        _qb.set(d[ob + k], d[ob + k + 1], d[ob + k + 2], d[ob + k + 3]);
        v.rig.bones[n].quaternion.slerpQuaternions(_qa, _qb, u);
        k += 4;
      }
      v.rig.bones.head.scale.setScalar(1);
      v.root.updateMatrixWorld(true);
      // hand flashes follow the replayed hands
      v.updateFxAnchors();
    }
    for (const { c, off } of this.channels) c.read(this.extra, a * this.extraSize + off, b * this.extraSize + off, u);
    return true;
  }

  private lerp(a: number, b: number, u: number): number {
    return a + (b - a) * u;
  }
}

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
