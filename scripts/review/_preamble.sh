#!/usr/bin/env bash
# Shared context for both reviewers. Sourced, not executed.
set -euo pipefail

BASE="${1:-main}"
OUT_DIR=".review"
mkdir -p "$OUT_DIR"

if ! git rev-parse --verify "$BASE" >/dev/null 2>&1; then
  echo "No such base ref: $BASE" >&2
  exit 2
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
DIFF_STAT="$(git diff --stat "$BASE"...HEAD | tail -1)"

# Read-only is asserted in the reviewer prompt; these two functions VERIFY it.
#
# Codex's own bubblewrap sandbox cannot create a namespace inside this
# container, so a sandboxed run cannot read the diff at all — it reports "no
# evidence" and assesses nothing. The reviewers therefore run unsandboxed, with
# the container as the isolation boundary. That makes the read-only promise
# something to check rather than something to trust.
snapshot_tree() {
  git rev-parse HEAD
  git status --porcelain
  # Content hashes, not --stat. Frank's own review of this file caught that a
  # stat comparison misses an edit preserving insertion/deletion counts (swap a
  # word on an already-modified line) and misses content changes to untracked
  # files entirely, since porcelain records only their paths.
  git diff HEAD --binary | sha256sum
  git ls-files --others --exclude-standard -z \
    | xargs -0r sha256sum 2>/dev/null \
    | sha256sum
}

assert_tree_unchanged() {
  local before="$1"
  local after
  after="$(snapshot_tree)"
  if [ "$before" != "$after" ]; then
    echo >&2
    echo "REVIEWER MUTATED THE WORKING TREE — this review is void." >&2
    diff <(printf '%s\n' "$before") <(printf '%s\n' "$after") >&2 || true
    return 1
  fi
  echo "Read-only verified: working tree unchanged."
}

REPO_CONTEXT="tc-mobile — an offline-first PWA for oral Bible translation \
(React 19 + Vite + TypeScript strict + Tailwind 4, no backend). \
Onion architecture types -> lib -> hooks -> components -> app, enforced by \
ESLint no-restricted-imports; lib/ must stay free of DOM, Web Audio and \
MediaRecorder so the audio core is unit-testable in Node. Audio is canonical \
mono 16-bit PCM at 44.1kHz; IndexedDB is the system of record, not a cache. \
Risk tiers: T1 lib/audio and lib/storage and the IndexedDB schema (tests \
required, data loss is unrecoverable in the field); T2 hooks and export paths; \
T3 components and app. See AGENTS.md and docs/decisions/."

# House evidence discipline. Applies to BOTH reviewers: a review is a set of
# claims, and an unsupported claim wastes more of the author's time than saying
# nothing would have.
read -r -d '' EVIDENCE_RULES <<'EV_EOF' || true
EVIDENCE DISCIPLINE — this project runs evidence-first, and a review is a set
of claims. Hold yourself to the same standard you are holding the code to.

Axioms:
1. REALITY IS SOVEREIGN. The actual state of the code outranks any claim,
   model, or expectation — including yours. Inspect the artifact before
   asserting behaviour.
2. A CLAIM IS A DEBT. Every finding must carry evidence or a verification path.
   A finding you cannot point at is not a finding.
3. INTEGRITY IS EFFICIENT. False certainty costs the author more work than
   honest uncertainty. A confidently wrong P1 is worse than an admitted unknown.
4. OBSERVATION PRECEDES VERIFICATION. Only direct inspection of the artifact
   counts as verification. Do not infer that a test passes, that a path is
   reachable, or that a call site exists — read it.

Rules:
- Cite the strongest evidence available: the file and line you actually read
  beats a plausible-sounding recollection of how such code usually works.
- Label inference as inference and assumptions as assumptions, explicitly.
- If you cannot obtain the evidence a finding needs, say "I do not have
  evidence for that" and state what would settle it. Do NOT downgrade it to a
  vague nit to avoid saying so.
- NEVER fabricate verification. Do not claim to have run anything. Do not
  describe output you did not see.
- Attach a confidence (high / medium / low) to any finding that rests on
  inference rather than direct observation.
EV_EOF

SEVERITY_RULES="Report findings as a numbered list. Each finding carries a \
severity (P1 must fix before merge / P2 should fix / P3 nit), a file:line, a \
CONCRETE FAILURE SCENARIO (specific inputs or state producing a specific wrong \
outcome), and a minimal fix. If you find nothing at a severity, say so \
explicitly. End with a verdict line: APPROVE or REQUEST_CHANGES."
