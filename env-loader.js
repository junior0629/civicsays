// =========================================================================
// CivicSays — env-loader.js
// Synchronous boot script. Loaded as a classic <script> (NOT module) so it
// runs before the body. Ensures window.__CIVICSAYS_ENV__ is set, then
// lazy-loads the Supabase JS SDK from the CDN.
//
// Lookup order (first non-empty wins):
//   1. localStorage["civicsays.env"]      (browser-specific override)
//   2. window.__CIVICSAYS_ENV__            (set by js/config.js — committed default)
//   3. (missing)                            -> redirect to setup.html
//
// The committed default (js/config.js) means the app works "out of the
// box" for anyone who has the project. For a per-browser override, paste
// a different env into DevTools (or run setup.html).
// =========================================================================

(function () {
  var LS_KEY = 'civicsays.env';
  var saved = null;
  try {
    var raw = localStorage.getItem(LS_KEY);
    if (raw) saved = JSON.parse(raw);
  } catch (e) {
    saved = null;
  }

  window.__CIVICSAYS_ENV__ =
    (saved && saved.supabaseUrl && saved.supabaseAnonKey)
      ? saved
      : (window.__CIVICSAYS_ENV__ && window.__CIVICSAYS_ENV__.supabaseUrl && window.__CIVICSAYS_ENV__.supabaseAnonKey
          ? window.__CIVICSAYS_ENV__
          : null);

  // Persist the committed default to localStorage so the rest of the app
  // can read it from one consistent place.
  if (!saved && window.__CIVICSAYS_ENV__) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(window.__CIVICSAYS_ENV__)); } catch (e) {}
  }

  // Determine whether this page needs env to function.
  var path = window.location.pathname;
  var requiresEnv = /(^\/|\/)submit\.html$|(\/)ticket\.html$|(\/)admin\.html$|(\/)login\.html$/.test(path)
    || path.endsWith('/submit.html')
    || path.endsWith('/ticket.html')
    || path.endsWith('/admin.html')
    || path.endsWith('/login.html');

  if (!window.__CIVICSAYS_ENV__ && requiresEnv && !path.endsWith('/setup.html')) {
    window.location.replace('setup.html?return=' + encodeURIComponent(path + window.location.search));
    return;
  }

  // Lazy-load Supabase JS SDK only when env is configured.
  if (window.__CIVICSAYS_ENV__) {
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';
    s.defer = true;
    s.onerror = function () {
      console.error('CivicSays: failed to load Supabase SDK from CDN');
    };
    document.head.appendChild(s);
  }
})();
