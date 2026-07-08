#!/usr/bin/env bash
# Stop hook: full gate before a work unit is declared done, so nothing is
# reported complete while the tree is red. Mirrors the CI gate locally.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# Load local env (DATABASE_URL et al.) so DB-backed integration suites can
# connect — without it every package that imports @silo/db throws at import
# time ("DATABASE_URL must be set") and the gate reds out for a non-reason.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

# `test` runs with --concurrency=1: every DB-backed package's vitest suite
# spins up its own disposable Postgres database, and running all 8 packages'
# suites at once against the single local Postgres exhausts connections
# (FATAL 57P01, api 500s) and tips trivial tests past vitest's 5s default
# (barrel-export smoke tests, the migration test). Sequential test packages
# remove that contention entirely so the gate is deterministic. check-types
# and quality don't touch the DB, so they keep full parallelism.
out="$(pnpm turbo run check-types 2>&1 && pnpm turbo run test --concurrency=1 2>&1 && pnpm quality 2>&1)"
rc=$?
if [ $rc -ne 0 ]; then
  {
    echo "Gate is RED — do not declare this unit done:"
    echo "$out" | tail -40
  } >&2
  exit 2
fi
exit 0
