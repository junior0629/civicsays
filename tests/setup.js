// =========================================================================
// tests/setup.js
// Stub the browser globals that js/ modules read on import, so the
// modules can load under Node without throwing.
// =========================================================================

// js/config.js sets `window.__CIVICSAYS_ENV__`. Provide a stub.
if (typeof window !== 'undefined') {
  if (!window.__CIVICSAYS_ENV__) {
    window.__CIVICSAYS_ENV__ = {
      supabaseUrl: 'http://localhost',
      supabaseAnonKey: 'test-anon-key',
    };
  }
}
