import { describe, it, expect } from 'vitest';
import { Viewport } from './viewport';

describe('Viewport', () => {
  it('round-trips world <-> screen', () => {
    const vp = new Viewport();
    vp.scale = 2;
    vp.tx = 30;
    vp.ty = -10;
    const world = { x: 12, y: 34 };
    const back = vp.screenToWorld(vp.worldToScreen(world));
    expect(back.x).toBeCloseTo(world.x);
    expect(back.y).toBeCloseTo(world.y);
  });

  it('zoomAt keeps the world point under the cursor fixed', () => {
    const vp = new Viewport(0.1, 10);
    const cursor = { x: 200, y: 120 };
    const before = vp.screenToWorld(cursor);
    vp.zoomAt(cursor, 1.7);
    const after = vp.screenToWorld(cursor);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(vp.scale).toBeCloseTo(1.7);
  });

  it('clamps scale to [minScale, maxScale]', () => {
    const vp = new Viewport(0.5, 2);
    vp.zoomAt({ x: 0, y: 0 }, 100);
    expect(vp.scale).toBe(2);
    vp.zoomAt({ x: 0, y: 0 }, 0.0001);
    expect(vp.scale).toBe(0.5);
  });

  it('panBy translates the view', () => {
    const vp = new Viewport();
    vp.panBy(5, -3);
    vp.panBy(2, 1);
    expect(vp.tx).toBe(7);
    expect(vp.ty).toBe(-2);
  });
});
