#!/usr/bin/env bash
# Reviewer B — George (Grok). Deep-tree lens.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
source scripts/review/_preamble.sh "${1:-main}"

REPORT="$OUT_DIR/george-$(git rev-parse --short HEAD).md"
DIFF_FILE="$OUT_DIR/diff-$(git rev-parse --short HEAD).patch"
git diff "$BASE"...HEAD > "$DIFF_FILE"

read -r -d '' PROMPT <<PROMPT_EOF || true
You are Reviewer B in a dual-review pipeline for $REPO_CONTEXT

Your lens is DEEP-TREE: the diff is your entry point, but your value is finding
defects in the interaction between the changed code and the UNCHANGED tree —
call sites of changed functions, invariants defined elsewhere that the change
silently violates, state-machine assumptions, lifecycle and cache interactions,
and contract mismatches. Reviewer A covers the diff-local lens; do not spend
your effort on style or diff-local nits.

Rules of engagement:
- You have read-only file tools rooted at the repository checkout. USE THEM to
  chase every changed symbol out into the unchanged tree.
- Terminal and shell commands are FORBIDDEN — do not attempt them.
- Your FINAL message must be the complete report. Do not end on narration about
  what you are going to do; produce the report itself.

Branch under review: $BRANCH (against $BASE) — $DIFF_STAT
The full diff is in $DIFF_FILE — read it with your file tools before starting.

$EVIDENCE_RULES

$SEVERITY_RULES
PROMPT_EOF

echo "George (Reviewer B, deep-tree) reviewing $BRANCH against $BASE..."
grok --allow "read_file" --allow "grep" --allow "list_dir" \
     --cwd "$(pwd)" "$PROMPT" </dev/null 2>&1 | tee "$REPORT"
echo
echo "Report: $REPORT"
