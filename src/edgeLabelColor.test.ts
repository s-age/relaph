import { describe, it, expect } from 'vitest';
import { layout, type LayoutConfig } from './layout';
import { render, type RenderContext } from './renderer';
import type { GraphNode, JoinEdge, NodeStyle, Rect } from './types';

const cfg: LayoutConfig = { nodeMargin: 20, rankMargin: 70, defaultWidth: 120, defaultHeight: 40 };

interface RecordedCall {
  type: string;
  args: unknown[];
  fillStyle?: string | CanvasGradient | CanvasPattern;
}

/** Same fake ctx shape as edgeLabel.test.ts (kept local — this file tests a distinct knob and
 *  should not depend on that file's internals). */
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
  opts: { joinEdges?: JoinEdge[]; background?: string } = {},
): RenderContext {
  return {
    ctx,
    rects,
    nodeStyle,
    connector: { color: '#ccc', width: 1 },
    labelOverflow: 'visible',
    labelPadding: { x: 16, y: 10 },
    joinEdges: opts.joinEdges,
    background: opts.background,
  };
}

const fillTexts = (ctx: CanvasRenderingContext2D) =>
  (ctx as unknown as { calls: RecordedCall[] }).calls.filter((c) => c.type === 'fillText');

describe('render — GraphNode.edgeLabelColor (per-node incoming-edge-label text color)', () => {
  it('unset draws the edge label in the graph-level nodeStyle.textColor (current default, unchanged)', () => {
    const child: GraphNode = { id: 'child', direction: 'bottom', edgeLabel: 'triggers' };
    const root: GraphNode = { id: 'root', children: [child] };
    const { rects } = layout(root, cfg);
    const ctx = makeFakeCtx();
    render(makeRc(ctx, rects), root);
    expect(fillTexts(ctx)[0]!.fillStyle).toBe(nodeStyle.textColor);
  });

  it('set overrides just that edge label\'s text color, independent of node.style', () => {
    const child: GraphNode = {
      id: 'child',
      direction: 'bottom',
      edgeLabel: 'aborts',
      edgeLabelColor: '#dc2626',
      style: { textColor: '#ff00ff' }, // node's own text color — must NOT leak into the edge label
    };
    const root: GraphNode = { id: 'root', children: [child] };
    const { rects } = layout(root, cfg);
    const ctx = makeFakeCtx();
    render(makeRc(ctx, rects), root);
    const [call] = fillTexts(ctx);
    expect(call!.args[0]).toBe('aborts');
    expect(call!.fillStyle).toBe('#dc2626');
  });

  it('a JoinEdge label is unaffected by edgeLabelColor (no per-edge color knob on JoinEdge)', () => {
    const b1: GraphNode = { id: 'b1', direction: 'bottom' };
    // 'cont' carries edgeLabelColor, but its incoming tree connector is suppressed (confluence) —
    // the join edge label must still draw in the plain nodeStyle.textColor.
    const cont: GraphNode = { id: 'cont', direction: 'bottom', edgeLabelColor: '#dc2626' };
    const root: GraphNode = { id: 'fork', children: [b1, cont] };
    const joinEdges: JoinEdge[] = [{ from: 'b1', to: 'cont', label: 'joined' }];
    const { rects } = layout(root, cfg, joinEdges);
    const ctx = makeFakeCtx();
    render(makeRc(ctx, rects, { joinEdges }), root);
    const [call] = fillTexts(ctx);
    expect(call!.args[0]).toBe('joined');
    expect(call!.fillStyle).toBe(nodeStyle.textColor);
  });
});
