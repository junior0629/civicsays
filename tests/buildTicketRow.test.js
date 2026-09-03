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
  // Assignee fields (Change 3). Defaults to null = Unassigned so the
  // existing specs continue to assert the "Unassigned" rendering
  // without further changes.
  assigned_official_id: null,
  assigned_official_name: null,
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

  it('renders 7 cells in the documented column order: ID, Resident, Issue, Type, Assignee, Status, Updated', function () {
    var tr = buildTicketRow(SAMPLE);
    var cells = tr.querySelectorAll('td');
    expect(cells.length).toBe(7);
    expect(cells[0].textContent).toBe('CIV-DEMOB1');            // ID
    expect(cells[1].textContent).toContain('Renato M.');          // Resident
    expect(cells[2].textContent).toContain('Loud karaoke');       // Issue
    expect(cells[3].textContent).toContain(ticketKindLabel('report')); // Type
    expect(cells[3].classList.contains('admin-table-cell-type')).toBe(true);
    expect(cells[3].classList.contains('kind-report')).toBe(true);
    expect(cells[4].textContent).toBe('Unassigned');              // Assignee (no id)
    expect(cells[4].classList.contains('is-unassigned')).toBe(true);
    expect(cells[5].textContent).toContain('In Process');         // Status
    // Cells[6] = Updated (relative time string)
    expect(cells[6].textContent.length).toBeGreaterThan(0);
  });

  it('shows the assigned official name (not "Unassigned") when the row has an assignee', function () {
    var assigned = Object.assign({}, SAMPLE, {
      assigned_official_id: '11111111-2222-3333-4444-555555555555',
      assigned_official_name: 'Maria Chen',
    });
    var tr = buildTicketRow(assigned);
    var cells = tr.querySelectorAll('td');
    expect(cells.length).toBe(7);
    expect(cells[4].textContent).toBe('Maria Chen');
    expect(cells[4].classList.contains('is-unassigned')).toBe(false);
    expect(cells[4].getAttribute('title')).toBe('Maria Chen');
  });

  it('falls back to "Unknown" when the id is set but the name is missing', function () {
    var orphan = Object.assign({}, SAMPLE, {
      assigned_official_id: '11111111-2222-3333-4444-555555555555',
      assigned_official_name: null,
    });
    var tr = buildTicketRow(orphan);
    var cells = tr.querySelectorAll('td');
    expect(cells[4].textContent).toBe('Unknown');
    expect(cells[4].classList.contains('is-unassigned')).toBe(false);
  });

  it('Type chip uses kind-request class for request rows and kind-report for report rows', function () {
    var req = buildTicketRow(Object.assign({}, SAMPLE, { kind: 'request' }));
    var rep = buildTicketRow(Object.assign({}, SAMPLE, { kind: 'report' }));
    var unk = buildTicketRow(Object.assign({}, SAMPLE, { kind: null }));
    expect(req.querySelector('.admin-table-cell-type.kind-request')).toBeTruthy();
    expect(rep.querySelector('.admin-table-cell-type.kind-report')).toBeTruthy();
    expect(unk.querySelector('.admin-table-cell-type.kind-unknown')).toBeTruthy();
  });
});
