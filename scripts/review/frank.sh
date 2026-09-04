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

SHA="$(git rev-parse --short HEAD)"
REPORT="$OUT_DIR/frank-$SHA.md"
VERDICT_FILE="$OUT_DIR/frank-verdict-$SHA.txt"
DIFF_FILE="$OUT_DIR/diff-$SHA.patch"
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
# The named fields are injected here by literal string replacement, which does
# not re-evaluate the value it inserts either.
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

# `-o` writes ONLY the agent's final message to VERDICT_FILE; the tee keeps the
# full streamed transcript in REPORT for a human. The verdict is judged from
# VERDICT_FILE, never the transcript: the streamed transcript echoes the prompt
# and the diff, so a substring match there finds APPROVE/REQUEST_CHANGES in the
# instructions (or, when this script is itself under review, in its own source)
# even when the run stalled and assessed nothing.
rm -f "$VERDICT_FILE"
codex exec -c sandbox_mode="danger-full-access" --skip-git-repo-check \
  -o "$VERDICT_FILE" \
  "$PROMPT" </dev/null 2>&1 | tee "$REPORT"

# A dud run's files are moved aside (.dud) so triage, which keys on this SHA,
# reads "not run" instead of triaging a stalled report under the current head.
quarantine_dud() {
  mv -f "$VERDICT_FILE" "$VERDICT_FILE.dud" 2>/dev/null || true
  mv -f "$REPORT" "$REPORT.dud" 2>/dev/null || true
}

# A reviewer that mutated the working tree voids the review — quarantine its
# report too, so the void run is not ingested by SHA-keyed triage as real
# signal. The bare assert returns 1 under set -e and would otherwise exit here
# with the report left in place.
if ! assert_tree_unchanged "$TREE_BEFORE"; then
  quarantine_dud
  exit 1
fi

# A sandbox failure produces a plausible-looking REQUEST_CHANGES with nothing
# assessed. That is a failed run, not a review — fail loudly rather than let it
# be mistaken for signal. Anchored, case-sensitive, over the final message only.
if [ ! -s "$VERDICT_FILE" ] \
  || ! grep -qE '\b(APPROVE|REQUEST_CHANGES)\b' "$VERDICT_FILE"; then
  echo >&2
  echo "FAILED RUN: Frank produced no verdict — stalled or cancelled." >&2
  quarantine_dud
  exit 3
fi
# "P1: Not assessed" is the dud signature; a real review says "No P1 findings".
if grep -qiE "^\**P1\**:?[[:space:]]*\**Not assessed" "$VERDICT_FILE"; then
  echo >&2
  echo "FAILED RUN: Frank assessed nothing. This is not a review." >&2
  quarantine_dud
  exit 3
fi

echo
echo "Report: $REPORT"
