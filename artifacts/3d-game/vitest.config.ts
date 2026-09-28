import path from 'path';
import { defineConfig } from 'vitest/config';

// Unit tests for the framework-free game math (tracking, calibration, flick detection, rings). Kept
// separate from vite.config.ts so tests don't load the React/Tailwind/MediaPipe/Replit plugins.
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
