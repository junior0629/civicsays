// =========================================================================
// tests/buildTrendSvg.test.js
// Ticket Trend pure helper.
//
// buildTrendSvg(days) returns the SVG primitives (linePath, areaPath,
// points, xLabels) the renderer maps to <path> and <circle> elements.
// We test the shape and the math, not the DOM rendering.
//
// Also covers buildTrendAriaLabel(days) and formatTrendLabel(isoDay),
// which are exported from the same module.
// =========================================================================

import { describe, it, expect } from 'vitest';
import { buildTrendSvg, buildTrendAriaLabel, formatTrendLabel } from '../js/admin.js';

describe('buildTrendSvg', () => {
  it('returns the empty shape when given no days (renderer falls through to "No data yet")', () => {
    expect(buildTrendSvg([])).toEqual({
      linePath: '', areaPath: '', points: [], xLabels: [],
    });
    expect(buildTrendSvg(null)).toEqual({
      linePath: '', areaPath: '', points: [], xLabels: [],
    });
  });

  it('produces 7 evenly-spaced points and a non-empty line + area for a 7-day input', () => {
    var days = [
      { day: '2026-05-25', count: 3 },
      { day: '2026-05-26', count: 7 },
      { day: '2026-05-27', count: 1 },
      { day: '2026-05-28', count: 0 },
      { day: '2026-05-29', count: 12 },
      { day: '2026-05-30', count: 5 },
      { day: '2026-05-31', count: 8 },
    ];
    var out = buildTrendSvg(days);
    expect(out.points).toHaveLength(7);
    expect(out.xLabels).toHaveLength(7);
    // The line must start with a move-to and include at least one
    // cubic bezier "C" — proof the smoothing ran.
    expect(out.linePath.startsWith('M ')).toBe(true);
    expect(out.linePath).toMatch(/C /);
    // The area must close back to the baseline (ends with "Z").
    expect(out.areaPath.endsWith('Z')).toBe(true);
    // The max-count day sits at the top of the chart. y is in SVG
    // units; smaller y = higher on the screen.
    var minY = Math.min.apply(null, out.points.map(function (p) { return p.y; }));
    var peak = out.points.find(function (p) { return p.count === 12; });
    expect(peak.y).toBe(minY);
    // A zero-count day sits at the very bottom.
    var maxY = Math.max.apply(null, out.points.map(function (p) { return p.y; }));
    var zero = out.points.find(function (p) { return p.count === 0; });
    expect(zero.y).toBe(maxY);
    // X positions are strictly increasing left-to-right.
    for (var i = 1; i < out.points.length; i++) {
      expect(out.points[i].x).toBeGreaterThan(out.points[i - 1].x);
    }
  });
});

describe('formatTrendLabel', () => {
  it('parses a UTC ISO date into "Mon D" format', () => {
    expect(formatTrendLabel('2026-05-25')).toBe('May 25');
    expect(formatTrendLabel('2026-12-31')).toBe('Dec 31');
    expect(formatTrendLabel('2026-01-01')).toBe('Jan 1');
  });
});

describe('buildTrendAriaLabel', () => {
  it('returns a sentence-form summary suitable for screen readers', () => {
    var days = [
      { day: '2026-05-25', count: 3 },
      { day: '2026-05-26', count: 7 },
    ];
    expect(buildTrendAriaLabel(days)).toBe(
      'Ticket trend for the last 2 days: 3 on May 25, 7 on May 26.'
    );
  });
  it('handles the empty case without throwing', () => {
    expect(buildTrendAriaLabel([])).toBe('No ticket trend data.');
  });
});
