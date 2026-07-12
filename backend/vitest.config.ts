import { defineConfig } from 'vitest/config';

/**
 * Bugo (Back-End QA) — vitest config for the Phase-02 Check gate.
 * Tests live under backend/test/. Setup seeds a deterministic env so the Fastify
 * app can be built DB-less (the pg adapter connects lazily, only on a real query).
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globals: false,
    setupFiles: ['test/setup-env.ts'],
    testTimeout: 15000,
  },
});
