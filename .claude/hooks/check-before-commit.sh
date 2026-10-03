#!/usr/bin/env bash
# PreToolUse (Bash): before `git commit`, typecheck and run the tests.
# A failure blocks the commit (exit 2) and the output goes back to Claude.
set -uo pipefail
cmd=$(jq -r '.tool_input.command // empty')
[[ "$cmd" =~ (^|[[:space:]\;\&\|])git[[:space:]]+commit ]] || exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
[[ -d node_modules ]] || exit 0

out=$(npx tsc --noEmit -p convex 2>&1) || { echo "Commit blocked: backend typecheck failed." >&2; echo "$out" | head -40 >&2; exit 2; }
out=$(npx tsc --noEmit -p tsconfig.app.json 2>&1) || { echo "Commit blocked: frontend typecheck failed." >&2; echo "$out" | head -40 >&2; exit 2; }
out=$(npx vitest run 2>&1) || { echo "Commit blocked: tests failed." >&2; echo "$out" | tail -60 >&2; exit 2; }
exit 0
