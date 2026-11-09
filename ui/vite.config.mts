import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const api = `http://127.0.0.1:${process.env.FLOWKIT_PORT ?? 4321}`;

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5173, proxy: { '/api': api, '/runs': api } },
});
