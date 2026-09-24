// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const sonarjs = require('eslint-plugin-sonarjs');

module.exports = defineConfig([
  expoConfig,
  sonarjs.configs.recommended,
  {
    ignores: [
      'dist/*',
      '.expo/*',
      '.claude/*',
      '.scratch/*',
      '.venv/*',
      '.gemini/*',
      'android/*',
      'ios/*',
      'releases/*',
      '_MIDIS/*',
      '_CHORDS/*',
      'graft/*',
      'docs/*',
    ],
  },
]);
