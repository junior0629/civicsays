// =========================================================================
// tests/buildTicketRow.test.js
// Phase 5b: table row builder for the new admin dashboard table.
// Mirrors the data-testid/data-ticket-id/data-status contract of
// buildTicketCard so the analytics + tests that grep for
// "ticket-card" keep working.
// =========================================================================

import { describe, it, expect } from 'vitest';
import { buildTicketRow, buildTicketCard } from '../js/admin.js';
import { statusBadgeClass, ticketStatusLabel, ticketKindLabel } from '../js/format.js';

const SAMPLE = {
  id: 'CIV-DEMOB1',
  status: 'in_process',
  kind: 'report',
  title: 'Loud karaoke at 2 AM',
  resident_name: 'Renato M.',
  created_at: new Date('2025-08-30T10:00:00Z').toISOString(),
};

describe('buildTicketRow', function () {
  it('returns a <tr> with the right data attributes', function () {
    var tr = buildTicketRow(SAMPLE);
    expect(tr.tagName).toBe('TR');
    expect(tr.getAttribute('data-testid')).toBe('ticket-card');
    expect(tr.getAttribute('data-ticket-id')).toBe('CIV-DEMOB1');
    expect(tr.getAttribute('data-status')).toBe('in_process');
  });

  it('exposes the same data-testid as buildTicketCard (compat)', function () {
    expect(buildTicketRow(SAMPLE).getAttribute('data-testid'))
      .toBe(buildTicketCard(SAMPLE).getAttribute('data-testid'));
  });

  it('renders the ticket id in the first cell', function () {
    var tr = buildTicketRow(SAMPLE);
    var firstCell = tr.querySelector('td');
    expect(firstCell).toBeTruthy();
    expect(firstCell.textContent).toBe('CIV-DEMOB1');
  });

  it('includes a status badge with the right label and class', function () {
    var tr = buildTicketRow(SAMPLE);
    var badge = tr.querySelector('.badge-inline');
    expect(badge).toBeTruthy();
    expect(badge.classList.contains(statusBadgeClass('ticket', 'in_process'))).toBe(true);
    expect(badge.textContent).toContain(ticketStatusLabel('in_process'));
  });

  it('includes the title and kind label', function () {
    var tr = buildTicketRow(SAMPLE);
    expect(tr.textContent).toContain('Loud karaoke at 2 AM');
    expect(tr.textContent).toContain(ticketKindLabel('report'));
  });

  it('shows the resident name (or "Anonymous" when missing)', function () {
    var tr = buildTicketRow(SAMPLE);
    expect(tr.textContent).toContain('Renato M.');
    var anon = buildTicketRow(Object.assign({}, SAMPLE, { resident_name: null }));
    expect(anon.textContent).toContain('Anonymous');
  });

  it('escapes HTML in the title (no XSS via table cell)', function () {
    var evil = Object.assign({}, SAMPLE, { title: '<script>alert(1)</script>' });
    var tr = buildTicketRow(evil);
    expect(tr.querySelector('script')).toBe(null);
    // textContent still surfaces the raw string; the point is that the DOM
    // doesn't contain a live <script> element.
    expect(tr.textContent).toContain('<script>alert(1)</script>');
  });

  it('falls back to empty data-status when status is missing', function () {
    var weird = buildTicketRow(Object.assign({}, SAMPLE, { status: undefined }));
    expect(weird.getAttribute('data-status')).toBe('');
  });

  it('renders 5 cells in the documented column order', function () {
    var tr = buildTicketRow(SAMPLE);
    var cells = tr.querySelectorAll('td');
    expect(cells.length).toBe(5);
    expect(cells[0].textContent).toBe('CIV-DEMOB1');            // ID
    expect(cells[1].textContent).toContain('Loud karaoke');       // Issue
    expect(cells[2].textContent).toContain('Renato M.');          // Resident
    expect(cells[3].textContent).toContain('In Process');         // Status
    // Cells[4] = Updated (relative time string)
    expect(cells[4].textContent.length).toBeGreaterThan(0);
  });
});
