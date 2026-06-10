#!/usr/bin/env bash
#
# record-gif.sh — turn a screen-recording into an optimized, looping GIF
# that matches Markr's existing storefront gifs.
#
# Workflow:
#   1. Record your screen with macOS  (Cmd+Shift+5 → Record Selected Portion).
#      Keep the take tight (10–18s) and the window ~1280px wide.
#   2. Save the .mov, then run this script.
#
# Usage:
#   ./scripts/record-gif.sh <input.mov> <gif-name> [start] [duration]
#
# Examples:
#   ./scripts/record-gif.sh ~/Desktop/rec.mov gif-15-context-bridge
#   ./scripts/record-gif.sh ~/Desktop/rec.mov gif-16-ai-health 2 14
#       (trim: start at 2s, keep 14s)
#
# Requires: ffmpeg   (brew install ffmpeg)
# Optional: gifsicle (brew install gifsicle)  — extra size optimization
#
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $0 <input.mov> <gif-name> [start-seconds] [duration-seconds]" >&2
  exit 1
fi

SRC="$1"
NAME="$2"
START="${3:-}"
DUR="${4:-}"

# Resolve repo root so it works from anywhere
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTDIR="$ROOT/images/screenshots"
OUT="$OUTDIR/${NAME}.gif"
mkdir -p "$OUTDIR"

# Tunables — match the look of the other gifs
FPS=14
WIDTH=1100
MAX_COLORS=160

command -v ffmpeg >/dev/null || { echo "ffmpeg not found — brew install ffmpeg" >&2; exit 1; }
[[ -f "$SRC" ]] || { echo "input not found: $SRC" >&2; exit 1; }

# Optional trim
TRIM=()
[[ -n "$START" ]] && TRIM+=(-ss "$START")
[[ -n "$DUR"   ]] && TRIM+=(-t  "$DUR")

PALETTE="$(mktemp -t markr-palette).png"
trap 'rm -f "$PALETTE"' EXIT

echo "→ generating palette…"
ffmpeg -y "${TRIM[@]}" -i "$SRC" \
  -vf "fps=${FPS},scale=${WIDTH}:-1:flags=lanczos,palettegen=max_colors=${MAX_COLORS}" \
  "$PALETTE" -loglevel error

echo "→ encoding gif…"
ffmpeg -y "${TRIM[@]}" -i "$SRC" -i "$PALETTE" \
  -lavfi "fps=${FPS},scale=${WIDTH}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3" \
  -loop 0 "$OUT" -loglevel error

# Optional extra squeeze — keep under ~8MB for the Marketplace
if command -v gifsicle >/dev/null; then
  echo "→ optimizing with gifsicle…"
  gifsicle -O3 --lossy=40 --colors "$MAX_COLORS" -b "$OUT"
fi

SIZE="$(du -h "$OUT" | cut -f1)"
echo "✓ $OUT  ($SIZE)"
[[ "${SIZE%M*}" =~ ^[0-9]+$ ]] && (( ${SIZE%M*} > 8 )) && \
  echo "⚠ over 8MB — re-run with a shorter [duration] or lower WIDTH/FPS." || true
