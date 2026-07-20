import { describe, it, expect } from 'vitest';
import { layout, type LayoutConfig } from './layout';
import type { GraphNode, JoinEdge } from './types';

const base: Omit<LayoutConfig, 'rankMarginX' | 'rankMarginY'> = {
  nodeMargin: 20,
  rankMargin: 70,
  defaultWidth: 120,
  defaultHeight: 40,
};

describe('layout — rankMarginX / rankMarginY (axis-split rank margin)', () => {
  it('rankMarginX alone changes only the vertical-stack (right/left) gap; rankMarginY untouched falls back to rankMargin', () => {
    const child: GraphNode = { id: 'child', direction: 'right' };
    const root: GraphNode = { id: 'root', children: [child] };

    const plain = layout(root, base as LayoutConfig);
    const withX = layout(root, { ...base, rankMarginX: 200 } as LayoutConfig);

    const plainChild = plain.rects.get(child)!;
    const xChild = withX.rects.get(child)!;
    const rootRect = plain.rects.get(root)!;

    // Gap grows by exactly the rankMarginX delta.
    expect(xChild.x - plainChild.x).toBeCloseTo(200 - base.rankMargin);
    expect(xChild.x).toBeCloseTo(rootRect.w + 200);
  });

  it('rankMarginY alone changes only the horizontal-stack (top/bottom) gap, not the vertical-stack gap', () => {
    const right: GraphNode = { id: 'right', direction: 'right' };
    const bottom: GraphNode = { id: 'bottom', direction: 'bottom' };
    const root: GraphNode = { id: 'root', children: [right, bottom] };

    const plain = layout(root, base as LayoutConfig);
    const withY = layout(root, { ...base, rankMarginY: 200 } as LayoutConfig);

    // right/left axis (rankMarginX) is untouched by rankMarginY.
    expect(withY.rects.get(right)!.x).toBeCloseTo(plain.rects.get(right)!.x);
    // top/bottom axis (rankMarginY) moves by exactly the delta.
    const plainBottom = plain.rects.get(bottom)!;
    const yBottom = withY.rects.get(bottom)!;
    expect(yBottom.y - plainBottom.y).toBeCloseTo(200 - base.rankMargin);
  });

  it('rankMarginY also drives the confluence reposition gap (applyConfluences)', () => {
    const b1: GraphNode = { id: 'b1', direction: 'bottom' };
    const b2: GraphNode = { id: 'b2', direction: 'bottom' };
    const cont: GraphNode = { id: 'cont', direction: 'bottom' };
    const root: GraphNode = { id: 'fork', children: [b1, b2, cont] };
    const joinEdges: JoinEdge[] = [
      { from: 'b1', to: 'cont' },
      { from: 'b2', to: 'cont' },
    ];

    const plain = layout(root, base as LayoutConfig, joinEdges);
    const withY = layout(root, { ...base, rankMarginY: 200 } as LayoutConfig, joinEdges);

    const plainR1 = plain.rects.get(b1)!;
    const plainR2 = plain.rects.get(b2)!;
    const plainTop = Math.max(plainR1.y + plainR1.h, plainR2.y + plainR2.h) + base.rankMargin;

    // b1/b2 themselves also sit on the rankMarginY axis (fork -> bottom-direction children), so
    // their own y shifts too — recompute the expectation from withY's OWN b1/b2 rects.
    const yR1 = withY.rects.get(b1)!;
    const yR2 = withY.rects.get(b2)!;
    const withYTop = Math.max(yR1.y + yR1.h, yR2.y + yR2.h) + 200;

    expect(plain.rects.get(cont)!.y).toBeCloseTo(plainTop);
    expect(withY.rects.get(cont)!.y).toBeCloseTo(withYTop);
  });

  it('a bare rankMargin number (no rankMarginX/Y) applies identically to both axes — full back-compat', () => {
    const right: GraphNode = { id: 'right', direction: 'right' };
    const bottom: GraphNode = { id: 'bottom', direction: 'bottom' };
    const root: GraphNode = { id: 'root', children: [right, bottom] };

    const bothAxes = layout(root, { ...base, rankMargin: 90 } as LayoutConfig);
    const explicitXY = layout(root, { ...base, rankMargin: 1, rankMarginX: 90, rankMarginY: 90 } as LayoutConfig);

    expect(bothAxes.rects.get(right)!.x).toBeCloseTo(explicitXY.rects.get(right)!.x);
    expect(bothAxes.rects.get(bottom)!.y).toBeCloseTo(explicitXY.rects.get(bottom)!.y);
  });
});
