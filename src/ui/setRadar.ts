import { CONTACT, FX } from '../config';

/**
 * Where to stand for your set, in first person: looking up at the ball you can't see the floor
 * spot, so a small dial under the crosshair shows it from above. The mark in the middle is your
 * feet, up is where you are looking (so it reads like your move keys), and the ring is the spot:
 * walk towards the ring until it sits on your feet and turns green. A spot further away than
 * the dial reaches is pinned to its edge, in the direction to go.
 */
export class SetRadar {
  private el: HTMLDivElement;
  private ring: HTMLDivElement;
  private shown = false;

  constructor(parent: HTMLElement) {
    const R = FX.setRadar;
    this.el = document.createElement('div');
    this.el.className = 'set-radar';
    this.el.style.width = this.el.style.height = `${R.size}px`;
    this.el.style.marginTop = `${R.below}px`;
    const feet = document.createElement('div');
    feet.className = 'sr-feet';
    this.ring = document.createElement('div');
    this.ring.className = 'sr-spot';
    const d = Math.round(((2 * CONTACT.setCentreOk) / R.range) * (R.size / 2));
    this.ring.style.width = this.ring.style.height = `${d}px`;
    this.el.append(this.ring, feet);
    parent.appendChild(this.el);
  }

  /** px on the dial (x right, y down) for a spot `dx, dz` m from the feet, looking along `yaw` */
  static offset(dx: number, dz: number, yaw: number): { x: number; y: number; far: boolean } {
    const R = FX.setRadar;
    // right and forward of where you look (the move keys' frame, as UserController)
    let u = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    let v = -dx * Math.sin(yaw) - dz * Math.cos(yaw);
    const d = Math.hypot(u, v);
    const far = d > R.range;
    if (far) {
      u *= R.range / d;
      v *= R.range / d;
    }
    const k = R.size / 2 / R.range;
    return { x: u * k, y: -v * k, far };
  }

  /** `spot` your feet's spot (null: hide), `feet` where they are, `yaw` where the camera looks */
  update(spot: { x: number; z: number } | null, feet: { x: number; z: number }, yaw: number): void {
    if (!spot) {
      if (this.shown) this.el.style.display = 'none';
      this.shown = false;
      return;
    }
    if (!this.shown) this.el.style.display = 'block';
    this.shown = true;
    const dx = spot.x - feet.x;
    const dz = spot.z - feet.z;
    const o = SetRadar.offset(dx, dz, yaw);
    this.ring.style.transform = `translate(-50%, -50%) translate(${o.x.toFixed(1)}px, ${o.y.toFixed(1)}px)`;
    const on = Math.hypot(dx, dz) <= CONTACT.setCentreOk;
    this.ring.className = `sr-spot${on ? ' on' : o.far ? ' far' : ''}`;
  }

  hide(): void {
    this.el.style.display = 'none';
    this.shown = false;
  }
}
