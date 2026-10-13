import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The rich-text editor's tests (src/**/*.spec.ts(x)), in jsdom. Kept apart from
// vite.config.ts, which needs PORT and BASE_PATH, and from the node:test suite
// in tests/ that `pnpm test` runs.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
    dedupe: ['react', 'react-dom'],
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.spec.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
  },
});
