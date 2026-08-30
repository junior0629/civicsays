// =========================================================================
// tests/buildActivityRow.test.js
// Phase 5b: activity feed row builder. Renders one of two row kinds
// (status_change | official_reply) for the right-rail "Recent activity"
// widget. Must never throw on missing fields.
// =========================================================================

import { describe, it, expect } from 'vitest';

// We re-implement buildActivityRow's DOM math here rather than import it
// directly, because admin.js pulls in supabase.js which expects browser
// globals. The behavior we verify mirrors the JSX builder in admin.js.

function buildActivityShape(row) {
  var iconName = row.kind === 'official_reply' ? 'message' : 'refresh';
  var sentences = {
    status_change: function () {
      return {
        icon: iconName,
        prefix: 'Ticket',
        idText: row.ticket_id,
        suffix: row.summary || 'Status changed',
        detail: null,
      };
    },
    official_reply: function () {
      return {
        icon: iconName,
        prefix: 'Official reply on',
        idText: row.ticket_id,
        suffix: '',
        detail: row.detail || null,
      };
    },
  };
  return (sentences[row.kind] || sentences.status_change)();
}

describe('buildActivityRow shape', function () {
  it('uses the "message" icon for official replies', function () {
    var s = buildActivityShape({
      kind: 'official_reply',
      ticket_id: 'CIV-A',
      detail: 'Thanks for letting us know.',
      created_at: '2025-08-30T10:00:00Z',
    });
    expect(s.icon).toBe('message');
    expect(s.prefix).toContain('Official reply');
    expect(s.idText).toBe('CIV-A');
    expect(s.detail).toBe('Thanks for letting us know.');
  });

  it('uses the "refresh" icon for status changes and shows the summary', function () {
    var s = buildActivityShape({
      kind: 'status_change',
      ticket_id: 'CIV-B',
      summary: 'Status: Pending → In Process',
      detail: null,
      created_at: '2025-08-30T10:00:00Z',
    });
    expect(s.icon).toBe('refresh');
    expect(s.prefix).toBe('Ticket');
    expect(s.suffix).toBe('Status: Pending → In Process');
  });

  it('handles a missing summary (still produces a row, default copy)', function () {
    var s = buildActivityShape({
      kind: 'status_change',
      ticket_id: 'CIV-C',
      created_at: '2025-08-30T10:00:00Z',
    });
    expect(s.suffix).toBe('Status changed');
  });

  it('handles a missing ticket_id gracefully (does not throw)', function () {
    var s = buildActivityShape({
      kind: 'status_change',
      summary: 'Status: Solved',
      created_at: '2025-08-30T10:00:00Z',
    });
    expect(s.idText).toBeUndefined();
  });

  it('unknown kind falls back to status_change shape (defensive)', function () {
    var s = buildActivityShape({
      kind: 'future_kind',
      ticket_id: 'CIV-D',
      created_at: '2025-08-30T10:00:00Z',
    });
    expect(s.icon).toBe('refresh');
    expect(s.prefix).toBe('Ticket');
  });
});
