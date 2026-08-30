// =========================================================================
// tests/activateTab.test.js
// Verifies the WAI-ARIA tabs pattern: aria-selected, tabindex, hidden
// panels, and the is-active class all flip in lockstep.
// =========================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { activateTab } from '../js/admin.js';

function makeEl(tag) {
  var el = {
    tag: tag,
    attrs: {},
    classes: new Set(),
    _hidden: false,
    setAttribute: function (k, v) { this.attrs[k] = String(v); },
    getAttribute: function (k) { return this.attrs[k]; },
    get className() { return Array.from(this.classes).join(' '); },
  };
  el.classList = {
    _el: el,
    toggle: function (cls, on) {
      if (on) this._el.classes.add(cls); else this._el.classes.delete(cls);
    },
    add: function (cls) { this._el.classes.add(cls); },
    remove: function (cls) { this._el.classes.delete(cls); },
    contains: function (cls) { return this._el.classes.has(cls); },
  };
  Object.defineProperty(el, 'hidden', {
    get: function () { return this._hidden; },
    set: function (v) { this._hidden = !!v; },
  });
  return el;
}

function makeRefs() {
  return {
    tabTickets:   makeEl('button'),
    tabInquiries: makeEl('button'),
    panelTickets: makeEl('section'),
    panelInquiries: makeEl('section'),
  };
}

describe('activateTab', function () {
  /** @type {ReturnType<typeof makeRefs>} */
  var refs;

  beforeEach(function () {
    refs = makeRefs();
  });

  it('selects tickets by default and hides inquiries', function () {
    var r = activateTab(refs, 'tickets');
    expect(r).toBe('tickets');
    expect(refs.tabTickets.getAttribute('aria-selected')).toBe('true');
    expect(refs.tabInquiries.getAttribute('aria-selected')).toBe('false');
    expect(refs.tabTickets.getAttribute('tabindex')).toBe('0');
    expect(refs.tabInquiries.getAttribute('tabindex')).toBe('-1');
    expect(refs.panelTickets.hidden).toBe(false);
    expect(refs.panelInquiries.hidden).toBe(true);
  });

  it('flips the selection when activated with inquiries', function () {
    activateTab(refs, 'tickets');
    var r = activateTab(refs, 'inquiries');
    expect(r).toBe('inquiries');
    expect(refs.tabTickets.getAttribute('aria-selected')).toBe('false');
    expect(refs.tabInquiries.getAttribute('aria-selected')).toBe('true');
    expect(refs.tabTickets.getAttribute('tabindex')).toBe('-1');
    expect(refs.tabInquiries.getAttribute('tabindex')).toBe('0');
    expect(refs.panelTickets.hidden).toBe(true);
    expect(refs.panelInquiries.hidden).toBe(false);
  });

  it('treats unknown tab values as tickets', function () {
    var r = activateTab(refs, 'garbage');
    expect(r).toBe('tickets');
    expect(refs.tabTickets.getAttribute('aria-selected')).toBe('true');
  });

  it('toggles the is-active class', function () {
    activateTab(refs, 'tickets');
    expect(refs.tabTickets.classList.contains('is-active')).toBe(true);
    expect(refs.tabInquiries.classList.contains('is-active')).toBe(false);
    activateTab(refs, 'inquiries');
    expect(refs.tabTickets.classList.contains('is-active')).toBe(false);
    expect(refs.tabInquiries.classList.contains('is-active')).toBe(true);
  });
});
