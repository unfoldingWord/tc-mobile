#!/usr/bin/env bash
# Reviewer A — Frank (Codex). Diff-local lens, principal-engineer register.
#
# Invocation proven on bt-servant-admin-portal across 13 review rounds
# (PRs #267/#268/#271, #302). Two hard-won details:
#
#   1. `-c sandbox_mode="danger-full-access"` is REQUIRED. Codex's bubblewrap
#      sandbox cannot create a namespace in this container (no unprivileged
#      userns), and a sandboxed run cannot read the diff at all — it returns a
#      "could not inspect" non-review that reads like a clean pass if you only
#      skim the verdict. Treat any such phrasing as a FAILED run, never as
#      approval. The container is the isolation boundary; the tree is verified
#      unchanged after the run.
#   2. `codex exec review --base` and a custom PROMPT are mutually exclusive.
#      Using `--base` would silently discard the persona and the lens and run
#      Codex's generic review, so Frank goes through plain `codex exec` with
#      the diff written to disk.
#
# Codex reviews the COMMITTED diff, so uncommitted edits do not affect it.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
source scripts/review/_preamble.sh "${1:-origin/develop}"
source scripts/review/_verdict.sh

SHA="$(git rev-parse --short HEAD)"
REPORT="$OUT_DIR/frank-$SHA.md"
DIFF_FILE="$OUT_DIR/diff-$SHA.patch"
# The isolated final-message file (#348 round 2) — deliberately NOT matching
# the "frank-*.md" glob triage.sh's `ls -t .review/frank-*.md` uses to find
# the latest report, so it is never picked up as if it were one.
LAST_MSG="$OUT_DIR/frank-$SHA.final-message.txt"
git diff "$BASE"...HEAD > "$DIFF_FILE"

read -r -d '' PROMPT_TEMPLATE <<'PROMPT_EOF' || true
You are **Frank**, a senior/principal engineer with a methodical, analytical,
no-nonsense review style. You are the grounding rod — the one who connects
vision to architecture to execution.

You operate with clarity, directness, realistic constraints, respect for the
broader vision, a preference for deterministic thinking, and a slight dry wit
when it helps. No drama, no ego, no fluff. Just clean engineering thinking.

How you think:
- Identify the core claim or problem first, then decompose it into 2-5 key
  points and walk the reasoning step by step. "Here is the situation, here is
  what is true, here is what to do."
- Avoid assumptions unless you label them as assumptions. Insist on constraints
  where they matter. Raise risks early, not late.
- Prefer validated patterns over clever hacks, simplicity over abstraction,
  predictable systems over fragile ones.
- When an idea is good, say so. When it is flawed, say so plainly but not
  unkindly.

You evaluate correctness, readability, API boundaries, security implications,
performance characteristics, data-modelling impact, and future maintainability.
You avoid nitpicking stylistic micro-details, and you do not propose full
rewrites unless asked. Always actionable — never leave a finding at
"it depends". Give the recommendation.

---

REVIEW ASSIGNMENT — you are Reviewer A in a dual-review pipeline for
@@REPO_CONTEXT@@

Your lens is DIFF-LOCAL: correctness of the changed code ITSELF. Logic errors,
off-by-one and boundary bugs, unhandled failure paths, async/await mistakes,
resource leaks, type-level lies, and tests that assert the wrong thing or would
pass while the code is broken. Reviewer B (George) covers the deep-tree lens —
interaction with unchanged code — so do not spend your effort there.

Pay particular attention to this repository's own rules, because breaking them
is a defect here even where it would be style elsewhere:
- lib/ must contain no DOM, Web Audio or MediaRecorder reference.
- Anything touching lib/audio or lib/storage is T1 and requires tests.
- An IndexedDB schema change requires an append-only migration.
- No silently swallowed errors; an empty catch must say why it is empty.

Rules of engagement:
- READ-ONLY. Do not modify, create or delete any file. Do not commit. Do not
  run the test suite or the build. The working tree is checked after this run
  and any mutation voids the review.
- The full diff under review is at @@DIFF_FILE@@ — read it first.
- Your FINAL message must be the complete report, not narration about it.

Branch under review: @@BRANCH@@ (against @@BASE@@) — @@DIFF_STAT@@

@@EVIDENCE_RULES@@

@@SEVERITY_RULES@@
PROMPT_EOF

# The delimiter above is QUOTED ('PROMPT_EOF'), so the persona is captured
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
PROMPT="${PROMPT//@@DIFF_FILE@@/$DIFF_FILE}"
PROMPT="${PROMPT//@@BRANCH@@/$BRANCH}"
PROMPT="${PROMPT//@@BASE@@/$BASE}"
PROMPT="${PROMPT//@@DIFF_STAT@@/$DIFF_STAT}"
PROMPT="${PROMPT//@@EVIDENCE_RULES@@/$EVIDENCE_RULES}"
PROMPT="${PROMPT//@@SEVERITY_RULES@@/$SEVERITY_RULES}"

echo "Frank (Reviewer A, diff-local) reviewing $BRANCH against $BASE..."
TREE_BEFORE="$(snapshot_tree)"

codex exec -c sandbox_mode="danger-full-access" --skip-git-repo-check \
  -o "$LAST_MSG" \
  "$PROMPT" </dev/null 2>&1 | tee "$REPORT"

assert_tree_unchanged "$TREE_BEFORE"

# A sandbox failure produces a plausible-looking REQUEST_CHANGES with nothing
# assessed. That is a failed run, not a review — fail loudly rather than let it
# be mistaken for signal.
#
# Detect it by the model's own FINAL message, never by scanning the streamed
# transcript for error strings or verdict-shaped lines: the transcript echoes
# the diff (and the prompt), and when this script is itself under review a
# substring match finds its own source — #348 round 1: the prompt's own
# "End with a verdict line: APPROVE or REQUEST_CHANGES." instruction, echoed
# back by Codex, used to satisfy a bare grep with nothing ever reviewed.
# #348 round 2 (Frank at c7b46e3, P1): even a transcript-wide anchored-LINE
# search is not enough — the LAST anchored line anywhere in a long transcript
# can be a premature draft verdict the model wrote before continuing to
# investigate, if the run then stalls or dies before a genuine final answer.
# `-o "$LAST_MSG"` above makes Codex write ONLY its actual last message to a
# file of its own (`codex exec --help`: "Specifies file where the last
# message from the agent should be written"); verdict_token()
# (scripts/review/_verdict.sh) now reads THAT file, not the transcript. A run
# that stalls before a real final message should never populate it, so a
# missing or empty $LAST_MSG reads as "no verdict" rather than falling back to
# whatever the transcript happens to contain. ("P1: Not assessed" is the dud
# signature checked separately below, against the full transcript on purpose
# — that phrase does not appear in this script's own prompt, so it carries
# none of the #348 self-match risk; a real review says "No P1 findings".)
if ! verdict_token "$LAST_MSG" >/dev/null; then
  echo >&2
  echo "FAILED RUN: Frank produced no verdict — stalled or cancelled." >&2
  exit 3
fi
if grep -qiE "^\**P1\**:?[[:space:]]*\**Not assessed" "$REPORT"; then
  echo >&2
  echo "FAILED RUN: Frank assessed nothing. This is not a review." >&2
  exit 3
fi

echo
echo "Report: $REPORT"
