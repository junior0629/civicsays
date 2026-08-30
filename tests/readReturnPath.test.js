// =========================================================================
// tests/readReturnPath.test.js
// Verifies the open-redirect guard on the login form's `return` param.
// =========================================================================

import { describe, it, expect } from 'vitest';
import { readReturnPath } from '../js/login.js';

describe('readReturnPath', function () {
  function withReturn(value) {
    var url = 'http://localhost/login.html' + (value == null ? '' : '?return=' + encodeURIComponent(value));
    // jsdom: replace the test window's location.search for this call.
    var orig = window.location;
    delete window.location;
    window.location = new URL(url);
    return function restore() { window.location = orig; };
  }

  it('defaults to admin.html when no return param', function () {
    var restore = withReturn(null);
    try { expect(readReturnPath()).toBe('admin.html'); }
    finally { restore(); }
  });

  it('accepts a simple relative path', function () {
    var restore = withReturn('admin.html');
    try { expect(readReturnPath()).toBe('admin.html'); }
    finally { restore(); }
  });

  it('accepts a nested relative path', function () {
    var restore = withReturn('/admin.html?tab=inquiries');
    try { expect(readReturnPath()).toBe('/admin.html?tab=inquiries'); }
    finally { restore(); }
  });

  it('rejects protocol-relative URLs (open redirect)', function () {
    var restore = withReturn('//evil.com/steal');
    try { expect(readReturnPath()).toBe('admin.html'); }
    finally { restore(); }
  });

  it('rejects absolute http URLs', function () {
    var restore = withReturn('https://evil.com/');
    try { expect(readReturnPath()).toBe('admin.html'); }
    finally { restore(); }
  });

  it('rejects javascript: URIs', function () {
    var restore = withReturn('javascript:alert(1)');
    try { expect(readReturnPath()).toBe('admin.html'); }
    finally { restore(); }
  });
});
