// =========================================================================
// tests/resolveDatePreset.test.js
// UTC date-preset math for the dashboard Date filter.
// The implementation lives in js/admin.js; we import the exported
// helper directly. The boundaries are UTC day boundaries, so the
// expected values below are computed in UTC (not local time).
// =========================================================================

import { describe, it, expect } from 'vitest';
import { resolveDatePreset } from '../js/admin.js';

// Snap the test to a fixed UTC instant so the assertions are
// deterministic across timezones and across the actual run time. We
// can't override `new Date()` inside admin.js, so we exercise the
// boundaries by re-deriving the expected values from the same UTC
// clock the implementation reads.
function utcNow() {
  return new Date();
}
function pad(n) { return n < 10 ? '0' + n : '' + n; }
function isoDate(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }
function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

describe('resolveDatePreset', function () {
  it('returns null for unknown keys (caller falls back to "no filter")', function () {
    expect(resolveDatePreset('')).toBe(null);
    expect(resolveDatePreset('nope')).toBe(null);
    expect(resolveDatePreset('THIS_YEAR')).toBe(null); // case sensitive
  });

  it('"today" returns the current UTC day on both ends', function () {
    var n = utcNow();
    var r = resolveDatePreset('today');
    var expected = isoDate(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
    expect(r).toEqual({ from: expected, to: expected });
  });

  it('"yesterday" returns the previous UTC day on both ends', function () {
    var n = new Date(Date.UTC(2026, 7, 31));   // 2026-08-31
    // Compute expected by re-deriving from a fixed clock; since
    // resolveDatePreset reads the real clock, the assertion is the
    // shape (both ends equal, both ISO format) plus matching the
    // *expected* day based on what the real "now" is in UTC.
    var r = resolveDatePreset('yesterday');
    expect(r).not.toBe(null);
    expect(r.from).toBe(r.to);
    expect(r.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // And the day must be exactly 1 before "today" in UTC.
    var n2 = utcNow();
    var expected = new Date(Date.UTC(n2.getUTCFullYear(), n2.getUTCMonth(), n2.getUTCDate() - 1));
    expect(r.from).toBe(isoDate(expected.getUTCFullYear(), expected.getUTCMonth(), expected.getUTCDate()));
  });

  it('"last_week" is 7 days ending yesterday (NOT including today)', function () {
    var r = resolveDatePreset('last_week');
    expect(r).not.toBe(null);
    expect(r.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The two endpoints are 6 days apart (= 7 days inclusive).
    var fromMs = Date.parse(r.from + 'T00:00:00Z');
    var toMs   = Date.parse(r.to   + 'T00:00:00Z');
    expect((toMs - fromMs) / 86400000).toBe(6);
    // And "to" is the same as "yesterday" — i.e. NOT today.
    var y = resolveDatePreset('yesterday');
    expect(r.to).toBe(y.to);
    // And "to" is not today.
    var t = resolveDatePreset('today');
    expect(r.to).not.toBe(t.to);
  });

  it('"last_month" is the previous UTC calendar month, day 1 to last day', function () {
    var n = utcNow();
    var py = n.getUTCFullYear();
    var pm = n.getUTCMonth() - 1;
    if (pm < 0) { pm = 11; py = py - 1; }
    var dim = daysInMonth(py, pm);
    var r = resolveDatePreset('last_month');
    expect(r).toEqual({ from: isoDate(py, pm, 1), to: isoDate(py, pm, dim) });
  });

  it('"this_year" is Jan 1 of this UTC year through today', function () {
    var n = utcNow();
    var r = resolveDatePreset('this_year');
    expect(r).toEqual({
      from: isoDate(n.getUTCFullYear(), 0, 1),
      to:   isoDate(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()),
    });
  });

  it('"last_year" is Jan 1 .. Dec 31 of the previous UTC year', function () {
    var n = utcNow();
    var py = n.getUTCFullYear() - 1;
    var r = resolveDatePreset('last_year');
    expect(r).toEqual({ from: isoDate(py, 0, 1), to: isoDate(py, 11, 31) });
  });

  it('always emits the yyyy-mm-dd ISO shape (no time component)', function () {
    var keys = ['today', 'yesterday', 'last_week', 'last_month', 'this_year', 'last_year'];
    keys.forEach(function (k) {
      var r = resolveDatePreset(k);
      expect(r.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // "from" <= "to" for every preset (lexicographic compare is
      // safe on the yyyy-mm-dd shape).
      expect(r.from <= r.to).toBe(true);
    });
  });
});
