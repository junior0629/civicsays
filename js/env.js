// =========================================================================
// CivicSays — env.js
// Reads Supabase URL + anon key from a global __CIVICSAYS_ENV__ object
// (set by env-loader.js) and exposes them as named exports.
//
// Storage order:
//   1. window.__CIVICSAYS_ENV__ (in-memory, set by env-loader.js at boot)
//   2. localStorage["civicsays.env"] (persistent)
//
// To configure: open the app — if env is missing, it auto-redirects to
// /setup.html. The user pastes their Supabase URL + anon key once, and
// it's saved to localStorage for all future loads.
// =========================================================================

const LS_KEY = 'civicsays.env';

/** @typedef {{ supabaseUrl: string, supabaseAnonKey: string }} CivicSaysEnv */

/**
 * @returns {CivicSaysEnv | null}
 */
export function getEnv() {
  // 1) In-memory (set by env-loader)
  if (typeof window !== 'undefined' && window.__CIVICSAYS_ENV__) {
    const e = window.__CIVICSAYS_ENV__;
    if (e.supabaseUrl && e.supabaseAnonKey) return e;
  }
  // 2) localStorage
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.supabaseUrl && parsed.supabaseAnonKey) return parsed;
  } catch {
    // corrupt JSON — treat as missing
  }
  return null;
}

/** @returns {boolean} */
export function hasEnv() {
  return getEnv() !== null;
}

/**
 * Save the env config to localStorage AND set the in-memory global so
 * the current page load picks it up.
 * @param {string} supabaseUrl
 * @param {string} supabaseAnonKey
 */
export function saveEnv(supabaseUrl, supabaseAnonKey) {
  const env = { supabaseUrl, supabaseAnonKey };
  localStorage.setItem(LS_KEY, JSON.stringify(env));
  window.__CIVICSAYS_ENV__ = env;
}

/** Clear the saved env (used by "Reset configuration" button). */
export function clearEnv() {
  localStorage.removeItem(LS_KEY);
  delete window.__CIVICSAYS_ENV__;
}

/**
 * Convenience: the set of paths that need a configured env to function.
 * If env is missing and the user lands on one of these, we redirect to
 * /setup.html. The landing page and track page work without env.
 */
export const REQUIRES_ENV = new Set([
  '/submit.html',
  '/ticket.html',
  '/admin.html',
  '/login.html',
]);
