// =========================================================================
// tests/buildPaginationButton.test.js
// Pure helper for the tickets pagination footer. Returns a <button>
// DOM node with the right class, label, dataset, and aria attributes
// for page numbers, Prev, and Next.
// =========================================================================

import { describe, it, expect } from 'vitest';
import {
  buildPaginationButton,
  buildPaginationEllipsis,
  buildPageList,
} from '../js/admin.js';

describe('buildPaginationButton', function () {
  it('renders a page-number button with the visible label', function () {
    var btn = buildPaginationButton({
      label: '1', pageIndex: 0, isActive: true, isDisabled: false,
    });
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.type).toBe('button');
    expect(btn.textContent).toBe('1');
    expect(btn.dataset.page).toBe('0');
    expect(btn.classList.contains('admin-pagination-btn')).toBe(true);
    expect(btn.classList.contains('is-active')).toBe(true);
  });

  it('marks the active page with aria-current and disables the rest', function () {
    var active = buildPaginationButton({
      label: '3', pageIndex: 2, isActive: true, isDisabled: false,
    });
    var inactive = buildPaginationButton({
      label: '2', pageIndex: 1, isActive: false, isDisabled: false,
    });
    expect(active.getAttribute('aria-current')).toBe('page');
    expect(inactive.hasAttribute('aria-current')).toBe(false);
  });

  it('renders Prev with the prev class and "Previous page" aria-label', function () {
    var btn = buildPaginationButton({
      label: '‹', pageIndex: 0, isActive: false, isDisabled: true,
      kind: 'prev',
    });
    expect(btn.classList.contains('admin-pagination-prev')).toBe(true);
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-label')).toBe('Previous page');
    expect(btn.dataset.page).toBe('0');
  });

  it('renders Next with the next class and "Next page" aria-label', function () {
    var btn = buildPaginationButton({
      label: '›', pageIndex: 2, isActive: false, isDisabled: false,
      kind: 'next',
    });
    expect(btn.classList.contains('admin-pagination-next')).toBe(true);
    expect(btn.getAttribute('aria-label')).toBe('Next page');
    expect(btn.dataset.page).toBe('2');
  });

  it('disables a button when isDisabled is true', function () {
    var btn = buildPaginationButton({
      label: '1', pageIndex: 0, isActive: false, isDisabled: true,
    });
    expect(btn.disabled).toBe(true);
  });

  it('coerces non-string labels and pageIndex to strings safely', function () {
    var btn = buildPaginationButton({
      label: 5, pageIndex: 4, isActive: false, isDisabled: false,
    });
    expect(btn.textContent).toBe('5');
    expect(btn.dataset.page).toBe('4');
  });
});

describe('buildPaginationEllipsis', function () {
  it('renders a <span> with the ellipsis character and the right class', function () {
    var el = buildPaginationEllipsis();
    expect(el.tagName).toBe('SPAN');
    expect(el.classList.contains('admin-pagination-ellipsis')).toBe(true);
    expect(el.textContent).toBe('…');
    expect(el.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('buildPageList', function () {
  it('returns an empty list when pageCount is 0 or invalid', function () {
    expect(buildPageList(0, 0)).toEqual([]);
    expect(buildPageList(0, -1)).toEqual([]);
    expect(buildPageList(0, NaN)).toEqual([]);
  });

  it('returns [0] when there is exactly one page', function () {
    expect(buildPageList(0, 1)).toEqual([0]);
  });

  it('returns a flat list of all pages when count is ≤ 7', function () {
    expect(buildPageList(0, 7)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(buildPageList(3, 4)).toEqual([0, 1, 2, 3]);
  });

  it('truncates the middle with ellipsis when on the first page of many', function () {
    // 8 pages, current = 0 → [1, 2, …, 7, 8]
    expect(buildPageList(0, 8)).toEqual([0, 1, '…', 6, 7]);
  });

  it('shows current ± 1 in the middle for a long strip', function () {
    // 8 pages, current = 3.
    // Always-show set = {0, 1, 2, 3, 4, 6, 7}.
    // After sort + gap-fill: [0, 1, 2, 3, 4, '…', 6, 7]
    expect(buildPageList(3, 8)).toEqual([0, 1, 2, 3, 4, '…', 6, 7]);
  });

  it('collapses the right ellipsis when on the last pages', function () {
    // 8 pages, current = 7.
    // Always-show set = {0, 1, 6, 7} (cp-1=6, cp=7, last-2=6, last-1=7).
    // After sort + gap-fill: [0, 1, '…', 6, 7]
    expect(buildPageList(7, 8)).toEqual([0, 1, '…', 6, 7]);
  });

  it('clamps an out-of-range currentPage', function () {
    expect(buildPageList(50, 8)).toEqual([0, 1, '…', 6, 7]);
    expect(buildPageList(-3, 8)).toEqual([0, 1, '…', 6, 7]);
  });
});
