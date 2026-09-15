# Working on this repo

Expo SDK 57 / React Native 0.86 / React 19.2. Read the exact versioned docs at
https://docs.expo.dev/versions/v57.0.0/ before writing any code — the SDK has
changed a lot.

## React Compiler is enabled

`app.json` sets `experiments.reactCompiler: true`. **Reanimated shared values
must use `.get()` and `.set()`, never `.value`.** The compiler cannot track
property access, so `sv.value = x` silently does nothing at runtime — the
symptom is an animation that renders its initial frame and then freezes, with
no error anywhere. This cost an afternoon once; do not reintroduce it.

```ts
// wrong — compiles, runs, does nothing
timeMs.value = timeMs.value + delta;
// right
timeMs.set(timeMs.get() + delta);
```

## Sizes are design units, not pixels

Everything visual is written against an 829 × 690 canvas (the Fold 5 inner
display at its native density) and converted through `useTheme().s()`. See
`src/theme/scale.ts`. Drawing components that need to fill a box take **device
pixels** and get them from `useMeasuredSize()` — do not compute a column's
height by subtracting constants from the canvas, because safe-area insets and
rounding will make it wrong by exactly the amount you forgot.

The same trap exists outside Reanimated. **Never read store state through a
stable getter function during render** (`const choice = store.get(id)`): the
compiler memoises the call on the getter's identity, so the value never updates
— this is why picking a track part once did nothing. Subscribe instead
(`useSettingsSelector`, `useTrackChoice`, `usePlayheadPosition`).

## The play screen's clock

Score time is anchored, not accumulated (`src/domain/transportClock.ts`), and
locked to the audio adapter's own position a few times a second. Do not
reintroduce `time += frameDelta`, and do not put per-note React state on the
play screen root — leaves subscribe with `usePlayheadPosition`.

## Library editions

`npm run build:library` (full: public domain + etudes + every song folder in
`_MIDIS/arranged`) and `npm run build:library:free` (public domain + etudes
only) regenerate `bundledSongs.json`, `catalogIndex.ts` and
`libraryEdition.ts`. `npm run release:full` / `release:free` build a named APK
into `releases/`. Tests that assert library *size* gate on
`LIBRARY_EDITION.id`; correctness checks run for both.

## Before you commit

```
npm run typecheck
npm test
```

Tests are pure TypeScript and must stay that way — nothing in `src/domain`,
`src/audio` (except the mic sources) or `tools` may import React Native.

<!-- graft:start -->
## Graft — repo context graph

This repo is indexed in `graft/`: small linked markdown nodes that explain each
system and carry exact file:line spans, kept in sync with the code through git.

For ANY task here — understanding how something works, finding where code lives,
or scoping a change — get context from the graph before grepping or opening
source files. Re-ask freely (it's cheap) and reuse literal identifiers you
already have (symbol, error string, file name) as the query. New to this repo?
Run `graft map` first — a token-budgeted orientation (dir clusters, hubs,
hotspots), no LLM, no key.

- Run `graft ask "<your question>" --source` → ranked nodes with the relevant
  code spans inlined (each hit's ≤8-line crux by default; `--full` for whole
  definitions when the crux isn't enough). Match the tool to the task shape:
  for understanding or editing, the top node IS the answer — cite its
  `covers:` file:line spans and edit straight from `--source`. For
  exhaustive tasks ("every occurrence / every caller of this pattern"), ranked
  results are top-N, not complete — run `graft grep "<literal>"` instead
  (exhaustive over indexed files, grouped by enclosing symbol), falling back
  to raw `grep -rn` only for unindexed files.
- `graft skeleton <file>` → every definition's signature + span, ~10× cheaper
  than reading the file; use it to skim an API surface.
- `graft callers <symbol>` gives precomputed, exact edges — who calls this.
  Add `--direction out` for what it calls, or `--depth N` to walk
  transitively for the full blast radius. For structural questions, skip
  ranking and use this directly.
- Or browse: `graft/INDEX.md` lists every node; follow the links.
- Monorepos and folders of multiple repos rank fairly across sub-projects —
  hits carry `[scope/]` labels naming which one they're from. Narrow with
  `graft ask "<task>" --in <scope>/` once you know where you're working.

If a returned span is truncated ("+N more lines"), open the file at that exact
range before finalizing. Only open source files when a node genuinely lacks a
needed detail, and then at the exact file:line the node points to — never
re-read whole files.

After big code changes, refresh the graph with `graft build` (deterministic,
no API key, $0).
<!-- graft:end -->
