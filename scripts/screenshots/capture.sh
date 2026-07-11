#!/usr/bin/env bash
#
# Drives `agent-browser` through silo's UI and captures the README screenshot
# suite. Called by run.sh with BASE_URL + OUT_DIR in the env, but also runnable
# standalone against any already-serving open silo instance:
#
#   BASE_URL=http://127.0.0.1:8788 OUT_DIR=./shots scripts/screenshots/capture.sh
#
# Requires the `agent-browser` CLI on PATH.
#
# Theme note: silo resolves theme from the SERVER setting (GET/PATCH
# /api/settings) first, then localStorage, then the OS `prefers-color-scheme`
# (which headless Chromium defaults to DARK). So to pin a theme deterministically
# we PATCH the server setting AND set the emulated media. And because
# agent-browser dedupes identical render-trees to the same cached frame, each
# shot navigates to a UNIQUE url (`?v=<counter>`) to force a fresh capture.
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8788}"
OUT_DIR="${OUT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/docs/design/app/shots}"
VW="${VW:-1440}"
VH="${VH:-900}"
SESSION="silo-shots"
N=0   # unique-url counter (cache-buster)

mkdir -p "$OUT_DIR"
log() { printf '\033[1;35m[capture]\033[0m %s\n' "$*"; }
AB() { agent-browser --session "$SESSION" "$@"; }

# Pin theme: server setting + emulated media.
set_theme() {
  local t="$1"
  curl -s -X PATCH "$BASE_URL/api/settings" -H 'Content-Type: application/json' \
    -d "{\"theme\":\"$t\"}" >/dev/null || true
  AB set media "$t" >/dev/null 2>&1 || true
}

# Navigate to a route with a unique cache-busting query, settle, then shoot.
# Usage: shot <route> <filename> [settle_ms]
shot() {
  local route="$1" file="$2" settle="${3:-2000}"
  N=$((N + 1))
  local sep='?'; [[ "$route" == *'?'* ]] && sep='&'
  AB open "${BASE_URL}${route}${sep}v=${N}" >/dev/null
  AB wait "$settle" >/dev/null 2>&1 || true
  log "→ $file"
  AB screenshot "$OUT_DIR/$file" >/dev/null
}

# Fresh browser at a retina-ish viewport.
agent-browser close --all >/dev/null 2>&1 || true
AB set viewport "$VW" "$VH" >/dev/null 2>&1 || true

# ── Library, dark (the hero — GitHub viewers skew dark) ─────────────────────
set_theme dark
shot "/" "01-library-dark.png"

# ── Library, light ─────────────────────────────────────────────────────────
set_theme light
shot "/" "02-library-light.png"

# ── Tag view (filtered to #mcp) ────────────────────────────────────────────
shot "/tags/mcp" "03-tag-mcp.png"

# ── Trash view ─────────────────────────────────────────────────────────────
shot "/trash" "04-trash.png"

# ── Settings → Plugins (the MCP/plugins surface) ───────────────────────────
shot "/settings" "05-settings-plugins.png" 1600

# ── Settings → API / MCP tab ───────────────────────────────────────────────
# Navigate fresh, then click the "API / MCP" tab and shoot in place.
N=$((N + 1))
AB open "${BASE_URL}/settings?v=${N}" >/dev/null
AB wait 1400 >/dev/null 2>&1 || true
AB find text "API / MCP" click >/dev/null 2>&1 || AB find text "MCP" click >/dev/null 2>&1 || true
AB wait 800 >/dev/null 2>&1 || true
log "→ 06-settings-mcp.png"
AB screenshot "$OUT_DIR/06-settings-mcp.png" >/dev/null

# ── Command palette (⌘K) over the library ──────────────────────────────────
set_theme dark
N=$((N + 1))
AB open "${BASE_URL}/?v=${N}" >/dev/null
AB wait 1500 >/dev/null 2>&1 || true
AB press "Meta+k" >/dev/null 2>&1 \
  || AB eval "document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',metaKey:true,bubbles:true}))" >/dev/null 2>&1 || true
AB wait 500 >/dev/null 2>&1 || true
AB keyboard type "model context" >/dev/null 2>&1 || true
AB wait 700 >/dev/null 2>&1 || true
log "→ 07-command-palette.png"
AB screenshot "$OUT_DIR/07-command-palette.png" >/dev/null
AB press "Escape" >/dev/null 2>&1 || true

# ── Hover preview (cover image popover) over the library ────────────────────
N=$((N + 1))
AB open "${BASE_URL}/?v=${N}" >/dev/null
AB wait 1500 >/dev/null 2>&1 || true
AB find text "SQLite As An Application" hover >/dev/null 2>&1 \
  || AB find role link first hover >/dev/null 2>&1 || true
AB wait 1100 >/dev/null 2>&1 || true   # cover decodes before it reveals
log "→ 08-hover-preview.png"
AB screenshot "$OUT_DIR/08-hover-preview.png" >/dev/null

log "captured suite into $OUT_DIR"
agent-browser close --all >/dev/null 2>&1 || true
