import * as THREE from 'three';
import { BALL, FX, TIMING } from '../config';
import type { SetPreview, SetResult } from '../game/contact';
import type { SetPips } from '../game/setTiming';

const PIPS: readonly (keyof SetPips)[] = ['feet', 'centre', 'catch'];
const PIP_LABEL: Record<keyof SetPips, string> = { feet: 'feet', centre: 'centred', catch: 'catch' };

/**
 * The set bar (2K's shot meter), beside the ball so your eyes stay on it. It is there, empty,
 * as the pass comes down, waiting where you will catch the ball: the green band is your window
 * as your touch stands (it grows as your feet stop and the ball lines up on your hands), and the
 * three pips say which parts of the touch you have: feet, centred, catch. It starts filling when
 * you catch the ball and reaches the green line as the ball has loaded (TIMING.setLoad of game
 * time; the set slow-mo stretches it on screen). Release in the green band; the white band is a
 * good set. After the push it stays a moment where it was, stopped where you released, coloured
 * by the grade, a pip you missed in orange. In first person it has a fixed place beside the
 * crosshair (the ball comes down onto the camera, so "beside the ball" would be off the screen).
 */
export class SetBar {
  private el: HTMLDivElement;
  private good: HTMLDivElement;
  private green: HTMLDivElement;
  private fill: HTMLDivElement;
  private pips = new Map<keyof SetPips, HTMLDivElement>();
  private pipCls = '';
  private shownFor: SetResult | null = null;
  private linger = 0;
  private v = new THREE.Vector3();

  constructor(parent: HTMLElement) {
    const div = (cls: string, p: HTMLElement) => {
      const d = document.createElement('div');
      d.className = cls;
      p.appendChild(d);
      return d;
    };
    const B = FX.setBar;
    this.el = div('set-bar', parent);
    this.el.style.width = `${B.width}px`;
    this.el.style.height = `${B.height}px`;
    this.good = div('sb-zone sb-good', this.el);
    this.green = div('sb-zone sb-green', this.el);
    this.fill = div('sb-fill', this.el);
    div('sb-line', this.el).style.bottom = `${B.target * B.height}px`;
    const pips = div('sb-pips', this.el);
    for (const k of PIPS) {
      const p = div('sb-pip', pips);
      p.textContent = PIP_LABEL[k];
      this.pips.set(k, p);
    }
  }

  /** the pips: done (green), not yet (hollow), or, once the set has gone (`final`), missed (orange) */
  private showPips(p: SetPips, final: boolean): void {
    const cls = PIPS.map((k) => (p[k] ? 'on' : final ? 'miss' : '')).join(',');
    if (cls === this.pipCls) return;
    this.pipCls = cls;
    PIPS.forEach((k) => (this.pips.get(k)!.className = `sb-pip ${p[k] ? 'on' : final ? 'miss' : ''}`));
  }

  /** game seconds the bar's full height stands for (the green line sits at `target` of it) */
  private static span(): number {
    return TIMING.setLoad / FX.setBar.target;
  }

  /** px from the bottom for `dt` game seconds after the catch, kept on the bar */
  private static px(dt: number): number {
    return Math.max(0, Math.min(1, dt / SetBar.span())) * FX.setBar.height;
  }

  private zone(z: HTMLDivElement, half: number): void {
    const target = TIMING.setLoad;
    const lo = SetBar.px(target - half);
    const hi = SetBar.px(target + half);
    z.style.bottom = `${lo}px`;
    z.style.height = `${Math.max(1, hi - lo)}px`;
  }

  /**
   * `p` the set loading in your hands (or null), `last` your last push, `t` the render time,
   * `realDt` real seconds since the last frame.
   */
  update(
    p: SetPreview | null,
    last: SetResult | null,
    ballPos: THREE.Vector3,
    camera: THREE.PerspectiveCamera,
    t: number,
    realDt: number,
    show: boolean,
    firstPerson = false,
  ): void {
    if (last && last !== this.shownFor) {
      this.shownFor = last;
      this.linger = FX.setBar.linger;
    }
    this.linger = Math.max(0, this.linger - realDt);
    const live = show && !!p;
    const after = show && !live && this.linger > 0 && !!this.shownFor;
    if (!live && !after) {
      this.el.style.display = 'none';
      return;
    }
    this.el.style.display = 'block';
    let fill = 0;
    let cls = '';
    if (live && p) {
      this.zone(this.good, p.good);
      this.zone(this.green, p.green);
      if (p.bar) fill = SetBar.px(t - p.bar.start);
      this.showPips(p.pips, false);
      this.el.style.opacity = p.bar ? '1' : String(FX.setBar.waiting);
      // waiting where the ball will be caught; then with the ball in your hands. In first person
      // that is on your face: the bar stands beside the crosshair instead
      if (firstPerson) this.placeAt(window.innerWidth / 2 + FX.setBar.fpX, window.innerHeight / 2);
      else this.place(p.bar ? ballPos : this.v.set(p.at.x, p.at.y, p.at.z), camera);
    } else {
      // it stays where it was: the ball has left
      const r = this.shownFor!;
      this.zone(this.good, r.good);
      this.zone(this.green, r.window);
      fill = SetBar.px(TIMING.setLoad + r.err);
      cls = r.green ? 'sb-hit-green' : r.grade === 'Good' ? 'sb-hit-good' : 'sb-hit-miss';
      this.showPips(r.pips, true);
      this.el.style.opacity = String(Math.min(1, this.linger / 0.25));
    }
    this.fill.style.height = `${fill}px`;
    this.fill.className = `sb-fill ${cls}`;
  }

  /** beside the ball on screen, the green line level with it; kept inside the view */
  private place(ballPos: THREE.Vector3, camera: THREE.PerspectiveCamera): void {
    const B = FX.setBar;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dist = Math.max(0.3, camera.position.distanceTo(ballPos));
    const v = this.v.copy(ballPos).project(camera);
    // behind the camera: park it right of centre
    const behind = v.z > 1;
    const sx = behind ? w * 0.6 : ((v.x + 1) / 2) * w;
    const sy = behind ? h * 0.5 : ((1 - v.y) / 2) * h;
    const rPx = (BALL.radius / (dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))) * (h / 2);
    this.placeAt(sx + rPx + B.gap, sy);
  }

  /** the bar's left edge at `left` px, its green line at `lineY` px; kept inside the view */
  private placeAt(left: number, lineY: number): void {
    const B = FX.setBar;
    const m = 8;
    // room on the right for the pips
    const x = Math.min(window.innerWidth - B.width - m - B.pipsWidth, Math.max(m, left));
    const y = Math.min(window.innerHeight - B.height - m, Math.max(m, lineY - (1 - B.target) * B.height));
    this.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }

  hide(): void {
    this.el.style.display = 'none';
    this.linger = 0;
  }
}
