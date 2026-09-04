#!/usr/bin/env bash
# Reviewer B — George (Grok). Deep-tree lens.
#
# Invocation proven on bt-servant-admin-portal. Three traps, each of which cost
# a dead run there, all handled below:
#
#   1. The default permission mode SILENTLY CANCELS the session when the model
#      reaches for a terminal command. Grant the read-only file tools
#      explicitly and state in the prompt that terminal is forbidden.
#   2. Prompts over roughly 14KB are offloaded to a file the model must read
#      back — so never tell it "you have NO tools", or it cannot recover its
#      own prompt.
#   3. Output that ends on narration ("I'll review...") is a cancelled or
#      stalled run, NOT a clean pass. Require that the final message be the
#      complete report, and treat narration-only output as a retry.
#
# George reads FILES FROM DISK via --cwd, unlike Frank who reads the committed
# diff. Editing the worktree while George is running corrupts the review.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
source scripts/review/_preamble.sh "${1:-origin/develop}"

SHA="$(git rev-parse --short HEAD)"
REPORT="$OUT_DIR/george-$SHA.md"
DIFF_FILE="$OUT_DIR/diff-$SHA.patch"
PROMPT_FILE="$OUT_DIR/george-prompt-$SHA.txt"
git diff "$BASE"...HEAD > "$DIFF_FILE"

read -r -d '' PROMPT_TEMPLATE <<'PROMPT_EOF' || true
You are Reviewer B in a dual-review pipeline for @@REPO_CONTEXT@@

Your lens is DEEP-TREE: the diff is your entry point, but your value is finding
defects in the interaction between the changed code and the UNCHANGED tree —
call sites of changed functions, invariants defined elsewhere that the change
silently violates, state-machine assumptions, lifecycle and cache interactions,
and contract mismatches. Reviewer A (Frank) covers the diff-local lens; do not
spend your effort on style or diff-local nits.

Rules of engagement:
- You have read-only file tools (read_file, grep, list_dir) rooted at the
  repository checkout. USE THEM to chase every changed symbol out into the
  unchanged tree.
- Terminal and shell commands are FORBIDDEN and unavailable — do not attempt
  them.
- If part of this prompt was offloaded to a file, read it back with your file
  tools before starting.
- READ-ONLY: do not modify, create or delete any file. The working tree is
  checked after this run and any mutation voids the review.
- Your FINAL message must be the complete review report. Do not end on
  narration about what you plan to do; a report-less ending is a failed run.

Branch under review: @@BRANCH@@ (against @@BASE@@) — @@DIFF_STAT@@
The full diff is also written to @@DIFF_FILE@@.

@@EVIDENCE_RULES@@

@@SEVERITY_RULES@@

THE FULL DIFF (@@BASE@@...HEAD):

PROMPT_EOF

# The delimiter above is QUOTED ('PROMPT_EOF'), so the prompt is captured
# verbatim: literal backticks and $ in a steer (e.g. `settle()`, or a $VAR named
# in a round-context block) are no longer command-substituted or expanded away.
# The named fields are injected here by literal string replacement. Bash 5.2
# defaults `patsub_replacement` on, which makes a literal `&` in a replacement
# value expand to the matched placeholder (a `feature/a&b` base would inject
# `feature/a@@BASE@@b`); disable it so the value is inserted verbatim. Guarded
# for bash < 5.2, where the option does not exist and `&` is not special.
shopt -u patsub_replacement 2>/dev/null || true
PROMPT="$PROMPT_TEMPLATE"
PROMPT="${PROMPT//@@REPO_CONTEXT@@/$REPO_CONTEXT}"
PROMPT="${PROMPT//@@BRANCH@@/$BRANCH}"
PROMPT="${PROMPT//@@BASE@@/$BASE}"
PROMPT="${PROMPT//@@DIFF_STAT@@/$DIFF_STAT}"
PROMPT="${PROMPT//@@DIFF_FILE@@/$DIFF_FILE}"
PROMPT="${PROMPT//@@EVIDENCE_RULES@@/$EVIDENCE_RULES}"
PROMPT="${PROMPT//@@SEVERITY_RULES@@/$SEVERITY_RULES}"
printf '%s\n' "$PROMPT" > "$PROMPT_FILE"
cat "$DIFF_FILE" >> "$PROMPT_FILE"

echo "George (Reviewer B, deep-tree) reviewing $BRANCH against $BASE..."
echo "Prompt: $PROMPT_FILE ($(wc -c < "$PROMPT_FILE") bytes)"
TREE_BEFORE="$(snapshot_tree)"

# --prompt-file, not `-p "$(cat ...)"`. The diff is embedded in the prompt, so
# passing it as an argv string blows past ARG_MAX on any real change (a 35-file
# range produced a 135KB prompt and "Argument list too long"). A file has no
# such limit.
grok --prompt-file "$PROMPT_FILE" \
  --allow read_file --allow grep --allow list_dir \
  --cwd "$(pwd)" </dev/null 2>&1 | tee "$REPORT"

assert_tree_unchanged "$TREE_BEFORE"

# Narration-only output means the session stalled or was cancelled. It is not
# an approval, and it must not be read as one.
if ! grep -qiE "APPROVE|REQUEST_CHANGES" "$REPORT"; then
  echo >&2
  echo "FAILED RUN: George produced no verdict — stalled or cancelled, not a pass." >&2
  exit 3
fi

echo
echo "Report: $REPORT"
