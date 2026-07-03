#!/usr/bin/env bash
# PostToolUse hook: fast per-edit feedback for the agent.
# PostToolUse cannot BLOCK a completed tool call — exit 2 feeds stderr back to
# Claude so it self-corrects on the next turn. This is advisory; the hard gate
# is lefthook + CI.
#
# Reads the hook JSON payload from stdin, extracts the edited file path, and:
#   - runs Biome on that file (fast, per-file safe)
#   - runs a whole-project typecheck when a .ts/.tsx changed (the checker needs
#     the full type graph — a single file is misleading)
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

payload="$(cat)"
file="$(printf '%s' "$payload" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(j.tool_input?.file_path||"")}catch{process.stdout.write("")}})' 2>/dev/null)"

# Only act on TS/TSX/JSON source under the repo.
case "$file" in
  *.ts|*.tsx|*.js|*.jsx|*.json|*.jsonc) ;;
  *) exit 0 ;;
esac
[ -f "$file" ] || exit 0

out="$(pnpm biome check "$file" 2>&1)"
biome_rc=$?

types_out=""
types_rc=0
case "$file" in
  *.ts|*.tsx)
    types_out="$(pnpm turbo run check-types 2>&1)"
    types_rc=$?
    ;;
esac

if [ $biome_rc -ne 0 ] || [ $types_rc -ne 0 ]; then
  {
    echo "Guardrail feedback on ${file}:"
    [ $biome_rc -ne 0 ] && { echo "--- biome ---"; echo "$out" | tail -30; }
    [ $types_rc -ne 0 ] && { echo "--- check-types ---"; echo "$types_out" | tail -30; }
    echo "Fix these before continuing — main must stay green."
  } >&2
  exit 2
fi
exit 0
