import { describe, it, expect } from 'vitest';
import { layout, type LayoutConfig } from './layout';
import { render, type RenderContext } from './renderer';
import type { GraphNode, JoinEdge, Rect } from './types';

const cfg: LayoutConfig = { nodeMargin: 20, rankMargin: 70, defaultWidth: 120, defaultHeight: 40 };
const cx = (r: Rect) => r.x + r.w / 2;
const cy = (r: Rect) => r.y + r.h / 2;

describe('layout — confluence reposition', () => {
  it('centers a confluence below its sources (single fork, two tracked branches)', () => {
    const b1: GraphNode = { id: 'b1', direction: 'bottom' };
    const b2: GraphNode = { id: 'b2', direction: 'bottom' };
    const cont: GraphNode = { id: 'cont', direction: 'bottom' };
    const root: GraphNode = { id: 'fork', children: [b1, b2, cont] };
    const joinEdges: JoinEdge[] = [
      { from: 'b1', to: 'cont' },
      { from: 'b2', to: 'cont' },
    ];
    const { rects } = layout(root, cfg, joinEdges);
    const R1 = rects.get(b1)!;
    const R2 = rects.get(b2)!;
    const RC = rects.get(cont)!;

    const expectedTop = Math.max(R1.y + R1.h, R2.y + R2.h) + cfg.rankMargin;
    expect(RC.y).toBeCloseTo(expectedTop);
    expect(cx(RC)).toBeCloseTo((cx(R1) + cx(R2)) / 2);
  });

  it('shifts the confluence subtree as a block (descendant offset preserved)', () => {
    const b1: GraphNode = { id: 'b1', direction: 'bottom' };
    const b2: GraphNode = { id: 'b2', direction: 'bottom' };
    const tail: GraphNode = { id: 'tail', direction: 'bottom' };
    const cont: GraphNode = { id: 'cont', direction: 'bottom', children: [tail] };
    const root: GraphNode = { id: 'fork', children: [b1, b2, cont] };

    // Baseline: no joinEdges, plain tree layout — capture the pre-shift local offset between
    // `cont` and its child `tail`.
    const plain = layout(root, cfg);
    const plainCont = plain.rects.get(cont)!;
    const plainTail = plain.rects.get(tail)!;
    const offsetX = plainTail.x - plainCont.x;
    const offsetY = plainTail.y - plainCont.y;

    const joinEdges: JoinEdge[] = [
      { from: 'b1', to: 'cont' },
      { from: 'b2', to: 'cont' },
    ];
    const { rects } = layout(root, cfg, joinEdges);
    const RC = rects.get(cont)!;
    const RT = rects.get(tail)!;
    expect(RT.x - RC.x).toBeCloseTo(offsetX);
    expect(RT.y - RC.y).toBeCloseTo(offsetY);
  });

  it('handles nesting: an outer confluence uses the FINAL (post-shift) position of a source buried inside an inner confluence', () => {
    // Outer fork "A" has two branches: b1 (single node) and a branch containing a nested
    // fork ("b2fork") whose own confluence ("b2confluence") continues to "b2tail" — the
    // overall tail of that branch. Outer confluence "confA" joins from b1 and b2tail.
    const c1: GraphNode = { id: 'c1', direction: 'bottom' };
    const c2: GraphNode = { id: 'c2', direction: 'bottom' };
    const b2tail: GraphNode = { id: 'b2tail', direction: 'bottom' };
    const b2confluence: GraphNode = { id: 'b2confluence', direction: 'bottom', children: [b2tail] };
    const b2fork: GraphNode = { id: 'b2fork', direction: 'bottom', children: [c1, c2, b2confluence] };
    const b1: GraphNode = { id: 'b1', direction: 'bottom' };
    const confA: GraphNode = { id: 'confA', direction: 'bottom' };
    const root: GraphNode = { id: 'A', children: [b1, b2fork, confA] };

    const joinEdges: JoinEdge[] = [
      { from: 'c1', to: 'b2confluence' },
      { from: 'c2', to: 'b2confluence' },
      { from: 'b1', to: 'confA' },
      { from: 'b2tail', to: 'confA' },
    ];
    const { rects } = layout(root, cfg, joinEdges);

    const RC1 = rects.get(c1)!;
    const RC2 = rects.get(c2)!;
    const RInner = rects.get(b2confluence)!;
    const RB2Tail = rects.get(b2tail)!;
    const RB1 = rects.get(b1)!;
    const ROuter = rects.get(confA)!;

    // Inner confluence lands below c1/c2.
    expect(RInner.y).toBeCloseTo(Math.max(RC1.y + RC1.h, RC2.y + RC2.h) + cfg.rankMargin);
    expect(cx(RInner)).toBeCloseTo((cx(RC1) + cx(RC2)) / 2);

    // Outer confluence must be computed from b2tail's FINAL (post-inner-shift) rect, not a
    // stale pre-shift one — this is the assertion that would fail under naive single-pass /
    // wrong-order processing.
    const expectedOuterTop = Math.max(RB1.y + RB1.h, RB2Tail.y + RB2Tail.h) + cfg.rankMargin;
    expect(ROuter.y).toBeCloseTo(expectedOuterTop);
    expect(cx(ROuter)).toBeCloseTo((cx(RB1) + cx(RB2Tail)) / 2);
  });

  it('omitted / empty joinEdges reproduce the plain tree layout exactly', () => {
    const b1: GraphNode = { id: 'b1', direction: 'bottom' };
    const b2: GraphNode = { id: 'b2', direction: 'bottom' };
    const cont: GraphNode = { id: 'cont', direction: 'bottom' };
    const root: GraphNode = { id: 'fork', children: [b1, b2, cont] };

    const noArg = layout(root, cfg);
    const emptyArg = layout(root, cfg, []);
    const undefinedArg = layout(root, cfg, undefined);

    for (const node of [root, b1, b2, cont]) {
      expect(emptyArg.rects.get(node)).toEqual(noArg.rects.get(node));
      expect(undefinedArg.rects.get(node)).toEqual(noArg.rects.get(node));
    }
    expect(emptyArg.bounds).toEqual(noArg.bounds);
    expect(undefinedArg.bounds).toEqual(noArg.bounds);
  });
});

// --- render(): tree-edge suppression + join-edge drawing ------------------------------------

interface RecordedCall {
  type: string;
  args: number[];
}

interface RecordedStroke {
  type: 'stroke';
  color: string | CanvasGradient | CanvasPattern;
  width: number;
}

/** Minimal CanvasRenderingContext2D stand-in that records path/stroke calls only, capturing the
 *  live strokeStyle/lineWidth at the moment each `stroke()` fires (they're set-then-drawn, so the
 *  call-time snapshot is the only reliable way to attribute a style to a specific connector). */
function makeFakeCtx(): CanvasRenderingContext2D {
  const calls: (RecordedCall | RecordedStroke)[] = [];
  const ctx = {
    calls,
    strokeStyle: '#000',
    lineWidth: 1,
    lineJoin: 'miter',
    fillStyle: '#000',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    beginPath: () => calls.push({ type: 'beginPath', args: [] }),
    moveTo: (x: number, y: number) => calls.push({ type: 'moveTo', args: [x, y] }),
    lineTo: (x: number, y: number) => calls.push({ type: 'lineTo', args: [x, y] }),
    stroke: () => calls.push({ type: 'stroke', color: ctx.strokeStyle, width: ctx.lineWidth }),
    fill: () => {},
    closePath: () => {},
    arcTo: () => {},
    fillText: () => {},
    measureText: (t: string) => ({ width: t.length * 7 }) as TextMetrics,
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

/** Extract each drawn connector as its [firstMoveTo, lastLineTo-before-stroke] endpoint pair,
 *  plus the color/width that were in effect when its `stroke()` fired. */
function connectorsFrom(
  ctx: CanvasRenderingContext2D,
): Array<{ from: [number, number]; to: [number, number]; color: string; width: number }> {
  const calls = (ctx as unknown as { calls: (RecordedCall | RecordedStroke)[] }).calls;
  const out: Array<{ from: [number, number]; to: [number, number]; color: string; width: number }> = [];
  let segment: RecordedCall[] = [];
  for (const call of calls) {
    if (call.type === 'beginPath') segment = [];
    else if (call.type === 'moveTo' || call.type === 'lineTo') segment.push(call as RecordedCall);
    else if (call.type === 'stroke' && segment.length >= 2) {
      const first = segment[0]!;
      const last = segment[segment.length - 1]!;
      const s = call as RecordedStroke;
      out.push({ from: [first.args[0]!, first.args[1]!], to: [last.args[0]!, last.args[1]!], color: s.color as string, width: s.width });
    }
  }
  return out;
}

describe('render — confluence edge suppression + join-edge drawing', () => {
  it('suppresses the parent -> confluence tree connector and draws join edges from each source instead', () => {
    const b1: GraphNode = { id: 'b1', direction: 'bottom' };
    const b2: GraphNode = { id: 'b2', direction: 'bottom' };
    const cont: GraphNode = { id: 'cont', direction: 'bottom' };
    const root: GraphNode = { id: 'fork', children: [b1, b2, cont] };
    const joinEdges: JoinEdge[] = [
      { from: 'b1', to: 'cont' },
      { from: 'b2', to: 'cont' },
    ];
    const { rects } = layout(root, cfg, joinEdges);

    const ctx = makeFakeCtx();
    const rc: RenderContext = {
      ctx,
      rects,
      nodeStyle: { fill: '#fff', stroke: '#999', strokeWidth: 1, textColor: '#000', borderRadius: 4, font: '12px sans-serif' },
      connector: { color: '#cbd5e1', width: 1.5 },
      labelOverflow: 'visible',
      labelPadding: { x: 16, y: 10 },
      joinEdges,
    };
    render(rc, root);

    const rootRect = rects.get(root)!;
    const contRect = rects.get(cont)!;
    const b1Rect = rects.get(b1)!;
    const b2Rect = rects.get(b2)!;

    // Suppressed: the ordinary fork -> cont tree connector (fork bottom-center -> cont top-center).
    const suppressedFrom: [number, number] = [rootRect.x + rootRect.w / 2, rootRect.y + rootRect.h];
    const suppressedTo: [number, number] = [contRect.x + contRect.w / 2, contRect.y];
    const drawn = connectorsFrom(ctx);
    const hasSuppressed = drawn.some(
      (c) => c.from[0] === suppressedFrom[0] && c.from[1] === suppressedFrom[1] && c.to[0] === suppressedTo[0] && c.to[1] === suppressedTo[1],
    );
    expect(hasSuppressed).toBe(false);

    // But the ordinary fork -> b1 / fork -> b2 tree connectors ARE still drawn.
    const b1To: [number, number] = [b1Rect.x + b1Rect.w / 2, b1Rect.y];
    const b2To: [number, number] = [b2Rect.x + b2Rect.w / 2, b2Rect.y];
    expect(drawn.some((c) => c.to[0] === b1To[0] && c.to[1] === b1To[1])).toBe(true);
    expect(drawn.some((c) => c.to[0] === b2To[0] && c.to[1] === b2To[1])).toBe(true);

    // Join edges ARE drawn: b1 bottom-center -> cont top-center, b2 bottom-center -> cont top-center.
    const b1JoinFrom: [number, number] = [b1Rect.x + b1Rect.w / 2, b1Rect.y + b1Rect.h];
    const b2JoinFrom: [number, number] = [b2Rect.x + b2Rect.w / 2, b2Rect.y + b2Rect.h];
    expect(drawn.some((c) => c.from[0] === b1JoinFrom[0] && c.from[1] === b1JoinFrom[1] && c.to[0] === suppressedTo[0] && c.to[1] === suppressedTo[1])).toBe(
      true,
    );
    expect(drawn.some((c) => c.from[0] === b2JoinFrom[0] && c.from[1] === b2JoinFrom[1] && c.to[0] === suppressedTo[0] && c.to[1] === suppressedTo[1])).toBe(
      true,
    );
  });

  it('applies a per-edge style override to only that edge, leaving other connectors on the default style', () => {
    // Two branches into one confluence: only b1's join edge carries a style override.
    const b1: GraphNode = { id: 'b1', direction: 'bottom' };
    const b2: GraphNode = { id: 'b2', direction: 'bottom' };
    const cont: GraphNode = { id: 'cont', direction: 'bottom' };
    const root: GraphNode = { id: 'fork', children: [b1, b2, cont] };
    const joinEdges: JoinEdge[] = [
      { from: 'b1', to: 'cont', style: { color: '#ff0000', width: 3 } },
      { from: 'b2', to: 'cont' },
    ];
    const { rects } = layout(root, cfg, joinEdges);

    const ctx = makeFakeCtx();
    const rc: RenderContext = {
      ctx,
      rects,
      nodeStyle: { fill: '#fff', stroke: '#999', strokeWidth: 1, textColor: '#000', borderRadius: 4, font: '12px sans-serif' },
      connector: { color: '#cbd5e1', width: 1.5 },
      labelOverflow: 'visible',
      labelPadding: { x: 16, y: 10 },
      joinEdges,
    };
    render(rc, root);

    const rootRect = rects.get(root)!;
    const b1Rect = rects.get(b1)!;
    const b2Rect = rects.get(b2)!;
    const contRect = rects.get(cont)!;
    const drawn = connectorsFrom(ctx);

    const b1JoinFrom: [number, number] = [b1Rect.x + b1Rect.w / 2, b1Rect.y + b1Rect.h];
    const b2JoinFrom: [number, number] = [b2Rect.x + b2Rect.w / 2, b2Rect.y + b2Rect.h];
    const contTo: [number, number] = [contRect.x + contRect.w / 2, contRect.y];
    const rootToB1: [number, number] = [b1Rect.x + b1Rect.w / 2, b1Rect.y];

    const styledEdge = drawn.find((c) => c.from[0] === b1JoinFrom[0] && c.from[1] === b1JoinFrom[1] && c.to[0] === contTo[0] && c.to[1] === contTo[1]);
    const plainJoinEdge = drawn.find((c) => c.from[0] === b2JoinFrom[0] && c.from[1] === b2JoinFrom[1] && c.to[0] === contTo[0] && c.to[1] === contTo[1]);
    const treeEdgeToB1 = drawn.find((c) => c.to[0] === rootToB1[0] && c.to[1] === rootToB1[1]);

    expect(styledEdge).toBeDefined();
    expect(styledEdge?.color).toBe('#ff0000');
    expect(styledEdge?.width).toBe(3);

    // The unstyled join edge and the ordinary tree connector both keep the graph's default style.
    expect(plainJoinEdge).toBeDefined();
    expect(plainJoinEdge?.color).toBe('#cbd5e1');
    expect(plainJoinEdge?.width).toBe(1.5);
    expect(treeEdgeToB1).toBeDefined();
    expect(treeEdgeToB1?.color).toBe('#cbd5e1');
    expect(treeEdgeToB1?.width).toBe(1.5);
  });
});
