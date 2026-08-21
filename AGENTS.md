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

## Before you commit

```
npm run typecheck
npm test
```

Tests are pure TypeScript and must stay that way — nothing in `src/domain`,
`src/audio` (except the mic sources) or `tools` may import React Native.
