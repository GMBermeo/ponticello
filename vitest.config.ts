import { defineConfig } from 'vitest/config';
import { PATH_ALIASES } from './tools/pathAliases';

/**
 * Unit tests cover the pure layers only — DSP, cello geometry, the fingering
 * solver and the bundled scores. None of them import React Native, so they run
 * in plain Node with no Metro or native runtime in the way.
 */
export default defineConfig({
  resolve: { alias: PATH_ALIASES },
  test: {
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15000,
  },
});
