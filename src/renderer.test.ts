import { describe, it, expect } from 'vitest';
import { connectorLabelPoint, diamondBoxWidth, diamondInscribedWidth, fitLabel } from './renderer';
import type { Rect } from './types';

// Stub measurer: 10 units per UTF-16 code unit (ellipsis included).
const measure = (t: string) => t.length * 10;

describe('fitLabel', () => {
  it('returns the label unchanged when it fits', () => {
    expect(fitLabel(measure, 'hello', 50)).toBe('hello');
  });

  it('ellipsizes to the longest prefix that fits', () => {
    // 4 chars fit: 3 label chars + ellipsis = 40.
    expect(fitLabel(measure, 'hello world', 40)).toBe('hel…');
  });

  it('result never exceeds maxWidth', () => {
    for (const max of [0, 5, 10, 25, 40, 80, 200]) {
      const out = fitLabel(measure, 'a somewhat longer label', max);
      if (out) expect(measure(out)).toBeLessThanOrEqual(max);
    }
  });

  it("returns '' when not even the ellipsis fits", () => {
    expect(fitLabel(measure, 'hello', 5)).toBe('');
  });

  it('returns just the ellipsis when only it fits', () => {
    expect(fitLabel(measure, 'hello', 10)).toBe('…');
  });

  it('does not cut a surrogate pair in half', () => {
    // '😀' is 2 code units; cutting after 3 units of 'ab😀cd' would split it.
    const out = fitLabel(measure, 'ab😀cd', 40); // room for 3 code units + ellipsis
    expect(out).toBe('ab…');
  });
});

describe('diamondBoxWidth', () => {
  it('nominal case: inverts the inscribed-width constraint (w * (1 - textH/h) = labelW + 2*padding)', () => {
    // labelW=60, padding=10 -> required inscribed width 80; textH=20, h=100 -> factor 0.8.
    const w = diamondBoxWidth(60, 10, 20, 100);
    expect(w).toBeCloseTo(80 / 0.8);
    // Round-trip: that width, inscribed at the same textH/h, reproduces the target inscribed width.
    expect(w * (1 - 20 / 100)).toBeCloseTo(80);
  });

  it('effective-h rule: a caller-supplied fixed numeric height behaves like any other h', () => {
    // The dichotomy ("node's fixed numeric height" vs "measured fit-content height") is resolved
    // by the caller (RelationGraph.measureNode, untestable here per repo convention — canvas-bound);
    // diamondBoxWidth itself is just a pure function of h, so exercise it with two representative
    // h values standing in for either case and confirm both invert correctly.
    const fixedH = 120; // stands in for an explicit node.height
    const measuredFitH = 44; // stands in for a computed fit-content height (textH + 2*padY)
    const wFixed = diamondBoxWidth(50, 8, 16, fixedH);
    const wMeasured = diamondBoxWidth(50, 8, 16, measuredFitH);
    expect(wFixed * (1 - 16 / fixedH)).toBeCloseTo(50 + 16);
    expect(wMeasured * (1 - 16 / measuredFitH)).toBeCloseTo(50 + 16);
    // A smaller h (tighter diamond) demands more bounding width for the same label.
    expect(wMeasured).toBeGreaterThan(wFixed);
  });

  it('denominator <= 0 (textH >= h) falls back to the rect-equivalent width, never NaN/Infinity', () => {
    expect(diamondBoxWidth(60, 10, 20, 20)).toBe(80); // textH === h -> denom === 0
    expect(diamondBoxWidth(60, 10, 20, 10)).toBe(80); // textH > h -> denom < 0
    expect(diamondBoxWidth(60, 10, 20, 0)).toBe(80); // h === 0
    for (const h of [20, 10, 0, -5]) {
      const w = diamondBoxWidth(60, 10, 20, h);
      expect(Number.isFinite(w)).toBe(true);
      expect(Number.isNaN(w)).toBe(false);
    }
  });
});

describe('diamondInscribedWidth', () => {
  it('nominal case: shrinks a bounding width by (1 - textH/h)', () => {
    expect(diamondInscribedWidth(100, 20, 100)).toBeCloseTo(80);
  });

  it('is the inverse of diamondBoxWidth for the same (textH, h)', () => {
    const w = diamondBoxWidth(60, 10, 20, 100);
    expect(diamondInscribedWidth(w, 20, 100)).toBeCloseTo(80); // labelW + 2*padding
  });

  it('denominator <= 0 falls back to the bounding width itself, never NaN/Infinity', () => {
    expect(diamondInscribedWidth(100, 20, 20)).toBe(100);
    expect(diamondInscribedWidth(100, 20, 10)).toBe(100);
    expect(diamondInscribedWidth(100, 20, 0)).toBe(100);
    for (const h of [20, 10, 0, -5]) {
      const w = diamondInscribedWidth(100, 20, h);
      expect(Number.isFinite(w)).toBe(true);
    }
  });
});

describe('connectorLabelPoint', () => {
  const parent: Rect = { x: 0, y: 0, w: 100, h: 40 };

  it("'bottom' direction: midpoint of the middle (horizontal) segment", () => {
    const child: Rect = { x: 200, y: 140, w: 60, h: 30 };
    const p = connectorLabelPoint(parent, child, 'bottom');
    // from = parent bottom-center (50, 40); to = child top-center (230, 140).
    expect(p).toEqual({ x: (50 + 230) / 2, y: (40 + 140) / 2 });
  });

  it("'right' direction: midpoint of the middle (vertical) segment", () => {
    const child: Rect = { x: 300, y: -50, w: 60, h: 30 };
    const p = connectorLabelPoint(parent, child, 'right');
    // from = parent right-center (100, 20); to = child left-center (300, -35).
    expect(p).toEqual({ x: (100 + 300) / 2, y: (20 + -35) / 2 });
  });

  it("'left' and 'top' directions follow the same from/to-average rule", () => {
    const leftChild: Rect = { x: -200, y: 10, w: 50, h: 20 };
    const pLeft = connectorLabelPoint(parent, leftChild, 'left');
    expect(pLeft).toEqual({ x: (0 + -150) / 2, y: (20 + 20) / 2 });

    const topChild: Rect = { x: 10, y: -100, w: 40, h: 20 };
    const pTop = connectorLabelPoint(parent, topChild, 'top');
    expect(pTop).toEqual({ x: (50 + 30) / 2, y: (0 + -80) / 2 });
  });

  it('colinear parent/child (zero-length middle segment) still yields the from/to midpoint', () => {
    // Same y as parent's bottom-center row would make a 'right' connector's middle segment
    // collapse to zero length; the label point is still the plain from/to average.
    const child: Rect = { x: 200, y: 0, w: 60, h: 40 };
    const p = connectorLabelPoint(parent, child, 'right');
    expect(p).toEqual({ x: (100 + 200) / 2, y: (20 + 20) / 2 });
  });
});
