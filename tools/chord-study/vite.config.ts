import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { PATH_ALIASES } from '../pathAliases';

export default defineConfig({
  root: resolve(__dirname),
  resolve: { alias: PATH_ALIASES },
  server: { host: '127.0.0.1', port: 4173, fs: { allow: [resolve(__dirname, '../..')] } },
  build: { outDir: resolve(__dirname, '../../.expo/chord-study'), emptyOutDir: true },
});
