/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// @sitelink/manager-web — Vite + React SPA (Architecture §1).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: { outDir: 'dist', sourcemap: false },
  test: {
    // Bugo (Web QA) regression guards live in qa/. Pure-logic tests → node env.
    environment: 'node',
    include: ['qa/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
  },
});
