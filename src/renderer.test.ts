import { describe, it, expect } from 'vitest';
import { fitLabel } from './renderer';

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
