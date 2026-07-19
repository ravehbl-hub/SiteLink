import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// @sitelink/website — public marketing / landing site (Vite + React SPA).
// Port 5175 avoids clashing with manager-web (5173) and other web ports.
export default defineConfig({
  plugins: [react()],
  server: { port: 5175 },
  build: { outDir: 'dist', sourcemap: false },
});
