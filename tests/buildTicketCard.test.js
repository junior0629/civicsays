// =========================================================================
// tests/buildTicketCard.test.js
// Verifies the admin ticket card builder: data attributes, link target,
// status accent, and the bits a staff user actually scans.
// =========================================================================

import { describe, it, expect } from 'vitest';
import { buildTicketCard } from '../js/admin.js';
import { ticketStatusLabel, statusBadgeClass } from '../js/format.js';

function readTree(el) {
  // Walk a DOM tree into a plain JSON structure for stable assertions.
  function walk(node) {
    if (node.nodeType === 3 /* text */) {
      return { text: node.nodeValue };
    }
    return {
      tag: node.tagName ? node.tagName.toLowerCase() : 'unknown',
      attrs: Object.assign({}, node.attributes || {}),
      classes: node.className || '',
      children: Array.from(node.childNodes || []).map(walk),
    };
  }
  return walk(el);
}

describe('buildTicketCard', function () {
  var row = {
    id: 'TKT-ABC-123',
    status: 'pending',
    kind: 'request',
    title: 'Broken streetlight on Main St',
    resident_name: 'Maria S.',
    created_at: new Date('2025-08-30T10:00:00Z').toISOString(),
  };

  it('returns an anchor with the right href, testid, and status attribute', function () {
    var card = buildTicketCard(row);
    expect(card.tagName).toBe('A');
    expect(card.getAttribute('href')).toBe('ticket.html?id=TKT-ABC-123');
    expect(card.getAttribute('data-testid')).toBe('ticket-card');
    expect(card.getAttribute('data-ticket-id')).toBe('TKT-ABC-123');
    expect(card.getAttribute('data-status')).toBe('pending');
  });

  it('includes a status badge with the correct label and class', function () {
    var card = buildTicketCard(row);
    var badge = card.querySelector('.badge');
    expect(badge).toBeTruthy();
    expect(badge.classList.contains(statusBadgeClass('ticket', 'pending'))).toBe(true);
    expect(badge.textContent).toContain(ticketStatusLabel('pending'));
  });

  it('renders the ticket title prominently', function () {
    var card = buildTicketCard(row);
    expect(card.textContent).toContain(row.title);
  });

  it('shows "Anonymous" when resident_name is missing', function () {
    var anon = Object.assign({}, row, { resident_name: null });
    var card = buildTicketCard(anon);
    expect(card.textContent).toContain('Anonymous');
  });

  it('uses the actual resident name when present', function () {
    var card = buildTicketCard(row);
    expect(card.textContent).toContain('Maria S.');
  });

  it('falls back to no data-status when status is missing', function () {
    var weird = Object.assign({}, row, { status: undefined });
    var card = buildTicketCard(weird);
    expect(card.getAttribute('data-status')).toBe('');
  });
});
