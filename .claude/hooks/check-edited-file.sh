#!/usr/bin/env bash
# PostToolUse (Edit/Write): lint the edited file, and typecheck the backend when
# a convex/ file changed. Problems go back to Claude (exit 2) so it fixes them.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
file=$(jq -r '.tool_input.file_path // empty')
[[ -n "$file" && -f "$file" ]] || exit 0
file=$(realpath --relative-to=. "$file")
[[ "$file" =~ \.(ts|tsx|js|jsx|mjs)$ && "$file" != *_generated/* && "$file" != ../* ]] || exit 0
[[ -d node_modules ]] || exit 0

out=$(npx eslint --max-warnings=0 "$file" 2>&1) || { echo "eslint found problems in $file:" >&2; echo "$out" >&2; exit 2; }
if [[ "$file" == convex/* ]]; then
  out=$(npx tsc --noEmit -p convex 2>&1) || { echo "Backend typecheck failed:" >&2; echo "$out" | head -40 >&2; exit 2; }
fi
exit 0
