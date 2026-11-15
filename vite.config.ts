import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, 'src/core'),
      '@storage': path.resolve(__dirname, 'src/storage'),
      '@audio': path.resolve(__dirname, 'src/audio-host'),
      '@ui': path.resolve(__dirname, 'src/ui'),
    },
  },
  worker: {
    format: 'es',
  },
});
