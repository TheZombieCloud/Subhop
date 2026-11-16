// Builds the client with the in-memory mock backend, for local recordings (npm run record).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  base: './',
  plugins: [react(), tailwind()],
  build: {
    outDir: resolve(here, '../dist-demo'),
    emptyOutDir: true,
    rollupOptions: {
      input: { game: resolve(here, 'game.html'), splash: resolve(here, 'splash.html') },
    },
  },
});
