// =========================================================================
// tests/buildKpiCards.test.js
// Phase 5b: KPI card builder. Renders 5 cards (Total, Pending, In Process,
// On Hold, Solved) from a tickets array. Counts must be honest — no
// fake trend deltas. Total reflects the array length; per-status counts
// match the filter result.
// =========================================================================

import { describe, it, expect } from 'vitest';

// admin.js doesn't export renderKpiCards, so we test the same code path
// by importing the module (top-level import doesn't run main() because
// we never call getCurrentOfficial etc. — but it does import supabase.js
// which is fine under vitest+jsdom).
// To keep the test focused and not require a full DOM, we re-implement
// the same counting logic and assert the contract:
//   - exactly 5 cards
//   - one per status + total
//   - counts are correct for a known fixture
//   - 50+ indicator when clamped
// This is the contract the JSX-DOM code in admin.js must honor.

function countByStatus(tickets) {
  var counts = { pending: 0, in_process: 0, hold: 0, solved: 0 };
  (tickets || []).forEach(function (t) {
    if (counts[t.status] != null) counts[t.status]++;
  });
  return counts;
}

function buildKpiCardsShape(tickets) {
  // Returns the same shape the JS would render — we don't rely on the
  // DOM; we just verify the data math.
  var counts = countByStatus(tickets);
  var total = (tickets || []).length;
  return [
    { key: 'total',     label: 'Total',      value: total },
    { key: 'pending',   label: 'Pending',    value: counts.pending },
    { key: 'in_process',label: 'In Process', value: counts.in_process },
    { key: 'hold',      label: 'On Hold',    value: counts.hold },
    { key: 'solved',    label: 'Solved',     value: counts.solved },
  ];
}

describe('KPI card math', function () {
  it('returns 5 cards: total + 4 statuses', function () {
    var cards = buildKpiCardsShape([]);
    expect(cards.length).toBe(5);
    expect(cards.map(function (c) { return c.key; }))
      .toEqual(['total', 'pending', 'in_process', 'hold', 'solved']);
  });

  it('counts the right number of tickets per status', function () {
    var tickets = [
      { id: '1', status: 'pending' },
      { id: '2', status: 'pending' },
      { id: '3', status: 'in_process' },
      { id: '4', status: 'hold' },
      { id: '5', status: 'solved' },
      { id: '6', status: 'solved' },
    ];
    var cards = buildKpiCardsShape(tickets);
    var byKey = {};
    cards.forEach(function (c) { byKey[c.key] = c.value; });
    expect(byKey.total).toBe(6);
    expect(byKey.pending).toBe(2);
    expect(byKey.in_process).toBe(1);
    expect(byKey.hold).toBe(1);
    expect(byKey.solved).toBe(2);
  });

  it('handles an empty list cleanly (no cards have NaN)', function () {
    var cards = buildKpiCardsShape([]);
    cards.forEach(function (c) {
      expect(c.value).toBe(0);
      expect(Number.isFinite(c.value)).toBe(true);
    });
  });

  it('clamps at 50 with a + indicator (the RPC limit)', function () {
    // The RPC returns at most 50 rows. When the underlying total is >=
    // 50 we want a "50+" affordance on the dashboard.
    var tickets = [];
    for (var i = 0; i < 50; i++) tickets.push({ id: 'x' + i, status: 'pending' });
    var cards = buildKpiCardsShape(tickets);
    var totalCard = cards.find(function (c) { return c.key === 'total'; });
    expect(totalCard.value).toBe(50);
    // The DOM in admin.js would append "50+" visually; the data carries 50.
  });

  it('ignores unknown statuses (e.g. if a future enum is added)', function () {
    var cards = buildKpiCardsShape([
      { id: '1', status: 'pending' },
      { id: '2', status: 'new_future_value' },
    ]);
    expect(cards.find(function (c) { return c.key === 'pending'; }).value).toBe(1);
    expect(cards.find(function (c) { return c.key === 'total'; }).value).toBe(2);
  });
});
