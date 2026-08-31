// =========================================================================
// tests/overviewDonut.test.js
// Phase 5c: donut chart pure helper.
//
// donutSegments(counts) is the testable unit behind the "All tickets"
// donut in the right rail. It returns one entry per non-zero status
// (in the documented order) with the math the SVG renderer needs
// (segment length, cumulative offset, fraction).
//
// We do NOT test the SVG rendering itself — jsdom + SVG + circles is
// fragile, and the helper is the part that has real logic.
// =========================================================================

import { describe, it, expect } from 'vitest';
import { donutSegments } from '../js/admin.js';

describe('donutSegments', () => {
  it('returns one entry per non-zero status, in the documented order', () => {
    // Solved = 0 → omitted. In process is non-zero but appears second.
    var counts = { pending: 30, in_process: 19, hold: 1, solved: 0 };
    var out = donutSegments(counts);
    expect(out.map(function (s) { return s.key; })).toEqual([
      'pending', 'in_process', 'hold',
    ]);
  });

  it('fractions sum to 1.0 (within float epsilon) when total > 0', () => {
    // Asymmetric split — exercises that we don't drop or duplicate the
    // remainder when the fractions don't divide evenly.
    var counts = { pending: 7, in_process: 3, hold: 2, solved: 4 };
    var out = donutSegments(counts);
    var total = 0;
    out.forEach(function (s) { total += s.fraction; });
    expect(total).toBeCloseTo(1.0, 10);
  });

  it('returns an empty array when the total is zero (renderer shows empty state)', () => {
    // The most common empty case: a fresh dev database with no tickets.
    expect(donutSegments({})).toEqual([]);
    // Also covers the "everyone got 0" case.
    expect(donutSegments({ pending: 0, in_process: 0, hold: 0, solved: 0 })).toEqual([]);
  });
});
