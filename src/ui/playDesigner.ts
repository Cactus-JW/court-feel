import { COURT, PLAYBOOK } from '../config';
import { CALL_COLOR } from '../game/callRuns';
import { COMBOS } from '../game/combos';
import { clampRoute, cleanName, playbook, routeOf, routePlay, routesOf, savePlay, TEMPO_LABEL, TEMPOS, wheelPlays } from '../game/playbook';
import { SETTER_PLAYS, SETTER_SPOT } from '../game/plays';
import { SETTER_KEYS, type SetterKey } from '../game/setterCalls';

const SVG = 'http://www.w3.org/2000/svg';
/** the court drawing: px per metre, the margin beside the sidelines and above the net (m), and how deep it shows (m) */
const S = 40;
const SIDE = 1.0;
const TOP = 0.5;
const DEEP = 6.5;
const px = (x: number) => (x + COURT.halfWidth + SIDE) * S;
const py = (z: number) => (z + TOP) * S;

const WHO: Record<SetterKey, string> = { OH: 'Outside', MB: 'Middle', OPP: 'Opposite', PIPE: 'Back row' };
const hex = (k: SetterKey) => `#${CALL_COLOR[k].toString(16).padStart(6, '0')}`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

function button(cls: string, text = ''): HTMLButtonElement {
  const b = el('button', cls, text);
  b.type = 'button';
  return b;
}

function setOn(e: HTMLElement, on: boolean): void {
  e.classList.toggle('on', on);
  e.setAttribute('aria-pressed', String(on));
}

/**
 * Plays: design your own play and put it on the play wheel. Pick the place on the wheel it
 * takes, then give every hitter a route on the court: drag the ring to where their run starts
 * and the dot to where they hit (or move them with the arrow keys), and choose the tempo of
 * their set; a hitter's own calls are one tap. Name it and save: it replaces the play in that
 * place until you put the built-in one back. Everything is kept to what the hitters can run
 * (src/game/playbook.ts), so a saved play always works on court.
 */
export function buildPlayDesigner(): HTMLElement {
  let slot = 0;
  let routes = routesOf(COMBOS[0]);
  const body = el('div', 'sheet-body plays-body');

  // ------------------------------------------------------------ the wheel's places
  const slots = el('div', 'pd-slots');
  slots.setAttribute('role', 'group');
  slots.setAttribute('aria-label', 'Place on the play wheel');
  slots.append(el('h2', 'eyebrow', 'On the wheel'));
  const slotBtns = COMBOS.map((_, i) => {
    const b = button('row pd-slot');
    b.onclick = () => load(i);
    slots.append(b);
    return b;
  });

  // ------------------------------------------------------------ the court
  const mid = el('div', 'pd-mid');
  const W = (COURT.halfWidth + SIDE) * 2 * S;
  const H = (DEEP + TOP) * S;
  const court = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'pd-court',
    role: 'group',
    'aria-label': 'Your side of the court, the net at the top',
  });
  court.append(
    svgEl('rect', { x: px(-COURT.halfWidth), y: py(0), width: COURT.halfWidth * 2 * S, height: DEEP * S, class: 'pd-floor' }),
    svgEl('line', {
      x1: px(-COURT.halfWidth),
      y1: py(COURT.attackLine),
      x2: px(COURT.halfWidth),
      y2: py(COURT.attackLine),
      class: 'pd-line',
    }),
    svgEl('line', { x1: px(-COURT.halfWidth - 0.6), y1: py(0), x2: px(COURT.halfWidth + 0.6), y2: py(0), class: 'pd-net' }),
    svgEl('circle', { cx: px(SETTER_SPOT.x), cy: py(SETTER_SPOT.z), r: 9, class: 'pd-setter' }),
  );
  const you = svgEl('text', { x: px(SETTER_SPOT.x), y: py(SETTER_SPOT.z), class: 'pd-key' });
  you.textContent = 'S';
  court.append(you);

  /** where the ball is hit on the drawing (the designer only moves it along the net) */
  const hitZ = (k: SetterKey) => routePlay(k, routes[k]).lane.z;
  const parts = new Map<SetterKey, { run: SVGPathElement; start: SVGCircleElement; hit: SVGCircleElement; key: SVGTextElement }>();

  /** a handle on the court: dragged with the pointer, or moved with the arrow keys */
  const handle = (k: SetterKey, part: 'start' | 'hit', node: SVGCircleElement) => {
    node.setAttribute('tabindex', '0');
    node.setAttribute('role', 'slider');
    node.setAttribute(
      'aria-label',
      `${WHO[k]}: ${part === 'start' ? 'where the run starts' : 'where the ball is hit'}. Arrow keys move it.`,
    );
    const move = (x: number, z: number) => {
      const r = routes[k];
      routes[k] = clampRoute(k, part === 'start' ? { ...r, sx: x, sz: z } : { ...r, x });
      draw();
    };
    node.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      node.setPointerCapture(e.pointerId);
      node.focus({ preventScroll: true });
    });
    node.addEventListener('pointermove', (e) => {
      if (!node.hasPointerCapture(e.pointerId)) return;
      const m = court.getScreenCTM();
      if (!m) return;
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
      move(p.x / S - COURT.halfWidth - SIDE, p.y / S - TOP);
    });
    node.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.5 : 0.1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dz = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      if (!dx && !dz) return;
      e.preventDefault();
      const r = routes[k];
      move((part === 'start' ? r.sx : r.x) + dx, r.sz + dz);
    });
  };

  SETTER_KEYS.forEach((k, i) => {
    const run = svgEl('path', { class: 'pd-run', stroke: hex(k) });
    const start = svgEl('circle', { r: 9, class: 'pd-start', stroke: hex(k) });
    const hit = svgEl('circle', { r: 12, class: 'pd-hit', fill: hex(k) });
    const key = svgEl('text', { class: 'pd-key' });
    key.textContent = String(i + 1);
    handle(k, 'start', start);
    handle(k, 'hit', hit);
    court.append(run, start, hit, key);
    parts.set(k, { run, start, hit, key });
  });

  const tip = el('p', 'pd-note', 'Drag a ring to where a run starts and a dot to where the ball is hit, or move them with the arrow keys.');
  const save = el('div', 'pd-save');
  const name = el('input', 'pd-name');
  name.type = 'text';
  name.maxLength = PLAYBOOK.nameMax;
  name.setAttribute('aria-label', 'The name of your play');
  name.placeholder = 'Name your play';
  name.autocomplete = 'off';
  const saveBtn = button('play-btn');
  const reset = button('ghost-btn');
  save.append(name, saveBtn, reset);
  const status = el('p', 'pd-note');
  status.setAttribute('role', 'status');
  mid.append(court, tip, save, status);

  // ------------------------------------------------------------ the hitters
  const hitters = el('div', 'pd-hitters');
  const cards = new Map<SetterKey, { set: HTMLElement; calls: HTMLButtonElement[]; tempos: HTMLButtonElement[] }>();
  const chips = (label: string, options: readonly string[], pick: (i: number) => void) => {
    const row = el('div', 'pd-row');
    const group = el('div', 'chips');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', label);
    const btns = options.map((o, i) => {
      const b = button('chip', o);
      b.onclick = () => pick(i);
      group.append(b);
      return b;
    });
    row.append(el('span', 'pd-lab', label), group);
    return { row, btns };
  };
  SETTER_KEYS.forEach((k, i) => {
    const card = el('section', 'pd-hitter');
    card.style.setProperty('--c', hex(k));
    const head = el('div', 'pd-who');
    const set = el('span', 'pd-set');
    head.append(el('span', 'pd-dot'), el('span', '', `${i + 1} · ${WHO[k]}`), set);
    const calls = chips(
      `${WHO[k]}: their calls`,
      SETTER_PLAYS[k].map((p) => p.short),
      (n) => {
        routes[k] = clampRoute(k, routeOf(SETTER_PLAYS[k][n]));
        draw();
      },
    );
    const tempos = chips(
      `${WHO[k]}: tempo`,
      TEMPOS[k].map((t) => TEMPO_LABEL[t]),
      (n) => {
        routes[k] = clampRoute(k, { ...routes[k], tempo: TEMPOS[k][n] });
        draw();
      },
    );
    calls.row.firstElementChild!.textContent = 'Call';
    tempos.row.firstElementChild!.textContent = 'Tempo';
    card.append(head, calls.row, tempos.row);
    hitters.append(card);
    cards.set(k, { set, calls: calls.btns, tempos: tempos.btns });
  });

  // ------------------------------------------------------------ drawing
  const drawSlots = () => {
    const book = playbook();
    wheelPlays().forEach((c, i) => {
      const b = slotBtns[i];
      const main = el('span', 'row-main');
      main.append(el('span', 'row-t', c.name), el('span', 'row-s', SETTER_KEYS.map((k) => c.calls[k]).join(' · ')));
      b.replaceChildren(el('span', 'pd-num', String(i + 1)), main);
      if (book[i]) b.append(el('span', 'tag ready', 'Yours'));
      setOn(b, i === slot);
    });
  };

  function draw(): void {
    for (const k of SETTER_KEYS) {
      const r = routes[k];
      const p = parts.get(k)!;
      const z = hitZ(k);
      // the run loops in: it leaves along the net and turns towards it (as the hitters run it)
      const cx = r.x + (r.sx - r.x) * 0.3;
      const cz = z + (r.sz - z) * 0.7;
      p.run.setAttribute('d', `M ${px(r.sx)} ${py(r.sz)} Q ${px(cx)} ${py(cz)} ${px(r.x)} ${py(z)}`);
      p.start.setAttribute('cx', String(px(r.sx)));
      p.start.setAttribute('cy', String(py(r.sz)));
      p.hit.setAttribute('cx', String(px(r.x)));
      p.hit.setAttribute('cy', String(py(z)));
      p.key.setAttribute('x', String(px(r.x)));
      p.key.setAttribute('y', String(py(z)));
      const play = routePlay(k, r);
      const own = SETTER_PLAYS[k].indexOf(play);
      const c = cards.get(k)!;
      const side = r.x < SETTER_SPOT.x ? 'in front of you' : 'behind you';
      c.set.textContent =
        own >= 0
          ? play.name
          : `${TEMPO_LABEL[r.tempo]}, ${Math.abs(r.x - SETTER_SPOT.x).toFixed(1)} m ${k === 'PIPE' ? 'along the net' : side}`;
      c.calls.forEach((b, n) => setOn(b, n === own));
      c.tempos.forEach((b, n) => setOn(b, TEMPOS[k][n] === r.tempo));
    }
    saveBtn.textContent = `SAVE TO ${slot + 1}`;
  }

  function load(i: number): void {
    slot = i;
    const saved = playbook()[i];
    routes = saved ? { ...saved.routes } : routesOf(COMBOS[i]);
    name.value = saved?.name ?? '';
    reset.textContent = `Put ${COMBOS[i].name} back`;
    reset.hidden = !saved;
    status.textContent = '';
    drawSlots();
    draw();
  }

  saveBtn.onclick = () => {
    const n = cleanName(name.value) || `My play ${slot + 1}`;
    savePlay(slot, { name: n, routes });
    load(slot);
    status.textContent = `Saved. ${n} is play ${slot + 1} on the wheel: hold C when you set.`;
  };
  reset.onclick = () => {
    savePlay(slot, null);
    load(slot);
    status.textContent = `${COMBOS[slot].name} is back on the wheel.`;
  };

  body.append(slots, mid, hitters);
  load(0);
  return body;
}
