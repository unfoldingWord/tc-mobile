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

# #348 round 4 (PR #510 round 3 triage — five prior findings, each fixed at
# its own call site, were all one class: "the gate reads an artifact this run
# did not provably write, for this SHA"). THE ONE RULE generalized:
#   1. Every artifact this run writes is keyed by the head SHA AND a per-run
#      id (RUN_ID below) — never a fixed "frank-$SHA.*" name a later rerun
#      could reuse.
#   2. Every one of those paths is removed/truncated HERE, at entry, before
#      anything else in this script can abort.
# SHA now uses --short=9 (was unqualified --short — git's variable default
# length) to match triage.sh's own SHA length; Frank's round-3 P1 #2 named
# the mismatch as part of the same defect: two scripts computing
# different-length short SHAs for what has to be the same lookup key.
SHA="$(git rev-parse --short=9 HEAD)"
# RUN_ID: a nanosecond epoch timestamp plus this script's own PID, generated
# ONCE, here. Lexically sortable (fixed-width numeric prefix), so triage.sh
# can pick "the latest run for this SHA" with `sort`, never `ls -t` (mtime
# order, which is what let round 3's P1 #2 show one run's report beside a
# DIFFERENT run's verdict). REVIEW_RUN_ID lets a test pin this to an exact,
# predictable value; unset in real use, where it is always freshly
# generated, so two runs can never collide on it by construction.
RUN_ID="${REVIEW_RUN_ID:-$(date +%s%N)-$$}"
REPORT="$OUT_DIR/frank-$SHA-$RUN_ID.md"
DIFF_FILE="$OUT_DIR/diff-$SHA-$RUN_ID.patch"
# The isolated final-message file (#348 round 2) — deliberately NOT matching
# the "frank-$SHA-*.md" glob triage.sh uses to find the latest report, so it
# is never picked up as if it were one.
LAST_MSG="$OUT_DIR/frank-$SHA-$RUN_ID.final-message.txt"

# Rule 2: truncate every path this run will later read as its own output,
# now, before `git diff` or the prompt substitutions below get a chance to
# fail first and exit (via `set -e`) with these paths left at whatever a
# prior run — or, vanishingly unlikely, a colliding RUN_ID — left them in.
# Because RUN_ID is fresh every real run this is normally a no-op; its job is
# defense in depth, and it is what makes "these paths exist and are empty"
# true from this script's very first line onward, for every run it starts,
# including one that dies one line later — round 3's P1 #1 was exactly a gap
# in that guarantee (the clear sat right before the codex invocation, not at
# entry) for the file frank.sh itself writes; round 3's P1 #2 was the same
# gap surfacing at george.sh's second artifact (see george.sh).
: > "$REPORT"
: > "$DIFF_FILE"
: > "$LAST_MSG"

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

# #348 round 4: $LAST_MSG (and $REPORT, $DIFF_FILE) were already truncated at
# entry, above — see the rule-2 comment there. Nothing left to clear here;
# codex writes into paths that are already empty and already keyed to this
# exact run (SHA + RUN_ID), so a stale artifact from any other run — earlier
# or, if one somehow raced, concurrent — cannot be mistaken for this run's.
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
