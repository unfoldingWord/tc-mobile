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
source scripts/review/_verdict.sh

# #348 round 4 (PR #510 round 3 triage — five prior findings, each fixed at
# its own call site, were all one class: "the gate reads an artifact this run
# did not provably write, for this SHA"). THE ONE RULE generalized:
#   1. Every artifact this run writes is keyed by the head SHA AND a per-run
#      id (RUN_ID below) — never a fixed "george-$SHA.*" name a later rerun
#      could reuse.
#   2. Every one of those paths is removed/truncated HERE, at entry, before
#      anything else in this script can abort.
# SHA now uses --short=9 (was unqualified --short — git's variable default
# length) to match triage.sh's own SHA length; Frank's round-3 P1 #2 named
# the mismatch as part of the same defect.
SHA="$(git rev-parse --short=9 HEAD)"
# RUN_ID: a nanosecond epoch timestamp plus this script's own PID, generated
# ONCE, here. Lexically sortable, so triage.sh can pick "the latest run for
# this SHA" with `sort`, never `ls -t` (mtime order). REVIEW_RUN_ID lets a
# test pin this to an exact, predictable value; unset in real use.
RUN_ID="${REVIEW_RUN_ID:-$(date +%s%N)-$$}"
REPORT="$OUT_DIR/george-$SHA-$RUN_ID.md"
DIFF_FILE="$OUT_DIR/diff-$SHA-$RUN_ID.patch"
PROMPT_FILE="$OUT_DIR/george-prompt-$SHA-$RUN_ID.txt"
# The completion artifact (#348 round 3) — grok's own `--output-format json`
# object, George's equivalent of Frank's -o/--output-last-message file. Never
# matches the "george-$SHA-*.md" glob triage.sh uses to find the latest
# report, so it is never picked up as if it were one.
JSON_OUT="$OUT_DIR/george-$SHA-$RUN_ID.completion.json"
# The model's own final answer, extracted from JSON_OUT's "text" field —
# what verdict_token() below reads, and ONLY what it reads. Same non-".md"
# naming reasoning as JSON_OUT.
FINAL_MSG="$OUT_DIR/george-$SHA-$RUN_ID.final-message.txt"
# grok's stderr for this run — diagnostic only (whatever logging or
# tool-call chatter it writes there), archived in $REPORT for a human to read
# on a failed run, but NEVER consulted for a verdict. See the invocation
# below for why that separation matters.
STDERR_LOG="$OUT_DIR/george-$SHA-$RUN_ID.stderr.log"

# Rule 2 (#348 round 4 — closes Frank's round-3 P1 #1): every path this run
# will later read as its own output is truncated HERE, before `git diff` or
# the prompt substitutions below get a chance to fail first and exit (via
# `set -e`) with these paths untouched. Round 3 cleared only $JSON_OUT, and
# only right before the grok invocation — Frank's exact scenario: George is
# rerun at the same SHA and is killed WHILE grok is running, before the
# node -e extraction step further down is ever reached; $FINAL_MSG (what
# verdict_token() actually reads) was never touched, so a PRIOR run's stale
# "Verdict: APPROVE" survived and a later triage.sh read it as this run's
# own. Every artifact is now keyed by SHA+RUN_ID (so a stale file can only
# ever be a genuinely different run's, never this one's own path reused) AND
# truncated at entry (defense in depth against a RUN_ID collision, and what
# makes "these paths exist and are empty" true from this script's first line
# onward, for every run it starts — including one grok kills a moment later).
: > "$REPORT"
: > "$DIFF_FILE"
: > "$PROMPT_FILE"
: > "$JSON_OUT"
: > "$FINAL_MSG"
: > "$STDERR_LOG"

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

# #348 round 3 (Frank at 0fa4d99, P1 #2): the old VERDICT_TAIL_LINES tail
# window on George's live-streamed transcript was a distance-based heuristic,
# not a completion-based guarantee — a draft verdict fewer lines from a stall
# than the window's size would still read as a clean pass (scripts/review/
# _verdict.sh has the full history). THE ONE RULE now: a verdict is read only
# from a completion artifact this run wrote, cleared before the tool starts —
# never from a window inside a live stream.
#
# `--output-format json` is grok's equivalent of Frank's
# -o/--output-last-message: confirmed directly (round 2, and again round 3
# via a live smoke call — `grok -p "..." --output-format json`) that it
# prints exactly one JSON object, once, at genuine completion, whose own
# "text" field is the model's final answer. Labeled assumption: that smoke
# call was a trivial, tool-free `-p` prompt, not a full --prompt-file run
# with --allow read_file/grep/list_dir under tool use — a real deep-tree run
# was out of scope for this round's smoke, so the json-format contract is
# confirmed for the flag itself but not yet observed end-to-end through this
# exact invocation shape.
#
# #348 round 4: $JSON_OUT and $FINAL_MSG (and $REPORT, $DIFF_FILE,
# $PROMPT_FILE, $STDERR_LOG) were already truncated at entry, above — see the
# rule-2 comment there. Nothing left to clear here; grok writes into paths
# that are already empty and already keyed to this exact run (SHA + RUN_ID).
# If grok is killed or crashes anywhere in the next few lines — including
# between this invocation and the node -e extraction step below, exactly
# Frank's round-3 P1 #1 scenario — $FINAL_MSG stays exactly what it already
# is here: empty, not a leftover approval from any other run.
#
# Losing today's live-streamed stdout costs nothing: per the coordinator
# (2026-09-19), the George runners that watch for a stall already watch
# ~/.grok/logs/unified.jsonl for a quiet PID, not stdout — grok goes quiet on
# stdout for 5-10 minutes at a time between tool loops regardless, so no
# liveness signal this harness actually depends on is lost here. stderr is
# still captured, to $STDERR_LOG, for a human to read on a failed run — but,
# per THE ONE RULE, never for a verdict (see the extraction step below).
grok --prompt-file "$PROMPT_FILE" --output-format json \
  --allow read_file --allow grep --allow list_dir \
  --cwd "$(pwd)" </dev/null >"$JSON_OUT" 2>"$STDERR_LOG"

assert_tree_unchanged "$TREE_BEFORE"

# Extract the model's own final answer from $JSON_OUT's "text" field — the
# ONLY thing verdict_token() below is allowed to read. node -e, not jq: this
# script did not already depend on jq before this fix. A missing/unreadable
# file, invalid/truncated JSON, and a missing or non-string "text" field all
# fail the exact same way — nothing is written to $FINAL_MSG, so it is either
# absent or empty, and the check below reads that as "no verdict" rather than
# falling back to anything else this run produced (the raw JSON, $STDERR_LOG,
# the prompt file) — the same fail-closed contract as Frank's missing -o file.
node -e '
  const fs = require("fs");
  let raw;
  try {
    raw = fs.readFileSync(process.argv[1], "utf8");
  } catch {
    process.exit(1);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    process.exit(1);
  }
  if (typeof data.text !== "string" || data.text.trim().length === 0) {
    process.exit(1);
  }
  process.stdout.write(data.text);
' "$JSON_OUT" > "$FINAL_MSG" || : > "$FINAL_MSG"

# $REPORT is the human-readable artifact triage.sh's extract() parses for
# P1/P2/P3 findings, and what a person reads on a failed run — it is allowed
# to carry more than the isolated final answer (the stderr section below), on
# purpose, as a diagnostic aid. verdict_token() is NEVER pointed at $REPORT
# for that exact reason: stderr can carry incidental verdict-shaped noise
# (grok's own logging, a tool-call echo) that is not the model's real final
# answer, and reading it from here instead of $FINAL_MSG would reopen the
# same false-PASS shape this fix closes.
{
  if [ -s "$FINAL_MSG" ]; then
    cat "$FINAL_MSG"
  else
    echo "(no final message extracted from $JSON_OUT — see raw JSON and stderr below)"
    echo
    echo "## Raw completion JSON"
    echo
    cat "$JSON_OUT" 2>/dev/null || echo "(missing)"
  fi
  if [ -s "$STDERR_LOG" ]; then
    echo
    echo "---"
    echo "## Raw stderr (diagnostic only — grok's own logging/tool-call"
    echo "## chatter, NOT part of the reviewed answer; never read for a"
    echo "## verdict, #348 round 3)"
    echo
    cat "$STDERR_LOG"
  fi
} > "$REPORT"

# Narration-only or absent output means the session stalled or was cancelled.
# It is not an approval, and it must not be read as one. verdict_token()
# (scripts/review/_verdict.sh) anchors to a standalone verdict LINE, not a
# substring match — #220's prose shape ("whether to APPROVE or
# REQUEST_CHANGES") cannot satisfy it — and, per THE ONE RULE above, it is
# handed ONLY $FINAL_MSG, never $REPORT or $STDERR_LOG.
if ! verdict_token "$FINAL_MSG" >/dev/null; then
  echo >&2
  echo "FAILED RUN: George produced no verdict — stalled or cancelled, not a pass." >&2
  exit 3
fi

echo
echo "Report: $REPORT"
