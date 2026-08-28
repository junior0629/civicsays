// =========================================================================
// CivicSays — auth.js
// Supabase Auth wrapper. Sign in, sign out, get current official, observe
// session changes.
// =========================================================================

import { getClient, unwrap, friendlyError, T } from './supabase.js';

/**
 * @typedef {{ id: string, email: string, full_name: string, is_active: boolean }} Official
 */

/**
 * Sign in an official.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<Official>}
 */
export async function signIn(email, password) {
  var c = await getClient();
  var result = await c.auth.signInWithPassword({ email, password });
  if (result.error) {
    throw new Error(friendlyError(result.error));
  }
  // Load the matching officials row.
  var user = result.data.user;
  if (!user) throw new Error('Login succeeded but no user returned.');

  var row = await unwrap(
    c.from(T.OFFICIALS)
      .select('id, email, full_name, is_active')
      .eq('id', user.id)
      .maybeSingle()
  );

  if (!row) {
    await signOut();
    throw new Error('Account is not registered as an official.');
  }
  if (!row.is_active) {
    await signOut();
    throw new Error('This account has been deactivated.');
  }
  return row;
}

/**
 * Sign out the current official.
 * @returns {Promise<void>}
 */
export async function signOut() {
  var c = await getClient();
  await c.auth.signOut();
}

/**
 * Get the current official (null if not signed in or not a registered official).
 * @returns {Promise<Official | null>}
 */
export async function getCurrentOfficial() {
  var c = await getClient();
  var sessionResult = await c.auth.getSession();
  var session = sessionResult.data.session;
  if (!session) return null;
  var user = session.user;
  if (!user) return null;

  var row = await unwrap(
    c.from(T.OFFICIALS)
      .select('id, email, full_name, is_active')
      .eq('id', user.id)
      .maybeSingle()
  );
  if (!row || !row.is_active) return null;
  return row;
}

/**
 * Subscribe to auth state changes.
 * @param {(event: 'SIGNED_IN'|'SIGNED_OUT'|'TOKEN_REFRESHED', session: object|null) => void} cb
 * @returns {{ unsubscribe: () => void }}
 */
export function onAuthChange(cb) {
  let sub = null;
  let cancelled = false;
  (async () => {
    var c = await getClient();
    if (cancelled) return;
    var result = c.auth.onAuthStateChange((event, session) => cb(event, session));
    sub = result.data.subscription;
  })();
  return {
    unsubscribe() {
      cancelled = true;
      if (sub) sub.unsubscribe();
    },
  };
}

/**
 * Redirect to /login.html if not signed in as an official. Returns the
 * official on success. Use at the top of admin-only pages.
 *
 * @param {string} [returnPath]  where to come back to after login
 * @returns {Promise<Official>}
 */
export async function requireOfficial(returnPath) {
  var official = await getCurrentOfficial();
  if (!official) {
    var back = returnPath || (window.location.pathname + window.location.search);
    window.location.replace('login.html?return=' + encodeURIComponent(back));
    // Returning a never-resolving promise so the caller doesn't proceed.
    return new Promise(function () {});
  }
  return official;
}
