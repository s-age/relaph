import { describe, it, expect } from 'vitest';
import { layout, type LayoutConfig } from './layout';
import type { GraphNode, Rect } from './types';

const cfg: LayoutConfig = { nodeMargin: 20, rankMargin: 70, defaultWidth: 120, defaultHeight: 40 };
const cy = (r: Rect) => r.y + r.h / 2;

describe('layout — baseline alignment (vertical / right children)', () => {
  const build = (baseline: GraphNode['baseline']) => {
    const c1: GraphNode = { id: 'c1', direction: 'right' };
    const c2: GraphNode = { id: 'c2', direction: 'right' };
    const p: GraphNode = { id: 'p', baseline, children: [c1, c2] };
    const { rects } = layout(p, cfg);
    return { p: rects.get(p)!, c1: rects.get(c1)!, c2: rects.get(c2)! };
  };

  it("start: first child's top aligns to the parent's top", () => {
    const { p, c1 } = build('start');
    expect(c1.y).toBeCloseTo(p.y);
  });

  it("end: last child's bottom aligns to the parent's bottom", () => {
    const { p, c2 } = build('end');
    expect(c2.y + c2.h).toBeCloseTo(p.y + p.h);
  });

  it('center: group midpoint aligns to the parent center', () => {
    const { p, c1, c2 } = build('center');
    expect((cy(c1) + cy(c2)) / 2).toBeCloseTo(cy(p));
  });
});

describe('layout — even distribution with variable subtrees', () => {
  const c1: GraphNode = { id: 'c1', direction: 'right' };
  const g1: GraphNode = { id: 'g1', direction: 'bottom' };
  const g2: GraphNode = { id: 'g2', direction: 'bottom' };
  // c2 is asymmetric: its grandchildren extend downward.
  const c2: GraphNode = { id: 'c2', direction: 'right', baseline: 'start', children: [g1, g2] };
  const c3: GraphNode = { id: 'c3', direction: 'right' };
  const p: GraphNode = { id: 'p', baseline: 'center', children: [c1, c2, c3] };
  const { rects } = layout(p, cfg);
  const R = (n: GraphNode) => rects.get(n)!;

  it('spaces attachment points (node centers) evenly', () => {
    const d12 = cy(R(c2)) - cy(R(c1));
    const d23 = cy(R(c3)) - cy(R(c2));
    expect(d12).toBeCloseTo(d23);
  });

  it('parent attaches at the center of the child fan', () => {
    expect((cy(R(c1)) + cy(R(c3))) / 2).toBeCloseTo(cy(R(p)));
  });

  it('keeps subtrees from overlapping (>= nodeMargin gap)', () => {
    const c2Bottom = Math.max(R(c2).y + R(c2).h, R(g1).y + R(g1).h, R(g2).y + R(g2).h);
    const gap = R(c3).y - c2Bottom;
    expect(gap).toBeGreaterThanOrEqual(cfg.nodeMargin - 1e-6);
  });
});

describe("layout — 'fit-content' sizing", () => {
  // Stub measurer: 10 world units per label character, fixed height 30.
  const measured: LayoutConfig = {
    ...cfg,
    measureNode: (n) => ({ width: (n.label ?? '').length * 10, height: 30 }),
  };

  it('resolves width/height from measureNode', () => {
    const n: GraphNode = { id: 'n', label: 'hello', width: 'fit-content', height: 'fit-content' };
    const { rects } = layout(n, measured);
    expect(rects.get(n)!.w).toBe(50);
    expect(rects.get(n)!.h).toBe(30);
  });

  it('mixes per-axis: fixed height stays, fit-content width measures', () => {
    const n: GraphNode = { id: 'n', label: 'hello!', width: 'fit-content', height: 40 };
    const { rects } = layout(n, measured);
    expect(rects.get(n)!.w).toBe(60);
    expect(rects.get(n)!.h).toBe(40);
  });

  it('falls back to defaults when no measureNode is supplied', () => {
    const n: GraphNode = { id: 'n', label: 'hello', width: 'fit-content', height: 'fit-content' };
    const { rects } = layout(n, cfg);
    expect(rects.get(n)!.w).toBe(cfg.defaultWidth);
    expect(rects.get(n)!.h).toBe(cfg.defaultHeight);
  });

  it('variable-width siblings still keep >= nodeMargin gaps', () => {
    const kids: GraphNode[] = ['a', 'quite-a-long-label', 'mid'].map((label, i) => ({
      id: `c${i}`,
      label,
      width: 'fit-content',
      direction: 'bottom',
    }));
    const p: GraphNode = { id: 'p', children: kids };
    const { rects } = layout(p, measured);
    const rs = kids.map((k) => rects.get(k)!);
    for (let i = 0; i < rs.length - 1; i++) {
      expect(rs[i + 1]!.x - (rs[i]!.x + rs[i]!.w)).toBeGreaterThanOrEqual(measured.nodeMargin - 1e-6);
    }
  });
});

describe('layout — directions & bounds', () => {
  it('places children on the correct side and bounds enclose everything', () => {
    const r: GraphNode = { id: 'r', direction: 'right' };
    const l: GraphNode = { id: 'l', direction: 'left' };
    const t: GraphNode = { id: 't', direction: 'top' };
    const b: GraphNode = { id: 'b', direction: 'bottom' };
    const root: GraphNode = { id: 'root', children: [r, l, t, b] };
    const { rects, bounds } = layout(root, cfg);
    const ro = rects.get(root)!;

    expect(rects.get(r)!.x).toBeGreaterThan(ro.x + ro.w);
    expect(rects.get(l)!.x + rects.get(l)!.w).toBeLessThan(ro.x);
    expect(rects.get(t)!.y + rects.get(t)!.h).toBeLessThan(ro.y);
    expect(rects.get(b)!.y).toBeGreaterThan(ro.y + ro.h);

    for (const [, rr] of rects) {
      expect(rr.x).toBeGreaterThanOrEqual(bounds.minX - 1e-6);
      expect(rr.y).toBeGreaterThanOrEqual(bounds.minY - 1e-6);
      expect(rr.x + rr.w).toBeLessThanOrEqual(bounds.maxX + 1e-6);
      expect(rr.y + rr.h).toBeLessThanOrEqual(bounds.maxY + 1e-6);
    }
  });

  it('nests arbitrarily deep without throwing', () => {
    let node: GraphNode = { id: 'leaf', direction: 'right' };
    for (let i = 0; i < 50; i++) node = { id: `n${i}`, direction: 'right', children: [node] };
    const { rects } = layout(node, cfg);
    expect(rects.size).toBe(51); // leaf + 50 wrapper levels
  });
});
