#!/usr/bin/env bash
#
# Captures the product site's screenshots from the iPhone Duo simulator, held
# sideways, and writes them to docs/assets/screenshots/ as 1048 × 720 WebP.
#
#   tools/capture-site-shots.sh <simulator-udid> [shot ...]
#
# Needs: a Release build of the FREE edition installed on the simulator
# (public-domain pieces and etudes only — never put the full library on the
# site), `axe`, `cwebp` and ffmpeg on the PATH, and the Duo rotated to
# landscape. Xcode 27 ships DeviceHub in place of Simulator.app; rotate with
# its Device menu, or with Cmd+Left while its window is focused.
#
# Shots are listed in SHOTS below as name|deep link|taps. Each tap is an
# accessibility label for `axe tap --label`, comma-separated, run in order.
set -euo pipefail

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
UDID="${1:?usage: $0 <simulator-udid> [shot ...]}"; shift || true
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/docs/assets/screenshots"
RAW="${RAW:-$(mktemp -d)}"
SETTLE="${SETTLE:-2.5}"

# name|deep link|taps before the capture
SHOTS=(
  "library|ponticello://|"
  "library-dark|ponticello://|Theme"
  "library-neon|ponticello://|Theme"
  "play-tab|ponticello://play/bwv1007-prelude|Tab"
  "play-score|ponticello://play/bwv1007-prelude|Score"
  "play-highway|ponticello://play/bwv1007-prelude|Highway"
  "practice-setup|ponticello://song/bwv1007-prelude|"
  "tuner|ponticello://tuner|"
  "practice-record|ponticello://profile|"
  "chords|ponticello://chords|"
  "chord-chart|ponticello://chord-song/ponticello-seven-changes|"
  "chord-progression|ponticello://chord-progression|"
  "fingerboard-chart|ponticello://chart|"
  "scales|ponticello://scales|"
  "reading-guide|ponticello://tutorial|"
  "tapes|ponticello://settings/tapes|"
)

shoot() {
  local name="$1" link="$2" taps="$3"
  xcrun simctl openurl "$UDID" "$link"
  sleep "$SETTLE"
  if [ -n "$taps" ]; then
    IFS=',' read -ra labels <<< "$taps"
    for label in "${labels[@]}"; do axe tap --label "$label" --udid "$UDID"; sleep 1; done
  fi
  xcrun simctl io "$UDID" screenshot "$RAW/$name.png" >/dev/null
  cwebp -quiet -q 82 -resize 1048 720 "$RAW/$name.png" -o "$OUT/$name.webp"
  echo "  $name.webp"
}

mkdir -p "$OUT"
for entry in "${SHOTS[@]}"; do
  IFS='|' read -r name link taps <<< "$entry"
  if [ "$#" -eq 0 ] || printf '%s\n' "$@" | grep -qx "$name"; then shoot "$name" "$link" "$taps"; fi
done
