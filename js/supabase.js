// =========================================================================
// CivicSays — supabase.js
// Thin wrapper around the Supabase JS client. Single point of contact so
// refactors (e.g. swapping the SDK version) are localized.
// =========================================================================

import { getEnv } from './env.js';

// Table name constants — single source of truth.
export const T = Object.freeze({
  OFFICIALS:             'officials',
  TICKETS:               'tickets',
  TICKET_COMMENTS:       'ticket_comments',
  TICKET_STATUS_HISTORY: 'ticket_status_history',
  INQUIRIES:             'inquiries',
  INQUIRY_MESSAGES:      'inquiry_messages',
});

export const BUCKET_TICKET_ATTACHMENTS = 'ticket-attachments';

let _client = null;
let _initPromise = null;

/**
 * Wait for the Supabase UMD bundle (loaded by env-loader.js) to be ready.
 * Resolves with the global `window.supabase.createClient`.
 */
function waitForSdk() {
  return new Promise(function (resolve, reject) {
    if (typeof window !== 'undefined' && window.supabase && window.supabase.createClient) {
      return resolve(window.supabase);
    }
    var tries = 0;
    var interval = setInterval(function () {
      tries += 1;
      if (window.supabase && window.supabase.createClient) {
        clearInterval(interval);
        resolve(window.supabase);
      } else if (tries > 100) {  // 10s
        clearInterval(interval);
        reject(new Error('Supabase SDK failed to load.'));
      }
    }, 100);
  });
}

/**
 * Get the singleton Supabase client. Idempotent.
 * @returns {Promise<object>}
 */
export async function getClient() {
  if (_client) return _client;
  if (_initPromise) return _initPromise;

  _initPromise = (async function () {
    var env = getEnv();
    if (!env) {
      throw new Error('CivicSays env not configured. Open /setup.html to set it up.');
    }
    var sdk = await waitForSdk();
    _client = sdk.createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: window.localStorage,
        storageKey: 'civicsays.auth',
      },
      realtime: {
        params: { eventsPerSecond: 5 },
      },
    });
    return _client;
  })();

  return _initPromise;
}

/**
 * Wait until the client has finished restoring any persisted session.
 * @returns {Promise<{session: object|null, user: object|null}>}
 */
export async function getSession() {
  var c = await getClient();
  var result = await c.auth.getSession();
  return result.data;
}

/**
 * Convert a Supabase error (or thrown anything) into a short, user-facing string.
 * @param {unknown} err
 * @returns {string}
 */
export function friendlyError(err) {
  if (!err) return 'Something went wrong. Please try again.';
  if (typeof err === 'string') return err;
  if (err instanceof Error) {
    var msg = err.message || '';
    // Common Supabase / network patterns → friendlier text.
    if (/Failed to fetch|NetworkError|net::ERR_/i.test(msg)) {
      return 'Network error. Please check your connection and try again.';
    }
    if (/Invalid login credentials/i.test(msg)) {
      return 'Invalid email or password.';
    }
    if (/Email not confirmed/i.test(msg)) {
      return 'Please confirm your email before logging in.';
    }
    if (/JWT expired|invalid_token/i.test(msg)) {
      return 'Your session has expired. Please log in again.';
    }
    if (/duplicate key|already exists/i.test(msg)) {
      return 'That record already exists.';
    }
    if (/violates row-level security|permission denied/i.test(msg)) {
      return "You don't have permission to do that.";
    }
    if (/violates check constraint/i.test(msg)) {
      return 'Some fields are invalid. Please review the form.';
    }
    // Postgres exceptions raised by our RPCs — strip "X: " prefix.
    var m = msg.match(/^[^:]+:\s*(.+)$/);
    if (m) return m[1];
    return msg;
  }
  if (typeof err === 'object' && err !== null) {
    if ('message' in err) return friendlyError(err.message);
    if ('error_description' in err) return String(err.error_description);
  }
  return 'Something went wrong. Please try again.';
}

/**
 * Wrap a Supabase promise to surface friendlyError on rejection.
 * Usage: `var data = await unwrap(supabase.from('tickets').select());`
 * @template T
 * @param {Promise<{data: T, error: any}>} p
 * @returns {Promise<T>}
 */
export async function unwrap(p) {
  var result = await p;
  if (result && result.error) {
    var e = new Error(friendlyError(result.error));
    e.cause = result.error;
    throw e;
  }
  return result ? result.data : undefined;
}

/**
 * Build the public URL for a file in the ticket-attachments bucket.
 * @param {string} path  Storage object path (e.g. "CIV-AB3K9X/abc123.jpg")
 * @returns {Promise<string|null>}
 */
export async function getPublicUrl(path) {
  if (!path) return null;
  var c = await getClient();
  var r = c.storage.from(BUCKET_TICKET_ATTACHMENTS).getPublicUrl(path);
  return r.data ? r.data.publicUrl : null;
}

/**
 * Upload a file to the ticket-attachments bucket.
 * @param {string} path  Target object path (e.g. "<ticket-id>/<random>.<ext>")
 * @param {File|Blob} file
 * @param {string} contentType
 * @returns {Promise<string>}  the stored path
 */
export async function uploadAttachment(path, file, contentType) {
  var c = await getClient();
  var r = await c.storage.from(BUCKET_TICKET_ATTACHMENTS).upload(path, file, {
    contentType: contentType,
    upsert: false,
  });
  if (r.error) {
    var e = new Error(friendlyError(r.error));
    e.cause = r.error;
    throw e;
  }
  return r.data.path;
}
