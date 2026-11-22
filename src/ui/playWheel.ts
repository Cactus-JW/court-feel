import { FX } from '../config';
import { CALL_COLOR } from '../game/callRuns';
import { comboPlay, COMBOS, type Combo } from '../game/combos';
import { wheelPlays } from '../game/playbook';
import { SETTER_SPOT } from '../game/plays';
import { SETTER_KEYS } from '../game/setterCalls';

const SVG = 'http://www.w3.org/2000/svg';

/** which of `n` slices a pull of (x, y) px picks: 0 at the top, then clockwise; -1 inside the dead zone */
export function wheelSlice(x: number, y: number, n: number, dead: number): number {
  if (Math.hypot(x, y) < dead) return -1;
  const turn = Math.atan2(x, -y) / (2 * Math.PI);
  return ((Math.round(turn * n) % n) + n) % n;
}

/**
 * The play wheel: the setter's combinations (COMBOS, or your own play where you saved one: the
 * start screen's Plays), called before the pass like a hand signal behind the back. Hold C and move the mouse towards a play, let go to call it (or press its
 * number; on touch, hold PLAY, slide onto a play and let go, or tap PLAY, then touch a play and
 * let go: the touch controls hand a finger on the open wheel to `pointAt`). The centre shows what the play is: every
 * hitter's run on a little court, and their calls. It only sets the calls: who gets the ball is
 * still yours to choose at the touch.
 */
export class PlayWheel {
  open = false;
  /** the slice the mouse is on (-1: none yet) */
  sel = -1;
  private x = 0;
  private y = 0;
  private el: HTMLDivElement;
  private slices: SVGPathElement[] = [];
  private labels: SVGTextElement[] = [];
  private plays: readonly Combo[] = COMBOS;
  private name: HTMLDivElement;
  private idea: HTMLDivElement;
  private court: SVGSVGElement;
  private shown = -2;
  /** the touch controls are on (`TouchControls.setEnabled`): the centre says how a finger calls a play */
  touch = false;
  private shownTouch = false;
  private on = -1;

  /** `tap(i)`: a slice was tapped (touch): the game presses that play's number through Input */
  constructor(parent: HTMLElement, tap: (i: number) => void) {
    const W = FX.playWheel;
    const c = W.size / 2;
    const r0 = W.hole / 2;
    const r1 = c;
    const n = COMBOS.length;
    const at = (r: number, turn: number) =>
      `${(c + r * Math.sin(turn * 2 * Math.PI)).toFixed(1)} ${(c - r * Math.cos(turn * 2 * Math.PI)).toFixed(1)}`;
    this.el = document.createElement('div');
    this.el.className = 'play-wheel';
    this.el.style.width = this.el.style.height = `${W.size}px`;
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W.size} ${W.size}`);
    COMBOS.forEach((_, i) => {
      const a0 = (i - 0.5) / n;
      const a1 = (i + 0.5) / n;
      const p = document.createElementNS(SVG, 'path');
      p.setAttribute(
        'd',
        `M ${at(r0, a0)} L ${at(r1, a0)} A ${r1} ${r1} 0 0 1 ${at(r1, a1)} L ${at(r0, a1)} A ${r0} ${r0} 0 0 0 ${at(r0, a0)} Z`,
      );
      p.setAttribute('class', 'pw-slice');
      p.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        tap(i);
      });
      svg.appendChild(p);
      this.slices.push(p);
      const [x, y] = at((r0 + r1) / 2, i / n).split(' ');
      const num = document.createElementNS(SVG, 'text');
      num.setAttribute('x', x);
      num.setAttribute('y', String(+y - 9));
      num.setAttribute('class', 'pw-num');
      num.textContent = String(i + 1);
      const t = document.createElementNS(SVG, 'text');
      t.setAttribute('x', x);
      t.setAttribute('y', String(+y + 8));
      t.setAttribute('class', 'pw-label');
      this.labels.push(t);
      svg.append(num, t);
    });
    const mid = document.createElement('div');
    mid.className = 'pw-mid';
    mid.style.width = mid.style.height = `${W.hole - 14}px`;
    this.name = document.createElement('div');
    this.name.className = 'pw-name';
    this.court = document.createElementNS(SVG, 'svg');
    this.court.setAttribute('viewBox', '0 0 120 62');
    this.court.setAttribute('class', 'pw-court');
    this.idea = document.createElement('div');
    this.idea.className = 'pw-idea';
    mid.append(this.name, this.court, this.idea);
    this.el.append(svg, mid);
    parent.appendChild(this.el);
  }

  /** every hitter's run for a combination, on a little court seen from above (the net at the top) */
  private static runs(combo: Combo): string {
    const px = (x: number) => (60 + x * 10.6).toFixed(1);
    const py = (z: number) => (6 + z * 8.6).toFixed(1);
    let s = `<line x1="4" y1="6" x2="116" y2="6" class="pw-net"/><circle cx="${px(SETTER_SPOT.x)}" cy="${py(SETTER_SPOT.z)}" r="2.6" class="pw-setter"/>`;
    for (const k of SETTER_KEYS) {
      const lane = comboPlay(combo, k)?.lane;
      if (!lane) continue;
      const col = `#${CALL_COLOR[k].toString(16).padStart(6, '0')}`;
      s += `<line x1="${px(lane.sx)}" y1="${py(lane.sz)}" x2="${px(lane.x)}" y2="${py(lane.z)}" stroke="${col}" class="pw-run"/>`;
      s += `<circle cx="${px(lane.x)}" cy="${py(lane.z)}" r="2.4" fill="${col}"/>`;
    }
    return s;
  }

  /** open it; `current` is the combination the calls make now (marked on the wheel) */
  show(current: Combo | null): void {
    this.open = true;
    this.x = this.y = 0;
    this.sel = -1;
    // (your plays can change between two openings)
    this.plays = wheelPlays();
    this.labels.forEach((t, i) => (t.textContent = this.plays[i].name));
    this.on = current ? this.plays.indexOf(current) : -1;
    this.shown = -2;
    this.el.style.display = 'block';
    this.draw();
  }

  /** the ball is in play: the wheel sits at the side, off the court (a pick goes by direction) */
  setAside(aside: boolean): void {
    this.el.classList.toggle('aside', aside);
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.el.style.display = 'none';
  }

  /** the mouse moved `dx, dy` px: pull towards a slice */
  move(dx: number, dy: number): void {
    const W = FX.playWheel;
    this.x += dx;
    this.y += dy;
    const l = Math.hypot(this.x, this.y);
    if (l > W.reach) {
      this.x *= W.reach / l;
      this.y *= W.reach / l;
    }
    this.sel = wheelSlice(this.x, this.y, COMBOS.length, W.dead);
    this.draw();
  }

  /**
   * A finger at (x, y) on the screen (touch, PLAY held): the pull points at the slice under it, so
   * letting go of PLAY calls that play. In the centre: no pull (letting go calls nothing).
   */
  pointAt(x: number, y: number): number {
    const v = this.local(x, y);
    if (!v) return -1;
    const W = FX.playWheel;
    const l = Math.hypot(v.x, v.y);
    const f = l < W.hole / 2 ? 0 : W.reach / l;
    this.x = v.x * f;
    this.y = v.y * f;
    this.sel = wheelSlice(this.x, this.y, COMBOS.length, W.dead);
    this.draw();
    return this.sel;
  }

  /** the finger that pointed is gone without a call: no pull, nothing picked */
  unpoint(): void {
    this.x = this.y = 0;
    this.sel = -1;
    this.draw();
  }

  /** is the screen point (x, y) on the open wheel (inside its outer edge)? */
  contains(x: number, y: number): boolean {
    const v = this.open ? this.local(x, y) : null;
    return !!v && Math.hypot(v.x, v.y) <= FX.playWheel.size / 2;
  }

  /** a screen point in the wheel's own px from its centre (it is drawn smaller while the ball is in play) */
  private local(x: number, y: number): { x: number; y: number } | null {
    const r = this.el.getBoundingClientRect();
    if (!r.width) return null;
    const k = FX.playWheel.size / r.width;
    return { x: (x - (r.left + r.width / 2)) * k, y: (y - (r.top + r.height / 2)) * k };
  }

  private draw(): void {
    const show = this.sel >= 0 ? this.sel : this.on;
    if (show === this.shown && this.touch === this.shownTouch) return;
    this.shown = show;
    this.shownTouch = this.touch;
    this.slices.forEach((p, i) => p.setAttribute('class', `pw-slice${i === this.sel ? ' sel' : i === this.on ? ' on' : ''}`));
    const combo = show >= 0 ? this.plays[show] : null;
    this.name.textContent = combo ? combo.name : 'Call a play';
    this.idea.textContent = combo
      ? combo.idea
      : this.touch
        ? 'Slide onto a play and let go, or tap it'
        : 'Move towards a play, or press its number';
    this.court.innerHTML = combo ? PlayWheel.runs(combo) : '';
  }
}
