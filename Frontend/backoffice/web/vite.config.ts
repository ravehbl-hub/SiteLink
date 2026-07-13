import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// @sitelink/backoffice-web — Vite + React SPA (Phase 05, ADMIN-only Back Office).
export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
  build: { outDir: 'dist', sourcemap: false },
});
