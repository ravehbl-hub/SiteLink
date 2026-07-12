import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// @sitelink/manager-web — Vite + React SPA (Architecture §1).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: { outDir: 'dist', sourcemap: false },
});
