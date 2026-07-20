import { describe, it, expect } from 'vitest';
import { layout, type LayoutConfig } from './layout';
import { connectorLabelPoint, fitLabel, render, type RenderContext } from './renderer';
import type { GraphNode, JoinEdge, NodeStyle, Rect } from './types';

const cfg: LayoutConfig = { nodeMargin: 20, rankMargin: 70, defaultWidth: 120, defaultHeight: 40 };

interface RecordedCall {
  type: string;
  args: unknown[];
  /** `fillStyle` in effect at the moment this call fired (fillRect/fillText only) — captured
   *  live since it's set-then-drawn, the only reliable way to attribute a color to a call. */
  fillStyle?: string | CanvasGradient | CanvasPattern;
}

/** Minimal CanvasRenderingContext2D stand-in recording path/fillRect/fillText calls, with a
 *  deterministic fake `measureText` (7px per UTF-16 code unit; fixed 8/2 ascent/descent). */
function makeFakeCtx(): CanvasRenderingContext2D {
  const calls: RecordedCall[] = [];
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
    arcTo: () => {},
    closePath: () => {},
    stroke: () => calls.push({ type: 'stroke', args: [] }),
    fill: () => {},
    fillRect: (x: number, y: number, w: number, h: number) => calls.push({ type: 'fillRect', args: [x, y, w, h], fillStyle: ctx.fillStyle }),
    fillText: (text: string, x: number, y: number) => calls.push({ type: 'fillText', args: [text, x, y], fillStyle: ctx.fillStyle }),
    measureText: (t: string) => ({ width: t.length * 7, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2 }) as TextMetrics,
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

const nodeStyle: NodeStyle = {
  fill: '#fff',
  stroke: '#999',
  strokeWidth: 1,
  textColor: '#012345',
  borderRadius: 4,
  font: '12px sans-serif',
};

function makeRc(
  ctx: CanvasRenderingContext2D,
  rects: Map<GraphNode, Rect>,
  opts: { labelMaxWidth?: number; joinEdges?: JoinEdge[]; background?: string } = {},
): RenderContext {
  return {
    ctx,
    rects,
    nodeStyle,
    connector: { color: '#ccc', width: 1, labelMaxWidth: opts.labelMaxWidth },
    labelOverflow: 'visible',
    labelPadding: { x: 16, y: 10 },
    joinEdges: opts.joinEdges,
    background: opts.background,
  };
}

const fillTexts = (ctx: CanvasRenderingContext2D) =>
  (ctx as unknown as { calls: RecordedCall[] }).calls.filter((c) => c.type === 'fillText');

describe('render — edge labels: placement + typography + halo', () => {
  it('draws a tree edge label centered on the middle-segment midpoint, in nodeStyle font/color (never a per-node override)', () => {
    // The child recolors ITS OWN node text (textColor override) — the edge label must stay on
    // the graph's default nodeStyle.textColor ('#012345'), not the child's '#ff00ff'.
    const child: GraphNode = { id: 'child', direction: 'bottom', edgeLabel: 'triggers', style: { textColor: '#ff00ff' } };
    const root: GraphNode = { id: 'root', children: [child] };
    const { rects } = layout(root, cfg);
    const rootRect = rects.get(root)!;
    const childRect = rects.get(child)!;
    const ctx = makeFakeCtx();
    render(makeRc(ctx, rects, { background: '#eeeeee' }), root);

    const texts = fillTexts(ctx);
    expect(texts).toHaveLength(1);
    const [call] = texts;
    expect(call!.args[0]).toBe('triggers');
    expect(call!.fillStyle).toBe(nodeStyle.textColor); // never the child's '#ff00ff' override
    const expectedPoint = connectorLabelPoint(rootRect, childRect, 'bottom');
    expect(call!.args[1]).toBeCloseTo(expectedPoint.x);
    expect(call!.args[2]).toBeCloseTo(expectedPoint.y);

    // A halo (fillRect), filled with the graph's background color, is drawn before the text.
    const calls = (ctx as unknown as { calls: RecordedCall[] }).calls;
    const textIdx = calls.indexOf(call!);
    const halo = calls.slice(0, textIdx).reverse().find((c) => c.type === 'fillRect');
    expect(halo).toBeDefined();
    expect(halo!.fillStyle).toBe('#eeeeee');
  });

  it('an edge-label-less tree (no edgeLabel anywhere) draws zero fillText/fillRect calls from edges', () => {
    const child: GraphNode = { id: 'child', direction: 'bottom' };
    const root: GraphNode = { id: 'root', children: [child] };
    const { rects } = layout(root, cfg);
    const ctx = makeFakeCtx();
    render(makeRc(ctx, rects), root);
    expect(fillTexts(ctx)).toHaveLength(0);
    expect((ctx as unknown as { calls: RecordedCall[] }).calls.some((c) => c.type === 'fillRect')).toBe(false);
  });
});

describe('render — edge label fitting (connector.labelMaxWidth)', () => {
  const long = 'a rather long edge label that will not fit in a small cap';

  it('unset labelMaxWidth draws the edge label in full (no truncation)', () => {
    const child: GraphNode = { id: 'child', direction: 'bottom', edgeLabel: long };
    const root: GraphNode = { id: 'root', children: [child] };
    const { rects } = layout(root, cfg);
    const ctx = makeFakeCtx();
    render(makeRc(ctx, rects), root);
    expect(fillTexts(ctx)[0]!.args[0]).toBe(long);
  });

  it('set labelMaxWidth caps the edge label via the same fitLabel ellipsis rule as node labels', () => {
    const child: GraphNode = { id: 'child', direction: 'bottom', edgeLabel: long };
    const root: GraphNode = { id: 'root', children: [child] };
    const { rects } = layout(root, cfg);
    const ctx = makeFakeCtx();
    const capWidth = 60;
    render(makeRc(ctx, rects, { labelMaxWidth: capWidth }), root);
    const drawn = fillTexts(ctx)[0]!.args[0] as string;
    const expected = fitLabel((t) => t.length * 7, long, capWidth);
    expect(drawn).toBe(expected);
    expect(drawn).not.toBe(long);
  });
});

describe('render — edge labels vs confluence suppression', () => {
  it("a confluence node's own edgeLabel is ignored (its tree connector is suppressed); JoinEdge.label draws instead", () => {
    const b1: GraphNode = { id: 'b1', direction: 'bottom' };
    const b2: GraphNode = { id: 'b2', direction: 'bottom' };
    // 'cont' is a confluence (target of joinEdges below) AND carries its own edgeLabel — which
    // must never be drawn, since the fork -> cont tree connector it would ride is suppressed.
    const cont: GraphNode = { id: 'cont', direction: 'bottom', edgeLabel: 'ignored-confluence-label' };
    const root: GraphNode = { id: 'fork', children: [b1, b2, cont] };
    const joinEdges: JoinEdge[] = [
      { from: 'b1', to: 'cont', label: 'joined-from-b1' },
      { from: 'b2', to: 'cont' },
    ];
    const { rects } = layout(root, cfg, joinEdges);
    const ctx = makeFakeCtx();
    render(makeRc(ctx, rects, { joinEdges }), root);

    const texts = fillTexts(ctx).map((c) => c.args[0]);
    expect(texts).not.toContain('ignored-confluence-label');
    expect(texts).toContain('joined-from-b1');
  });

  it('a non-confluence sibling keeps its own edgeLabel even when another sibling in the same tree is a confluence', () => {
    const b1: GraphNode = { id: 'b1', direction: 'bottom', edgeLabel: 'plain-tree-edge' };
    const b2: GraphNode = { id: 'b2', direction: 'bottom' };
    const cont: GraphNode = { id: 'cont', direction: 'bottom', edgeLabel: 'ignored-confluence-label' };
    const root: GraphNode = { id: 'fork', children: [b1, b2, cont] };
    const joinEdges: JoinEdge[] = [
      { from: 'b1', to: 'cont' },
      { from: 'b2', to: 'cont' },
    ];
    const { rects } = layout(root, cfg, joinEdges);
    const ctx = makeFakeCtx();
    render(makeRc(ctx, rects, { joinEdges }), root);

    const texts = fillTexts(ctx).map((c) => c.args[0]);
    expect(texts).toContain('plain-tree-edge');
    expect(texts).not.toContain('ignored-confluence-label');
  });
});
