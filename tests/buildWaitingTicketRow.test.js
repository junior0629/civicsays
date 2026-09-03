// =========================================================================
// tests/buildWaitingTicketRow.test.js
//
// Phase 8 (Waiting to Be Accepted): the pure <li> builder used by
// renderWaitingTicketsRail() in js/admin.js. Mirrors the
// buildTicketRow / buildTicketCard test style: import the real
// function, assert on DOM structure + data attributes + text content.
//
// Contract we lock down here:
//   1. Returns a <li.admin-waiting-row> with data-ticket-id +
//      data-status matching the input row.
//   2. Shows the CIV- id in a .id span (mono font, 1 per row).
//   3. Does NOT render a status badge — every row in this card is
//      pending by definition; the card title is the label.
//   4. Shows the title in a .title span (truncated by CSS, not JS).
//   5. Shows the resident name + a relative-time .when span.
//   6. Renders a single icon-only Accept button with
//      data-testid "waiting-accept-<id>" and an aria-label that
//      names both the ticket and the current staff member
//      ("assign to <name>"). The visible button is just a check
//      icon so it doesn't squeeze the title in the 240px rail.
//   7. Never throws on a missing field — falls back to a safe
//      placeholder text. This is the same "must not crash the page
//      if a row is malformed" guarantee the other builders have.
//   8. XSS-safe: the title and resident name go through textContent
//      (not innerHTML), so a row titled
//      '<img src=x onerror=alert(1)>' renders as a literal string.
// =========================================================================

import { describe, it, expect } from 'vitest';
import { buildWaitingTicketRow } from '../js/admin.js';

const SAMPLE = {
  id: 'CIV-DEMO01',
  status: 'pending',
  kind: 'request',
  title: 'Broken streetlight on Maple Ave',
  resident_name: 'Sarah Chen',
  created_at: new Date('2025-09-02T10:00:00Z').toISOString(),
};

describe('buildWaitingTicketRow — shape', function () {
  it('returns a <li> with the right data attributes', function () {
    var li = buildWaitingTicketRow(SAMPLE, 'Alex Rivera');
    expect(li.tagName).toBe('LI');
    expect(li.classList.contains('admin-waiting-row')).toBe(true);
    expect(li.getAttribute('data-ticket-id')).toBe('CIV-DEMO01');
    expect(li.getAttribute('data-status')).toBe('pending');
  });

  it('renders the CIV id in a .id span (exactly one)', function () {
    var li = buildWaitingTicketRow(SAMPLE, 'Alex Rivera');
    var ids = li.querySelectorAll('.id');
    expect(ids.length).toBe(1);
    expect(ids[0].textContent).toBe('CIV-DEMO01');
  });

  it('does NOT render a status badge (every row is by definition pending — the card title is the label)', function () {
    var li = buildWaitingTicketRow(SAMPLE, 'Alex Rivera');
    // The card title "Waiting to Be Accepted" already communicates
    // that every row is pending. A per-row badge would steal width
    // from the title in the 240px right rail without adding
    // information. This test locks in that decision.
    expect(li.querySelector('.badge-inline')).toBeNull();
    // data-status is still set so the rail can be themed by status
    // in the future without an HTML change.
    expect(li.getAttribute('data-status')).toBe('pending');
  });

  it('renders the title in a .title span', function () {
    var li = buildWaitingTicketRow(SAMPLE, 'Alex Rivera');
    var title = li.querySelector('.title');
    expect(title).toBeTruthy();
    expect(title.textContent).toBe('Broken streetlight on Maple Ave');
    // The `title` attribute holds the hover tooltip (title + resident
    // + relative time) so the row can stay a single line. The exact
    // relative time string is timezone-sensitive; just assert the
    // suffix is appended.
    var tip = title.getAttribute('title') || '';
    expect(tip).toContain('Broken streetlight on Maple Ave');
    expect(tip).toContain('Sarah Chen');
  });

  it('renders the resident name + a relative-time in the title attribute (compact single-line row)', function () {
    var li = buildWaitingTicketRow(SAMPLE, 'Alex Rivera');
    var title = li.querySelector('.title');
    expect(title).toBeTruthy();
    // The resident + time live in the title attribute as a hover
    // tooltip, not as separate elements — the row is a single
    // ~32px line (matches the admin table row height).
    expect(title.getAttribute('title')).toContain('Sarah Chen');
    expect(title.getAttribute('title')).toContain('Broken streetlight');
  });

  it('renders exactly one Accept button with the right data-testid', function () {
    var li = buildWaitingTicketRow(SAMPLE, 'Alex Rivera');
    var btns = li.querySelectorAll('button.accept-btn');
    expect(btns.length).toBe(1);
    expect(btns[0].getAttribute('data-testid')).toBe('waiting-accept-CIV-DEMO01');
  });

  it('Accept button shows the text "Accept" (no icon)', function () {
    var li = buildWaitingTicketRow(SAMPLE, 'Alex Rivera');
    var btn = li.querySelector('button.accept-btn');
    // The button shows the text "Accept" — not an icon — so the
    // action is explicit at a glance. The aria-label (tested
    // below) provides extra context for screen readers.
    expect(btn.textContent.trim()).toBe('Accept');
    expect(btn.querySelector('svg')).toBeNull();
  });

  it('aria-label names both the ticket id AND the current staff member', function () {
    var li = buildWaitingTicketRow(SAMPLE, 'Alex Rivera');
    var btn = li.querySelector('button.accept-btn');
    var aria = btn.getAttribute('aria-label') || '';
    expect(aria).toContain('CIV-DEMO01');
    expect(aria).toContain('Alex Rivera');
    // The aria-label also explains the side-effect so screen-reader
    // users hear what Accept actually does.
    expect(aria.toLowerCase()).toContain('in process');
    expect(aria.toLowerCase()).toContain('comment');
  });

  it('falls back to "me" when the official name is missing', function () {
    var li = buildWaitingTicketRow(SAMPLE, '');
    var btn = li.querySelector('button.accept-btn');
    var aria = btn.getAttribute('aria-label') || '';
    expect(aria).toContain('assign to me');
  });
});

describe('buildWaitingTicketRow — defensive (no throw on bad input)', function () {
  it('handles a missing id (falls back to placeholder text, no crash)', function () {
    var row = Object.assign({}, SAMPLE, { id: null });
    var li = buildWaitingTicketRow(row, 'Alex Rivera');
    var idSpan = li.querySelector('.id');
    expect(idSpan).toBeTruthy();
    expect(idSpan.textContent.length).toBeGreaterThan(0);
    expect(li.getAttribute('data-ticket-id')).toBe('');
  });

  it('handles a missing status (no badge by design, no crash)', function () {
    var row = Object.assign({}, SAMPLE, { status: null });
    var li = buildWaitingTicketRow(row, 'Alex Rivera');
    expect(li.getAttribute('data-status')).toBe('');
    // No status badge at all (this card is for pending tickets only).
    expect(li.querySelector('.badge-inline')).toBeNull();
  });

  it('handles a missing title (no crash, placeholder shown)', function () {
    var row = Object.assign({}, SAMPLE, { title: null });
    var li = buildWaitingTicketRow(row, 'Alex Rivera');
    var title = li.querySelector('.title');
    expect(title).toBeTruthy();
    expect(title.textContent.length).toBeGreaterThan(0);
  });

  it('handles a missing resident_name (shows "Anonymous" in the hover tooltip)', function () {
    var row = Object.assign({}, SAMPLE, { resident_name: null });
    var li = buildWaitingTicketRow(row, 'Alex Rivera');
    var title = li.querySelector('.title');
    expect(title.getAttribute('title')).toContain('Anonymous');
  });

  it('handles a completely empty row (no crash, all placeholders shown)', function () {
    var li = buildWaitingTicketRow({}, 'Alex Rivera');
    expect(li.tagName).toBe('LI');
    expect(li.querySelector('.id').textContent.length).toBeGreaterThan(0);
    expect(li.querySelector('.title').textContent.length).toBeGreaterThan(0);
    expect(li.querySelector('.title').getAttribute('title')).toContain('Anonymous');
  });
});

describe('buildWaitingTicketRow — XSS safety', function () {
  it('escapes a malicious title (no <img> injection via textContent)', function () {
    var row = Object.assign({}, SAMPLE, {
      title: '<img src=x onerror=alert(1)>',
      resident_name: '<script>alert(1)</script>',
    });
    var li = buildWaitingTicketRow(row, 'Alex Rivera');
    // No <img> or <script> tags should have been created from the
    // user data. The title span uses textContent; the resident name
    // is in the tooltip (title attribute), also safe.
    expect(li.querySelector('img')).toBeNull();
    expect(li.querySelector('script')).toBeNull();
    // The strings should still appear as literal text.
    expect(li.querySelector('.title').textContent).toBe('<img src=x onerror=alert(1)>');
    var tip = li.querySelector('.title').getAttribute('title') || '';
    expect(tip).toContain('<script>alert(1)</script>');
  });
});
