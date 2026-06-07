import type { Point } from './types';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * View that maps between world coordinates and screen coordinates.
 * The transform is a simple similarity transform: screen = world * scale + translate.
 */
export class Viewport {
  scale = 1;
  tx = 0;
  ty = 0;

  constructor(
    public minScale = 0.2,
    public maxScale = 4,
  ) {}

  worldToScreen(p: Point): Point {
    return { x: p.x * this.scale + this.tx, y: p.y * this.scale + this.ty };
  }

  screenToWorld(p: Point): Point {
    return { x: (p.x - this.tx) / this.scale, y: (p.y - this.ty) / this.scale };
  }

  panBy(dx: number, dy: number): void {
    this.tx += dx;
    this.ty += dy;
  }

  /**
   * Zoom centered on the given screen point (Google-Maps style).
   * Adjusts translate so the world point under the cursor stays fixed across the zoom.
   */
  zoomAt(screen: Point, factor: number): void {
    const next = clamp(this.scale * factor, this.minScale, this.maxScale);
    const f = next / this.scale;
    this.tx = screen.x - (screen.x - this.tx) * f;
    this.ty = screen.y - (screen.y - this.ty) * f;
    this.scale = next;
  }

  setScale(scale: number): void {
    this.scale = clamp(scale, this.minScale, this.maxScale);
  }
}
