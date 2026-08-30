// =========================================================================
// vitest.config.js
// Run unit tests against the js/ ES modules. jsdom environment so the
// DOM-touching code (admin.js, login.js) can be loaded without a real
// browser.
// =========================================================================

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['tests/**/*.test.js'],
    // Suppress the noisy network attempts from admin.js (it tries to
    // getClient() on import). The tests never await main() so these
    // don't actually fire; this just silences a misleading warning.
    setupFiles: ['./tests/setup.js'],
  },
});
