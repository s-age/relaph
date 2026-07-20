import { describe, it, expect } from 'vitest';
import { layout, type LayoutConfig } from './layout';
import { diamondInscribedWidth, fitLabel, render, type RenderContext } from './renderer';
import type { GraphNode, NodeStyle, Rect } from './types';

const cfg: LayoutConfig = { nodeMargin: 20, rankMargin: 70, defaultWidth: 120, defaultHeight: 40 };

interface RecordedCall {
  type: string;
  args: unknown[];
}

/** Minimal CanvasRenderingContext2D stand-in that records every path/fill/text call, with a
 *  deterministic fake `measureText` (7px per UTF-16 code unit; fixed 8/2 ascent/descent so
 *  `textH` is a known constant across every test in this file). */
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
    arcTo: (...a: number[]) => calls.push({ type: 'arcTo', args: a }),
    closePath: () => calls.push({ type: 'closePath', args: [] }),
    stroke: () => calls.push({ type: 'stroke', args: [] }),
    fill: () => calls.push({ type: 'fill', args: [] }),
    fillRect: (x: number, y: number, w: number, h: number) => calls.push({ type: 'fillRect', args: [x, y, w, h] }),
    fillText: (text: string, x: number, y: number) => calls.push({ type: 'fillText', args: [text, x, y] }),
    measureText: (t: string) => ({ width: t.length * 7, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2 }) as TextMetrics,
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

const nodeStyle: NodeStyle = {
  fill: '#fff',
  stroke: '#999',
  strokeWidth: 1,
  textColor: '#000',
  borderRadius: 4,
  font: '12px sans-serif',
};

const baseRc = (ctx: CanvasRenderingContext2D, rects: Map<GraphNode, Rect>, labelOverflow: 'visible' | 'truncate' = 'visible'): RenderContext => ({
  ctx,
  rects,
  nodeStyle,
  connector: { color: '#ccc', width: 1 },
  labelOverflow,
  labelPadding: { x: 16, y: 10 },
});

describe('render — node shape path', () => {
  it("rect (default/omitted 'shape') keeps the exact pre-shape-option call sequence", () => {
    const root: GraphNode = { id: 'root', width: 100, height: 40 };
    const { rects } = layout(root, cfg);
    const ctx = makeFakeCtx();
    render(baseRc(ctx, rects), root);
    const types = (ctx as unknown as { calls: RecordedCall[] }).calls.map((c) => c.type);
    expect(types).toEqual(['beginPath', 'moveTo', 'arcTo', 'arcTo', 'arcTo', 'arcTo', 'closePath', 'fill', 'stroke']);
  });

  it('an explicit shape: rect style produces the identical call sequence as omitted', () => {
    const root: GraphNode = { id: 'root', width: 100, height: 40, style: { shape: 'rect' } };
    const { rects } = layout(root, cfg);
    const ctx = makeFakeCtx();
    render(baseRc(ctx, rects), root);
    const types = (ctx as unknown as { calls: RecordedCall[] }).calls.map((c) => c.type);
    expect(types).toEqual(['beginPath', 'moveTo', 'arcTo', 'arcTo', 'arcTo', 'arcTo', 'closePath', 'fill', 'stroke']);
  });

  it('diamond shape draws a closed path through the 4 edge midpoints, no arcTo', () => {
    const root: GraphNode = { id: 'root', width: 100, height: 50, style: { shape: 'diamond' } };
    const { rects } = layout(root, cfg);
    const r = rects.get(root)!;
    const ctx = makeFakeCtx();
    render(baseRc(ctx, rects), root);
    const calls = (ctx as unknown as { calls: RecordedCall[] }).calls;

    expect(calls.some((c) => c.type === 'arcTo')).toBe(false);
    const types = calls.map((c) => c.type);
    expect(types).toEqual(['beginPath', 'moveTo', 'lineTo', 'lineTo', 'lineTo', 'closePath', 'fill', 'stroke']);

    const moveTo = calls.find((c) => c.type === 'moveTo')!;
    const [l1, l2, l3] = calls.filter((c) => c.type === 'lineTo');
    expect(moveTo.args).toEqual([r.x + r.w / 2, r.y]); // top
    expect(l1!.args).toEqual([r.x + r.w, r.y + r.h / 2]); // right
    expect(l2!.args).toEqual([r.x + r.w / 2, r.y + r.h]); // bottom
    expect(l3!.args).toEqual([r.x, r.y + r.h / 2]); // left
  });
});

describe('render — diamond node-label truncation (labelOverflow gate)', () => {
  const longLabel = 'a very long label that will not fit inside a small diamond box';

  it("'visible' (default) draws the full label in a diamond, unchanged", () => {
    const root: GraphNode = { id: 'root', label: longLabel, width: 80, height: 40, style: { shape: 'diamond' } };
    const { rects } = layout(root, cfg);
    const ctx = makeFakeCtx();
    render(baseRc(ctx, rects, 'visible'), root);
    const fillText = (ctx as unknown as { calls: RecordedCall[] }).calls.find((c) => c.type === 'fillText')!;
    expect(fillText.args[0]).toBe(longLabel);
  });

  it("'truncate' caps a diamond label to the inscribed width (tighter than the rect cap)", () => {
    const root: GraphNode = { id: 'root', label: longLabel, width: 80, height: 40, style: { shape: 'diamond' } };
    const { rects } = layout(root, cfg);
    const r = rects.get(root)!;
    const ctx = makeFakeCtx();
    render(baseRc(ctx, rects, 'truncate'), root);
    const fillText = (ctx as unknown as { calls: RecordedCall[] }).calls.find((c) => c.type === 'fillText')!;
    const drawn = fillText.args[0] as string;

    expect(drawn).not.toBe(longLabel); // it did truncate
    expect(drawn.endsWith('…')).toBe(true);

    // The cap actually used is diamondInscribedWidth(rectCap, textH, r.h) — verify by
    // reproducing it with the same pure helpers the renderer calls internally.
    const rectCap = r.w - 16 * 2;
    const textH = 8 + 2; // fake ctx's fixed ascent/descent
    const diamondCap = diamondInscribedWidth(rectCap, textH, r.h);
    const expected = fitLabel((t) => t.length * 7, longLabel, diamondCap);
    expect(drawn).toBe(expected);

    // And it's strictly tighter than what the rect cap alone would have allowed.
    const rectOnly = fitLabel((t) => t.length * 7, longLabel, rectCap);
    expect(drawn.length).toBeLessThan(rectOnly.length);
  });

  it("'truncate' on a rect node uses the plain bounding-width cap (unaffected by the diamond rule)", () => {
    const root: GraphNode = { id: 'root', label: longLabel, width: 80, height: 40 };
    const { rects } = layout(root, cfg);
    const r = rects.get(root)!;
    const ctx = makeFakeCtx();
    render(baseRc(ctx, rects, 'truncate'), root);
    const fillText = (ctx as unknown as { calls: RecordedCall[] }).calls.find((c) => c.type === 'fillText')!;
    const expected = fitLabel((t) => t.length * 7, longLabel, r.w - 16 * 2);
    expect(fillText.args[0]).toBe(expected);
  });
});
