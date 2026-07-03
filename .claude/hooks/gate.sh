#!/usr/bin/env bash
# Stop hook: full gate before a work unit is declared done, so nothing is
# reported complete while the tree is red. Mirrors the CI gate locally.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

out="$(pnpm turbo run check-types test 2>&1 && pnpm quality 2>&1)"
rc=$?
if [ $rc -ne 0 ]; then
  {
    echo "Gate is RED — do not declare this unit done:"
    echo "$out" | tail -40
  } >&2
  exit 2
fi
exit 0
