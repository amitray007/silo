#!/usr/bin/env bash
#
# One-command harness to (re)generate silo's README / marketing screenshots.
#
# It stands up a fully ISOLATED throwaway Postgres (never your real silo DB),
# migrates it, seeds ~24 curated on-brand links through the real /api/ingest
# endpoint (so silo's own enrichment fetches live metadata + covers), then
# serves the built web app and drives `agent-browser` to capture the suite.
#
# Requires: docker, pnpm, node/npx, and the `agent-browser` CLI on PATH.
#
# Usage:
#   scripts/screenshots/run.sh            # full flow: db → seed → serve → capture
#   scripts/screenshots/run.sh --seed     # db + seed only (leave server up? no — see below)
#   scripts/screenshots/run.sh --capture  # capture only (assumes server already up)
#
# Nothing here touches your real DB, your .env, or your repo dependencies.
set -euo pipefail

# ── config ───────────────────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="${OUT_DIR:-$REPO_ROOT/docs/design/app/shots}"
PG_CONTAINER="silo-shots-pg"
PG_DB="silo_shots"
PG_USER="silo"
PG_PASS="silo"
APP_PORT="${APP_PORT:-8788}"
BASE_URL="http://127.0.0.1:${APP_PORT}"
API_TOKEN="shots-seed-token-local-only"
IMAGE="pgvector/pgvector:pg18"

log() { printf '\033[1;36m[shots]\033[0m %s\n' "$*"; }

# Pick a free host port for the throwaway pg (avoids clashing with a local pg).
pick_port() {
  for p in 5455 5456 5457 5460 5461; do
    if ! lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then echo "$p"; return; fi
  done
  echo "5455"
}

start_db() {
  log "starting isolated throwaway Postgres ($PG_CONTAINER)…"
  docker rm -f "$PG_CONTAINER" >/dev/null 2>&1 || true
  PG_PORT="$(pick_port)"
  docker run -d --name "$PG_CONTAINER" \
    -e POSTGRES_USER="$PG_USER" -e POSTGRES_PASSWORD="$PG_PASS" -e POSTGRES_DB="$PG_DB" \
    -p 127.0.0.1:"$PG_PORT":5432 "$IMAGE" >/dev/null
  for _ in $(seq 1 30); do
    docker exec "$PG_CONTAINER" pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1 && break
    sleep 1
  done
  # 127.0.0.1 (not localhost) to force IPv4 and dodge an IPv6 local-pg collision.
  export DATABASE_URL="postgres://${PG_USER}:${PG_PASS}@127.0.0.1:${PG_PORT}/${PG_DB}"
  log "throwaway DB up at $DATABASE_URL"
}

migrate_db() {
  log "migrating throwaway DB…"
  ( cd "$REPO_ROOT/packages/db" && DATABASE_URL="$DATABASE_URL" npx tsx src/migrate.ts )
}

build_web() {
  log "building web bundle…"
  ( cd "$REPO_ROOT" && pnpm --filter @silo/web run build >/dev/null )
}

# Start the app (api + worker + static web) against the throwaway DB.
# $1 = "seed"  → SILO_API_TOKEN set (ingest open, but web shows login gate)
# $1 = "open"  → no auth env (web renders directly, ready for screenshots)
start_app() {
  local mode="$1"
  local env_extra=()
  if [[ "$mode" == "seed" ]]; then env_extra+=("SILO_API_TOKEN=$API_TOKEN"); fi
  log "starting app ($mode) on $BASE_URL…"
  ( cd "$REPO_ROOT" && \
    env DATABASE_URL="$DATABASE_URL" PORT="$APP_PORT" \
        SILO_WEB_DIST="$REPO_ROOT/packages/web/dist" \
        "${env_extra[@]}" \
        npx tsx packages/app/src/api-main.ts ) &
  APP_PID=$!
  # wait for /health
  for _ in $(seq 1 40); do
    curl -sf "$BASE_URL/health" >/dev/null 2>&1 && { log "app healthy (pid $APP_PID)"; return; }
    sleep 0.5
  done
  log "app did not become healthy" >&2; exit 1
}

stop_app() {
  [[ -n "${APP_PID:-}" ]] && kill "$APP_PID" >/dev/null 2>&1 || true
  wait "${APP_PID:-}" 2>/dev/null || true
  APP_PID=""
}

seed() {
  log "seeding curated links via /api/ingest…"
  ( cd "$REPO_ROOT" && \
    DATABASE_URL="$DATABASE_URL" INGEST_URL="$BASE_URL" SILO_API_TOKEN="$API_TOKEN" \
    npx tsx scripts/screenshots/seed.ts )
}

capture() {
  log "capturing screenshots into $OUT_DIR…"
  mkdir -p "$OUT_DIR"
  BASE_URL="$BASE_URL" OUT_DIR="$OUT_DIR" bash "$REPO_ROOT/scripts/screenshots/capture.sh"
}

cleanup() {
  stop_app
  # Leave the container for inspection unless KEEP_DB=0. Remove explicitly with:
  #   docker rm -f silo-shots-pg
  if [[ "${KEEP_DB:-1}" == "0" ]]; then
    log "removing throwaway DB container…"
    docker rm -f "$PG_CONTAINER" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# ── flow ─────────────────────────────────────────────────────────────────
MODE="${1:-full}"
case "$MODE" in
  --capture)
    # assumes DATABASE_URL + a running open app already exist
    : "${DATABASE_URL:?set DATABASE_URL for --capture}"
    capture
    ;;
  --seed)
    start_db; migrate_db; build_web; start_app seed; seed; stop_app
    log "seed complete. DB kept at: $DATABASE_URL"
    ;;
  full|*)
    start_db
    migrate_db
    build_web
    start_app seed        # ingest needs the token
    seed
    stop_app              # restart WITHOUT auth so the web renders (no login gate)
    start_app open
    capture
    log "done. shots in $OUT_DIR"
    ;;
esac
