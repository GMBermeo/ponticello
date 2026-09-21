import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Unit tests cover the pure layers only — DSP, cello geometry, the fingering
 * solver and the bundled scores. None of them import React Native, so they run
 * in plain Node with no Metro or native runtime in the way.
 */
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15000,
  },
});
