// =========================================================================
// tests/signInErrorMessage.test.js
// Verifies the email-enumeration guard: every non-deactivated failure
// resolves to the same user-facing string, so a probe can't tell wrong
// password from wrong email from non-existent account.
// =========================================================================

import { describe, it, expect } from 'vitest';
import { signInErrorMessage, SignInError } from '../js/login.js';
import { SignInError as AuthSignInError } from '../js/auth.js';

describe('signInErrorMessage', function () {
  it('returns the same string for AuthFailed and NotOfficial (no enumeration)', function () {
    var a = signInErrorMessage(AuthSignInError.AuthFailed);
    var b = signInErrorMessage(AuthSignInError.NotOfficial);
    expect(a).toBe(b);
    expect(a).toMatch(/sign in failed/i);
  });

  it('returns a distinct string for Deactivated so staff know to contact admin', function () {
    var d = signInErrorMessage(AuthSignInError.Deactivated);
    expect(d).toMatch(/deactivated/i);
    expect(d).not.toBe(signInErrorMessage(AuthSignInError.AuthFailed));
  });

  it('falls back to the safe default for unknown codes', function () {
    expect(signInErrorMessage('nonsense')).toMatch(/sign in failed/i);
    expect(signInErrorMessage(undefined)).toMatch(/sign in failed/i);
    expect(signInErrorMessage(null)).toMatch(/sign in failed/i);
  });
});

describe('SignInError constants', function () {
  it('exposes the three stable codes', function () {
    expect(AuthSignInError.AuthFailed).toBe('auth_failed');
    expect(AuthSignInError.NotOfficial).toBe('not_official');
    expect(AuthSignInError.Deactivated).toBe('deactivated');
  });
});
