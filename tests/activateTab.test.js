// =========================================================================
// tests/activateTab.test.js
// Verifies the WAI-ARIA single-tab pattern: the Tickets tab is always
// selected, regardless of the caller's argument. Inquiries moved out
// of the middle column into the right rail, so there's nothing to
// flip anymore — but the helper is still exported and still does
// the right thing for any incoming refs.
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
    panelTickets: makeEl('section'),
  };
}

describe('activateTab', function () {
  /** @type {ReturnType<typeof makeRefs>} */
  var refs;

  beforeEach(function () {
    refs = makeRefs();
  });

  it('always selects tickets and shows the panel', function () {
    var r = activateTab(refs, 'tickets');
    expect(r).toBe('tickets');
    expect(refs.tabTickets.getAttribute('aria-selected')).toBe('true');
    expect(refs.tabTickets.getAttribute('tabindex')).toBe('0');
    expect(refs.tabTickets.classList.contains('is-active')).toBe(true);
    expect(refs.panelTickets.hidden).toBe(false);
  });

  it('still selects tickets when given "inquiries" (no longer a tab)', function () {
    // Inquiries has moved to the right rail; activateTab is a
    // single-tab helper now and ignores the second argument.
    var r = activateTab(refs, 'inquiries');
    expect(r).toBe('tickets');
    expect(refs.tabTickets.getAttribute('aria-selected')).toBe('true');
    expect(refs.panelTickets.hidden).toBe(false);
  });

  it('treats unknown tab values as tickets', function () {
    var r = activateTab(refs, 'garbage');
    expect(r).toBe('tickets');
    expect(refs.tabTickets.getAttribute('aria-selected')).toBe('true');
  });

  it('is idempotent — repeated calls leave state settled', function () {
    activateTab(refs, 'tickets');
    activateTab(refs, 'tickets');
    activateTab(refs, 'tickets');
    expect(refs.tabTickets.getAttribute('aria-selected')).toBe('true');
    expect(refs.tabTickets.getAttribute('tabindex')).toBe('0');
    expect(refs.tabTickets.classList.contains('is-active')).toBe(true);
    expect(refs.panelTickets.hidden).toBe(false);
  });
});
