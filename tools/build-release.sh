#!/usr/bin/env bash
#
# Builds one named release APK of Ponticello.
#
#   ./tools/build-release.sh full   # public domain + etudes + every song in _MIDIS/arranged
#   ./tools/build-release.sh free   # public domain + etudes only — safe to share
#
# The two editions differ only in the bundled library, so this regenerates the
# library for the edition, verifies it, builds the APK with tools/build-apk.sh,
# and copies the result into releases/ under a name that says exactly what it
# is. Both editions share one application id: installing one replaces the
# other on a device.
#
set -euo pipefail

EDITION="${1:-}"
if [ "$EDITION" != "full" ] && [ "$EDITION" != "free" ]; then
  echo "usage: $0 full|free" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"
VERSION_CODE="$(node -p "require('./app.json').expo.android.versionCode")"

echo "› building the $EDITION library"
npx vite-node --config vitest.config.ts tools/build-library.ts -- --edition="$EDITION"

COUNT="$(node -e "
  const src = require('fs').readFileSync('src/scores/libraryEdition.ts', 'utf8');
  const m = src.match(/\"bundledCount\": (\d+)/);
  process.stdout.write(m ? m[1] : '0');
")"
SONGS="$(node -e "
  const src = require('fs').readFileSync('src/scores/libraryEdition.ts', 'utf8');
  const m = src.match(/\"songCount\": (\d+)/);
  process.stdout.write(m ? m[1] : '0');
")"

echo "› verifying"
npm run typecheck
npm test

bash tools/build-apk.sh

if [ "$EDITION" = "full" ]; then
  NAME="Ponticello-v${VERSION}-build${VERSION_CODE}-FULL-LIBRARY-${COUNT}-pieces-${SONGS}-arranged-songs-PERSONAL-USE-release.apk"
else
  NAME="Ponticello-v${VERSION}-build${VERSION_CODE}-FREE-LIBRARY-${COUNT}-public-domain-and-etudes-SHAREABLE-release.apk"
fi

mkdir -p "$ROOT/releases"
cp "$ROOT/android/app/build/outputs/apk/release/app-release.apk" "$ROOT/releases/$NAME"
echo
echo "Release: releases/$NAME"
ls -lh "$ROOT/releases/$NAME" | awk '{print "         " $5}'
