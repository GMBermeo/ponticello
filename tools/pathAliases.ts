import path from 'node:path';

/** Barrel folders under `src/`, each importable as `@<name>`. Mirrors `tsconfig.json` `paths`. */
const BARREL_FOLDERS = ['audio', 'components', 'domain', 'scores', 'state', 'theme'] as const;

const SRC = path.resolve(__dirname, '../src');

export interface PathAlias {
  find: RegExp;
  replacement: string;
}

/** Vite/Vitest `resolve.alias` entries matching the TypeScript path aliases. */
export const PATH_ALIASES: PathAlias[] = [
  ...BARREL_FOLDERS.map((folder) => ({
    find: new RegExp(`^@${folder}$`),
    replacement: path.join(SRC, folder, 'index.ts'),
  })),
  { find: /^@\//, replacement: `${SRC}/` },
];
