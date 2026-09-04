#!/usr/bin/env bash
# Build (and optionally post) the per-round triage comment.
#
#   scripts/review/triage.sh <round> [pr-number]
#
# The triage comment is the audit trail. A finding that was "addressed" with
# nothing posted is not verifiable later, so every finding from every reviewer
# gets an explicit disposition — fixed / refuted / deferred — attributed to the
# lens that raised it, against a named head SHA.
#
# Dual sign-off is defined against the CURRENT head: any push after a clean
# statement invalidates BOTH reviewers until each re-posts.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

ROUND="${1:?usage: triage.sh <round> [pr-number]}"
PR="${2:-}"
# Match the short SHA that frank.sh / george.sh use for their report filenames
# (`git rev-parse --short`), so triage keys on the CURRENT head instead of
# picking the newest report by mtime. A failed or stale run leaves a report
# behind; keyed on the SHA, a report for a different head simply reads "not run"
# here rather than being triaged under this SHA.
SHA="$(git rev-parse --short HEAD)"
OUT=".review/triage-round${ROUND}-${SHA}.md"
mkdir -p .review

# Frank's findings and verdict come from the `-o` last-message file, not the
# streamed transcript (which echoes the prompt and the diff). George's report is
# his response text. Both are keyed on this SHA.
frank_report=".review/frank-verdict-$SHA.txt"
george_report=".review/george-$SHA.md"

# Frank numbers findings as "1. **P1 — ...**"; George uses "### 1. ..." under a
# "## P1" heading. Pull whichever shape is present rather than assuming one.
extract() {
  local file="$1" lens="$2"
  [ -f "$file" ] || { echo "- _no report found for $lens_"; return; }
  # awk dedupe: codex echoes its final report twice (once streamed, once as the
  # final message), so every Frank finding otherwise appears in duplicate.
  grep -hoE '^(###[[:space:]]+[0-9]+\.[[:space:]]+.*|[0-9]+\.[[:space:]]+\*\*P[123][^*]*\*\*.*)$' "$file" \
    | sed -E 's/^###[[:space:]]+//; s/^\*\*//; s/\*\*$//; s/[[:space:]]+$//' \
    | awk '!seen[$0]++' \
    | sed -E "s|^|- [ ] **${lens}** — |" \
    | sed -E 's/$/\n      - disposition: FIXED <commit> | REFUTED <file:line + why> | DEFERRED #<issue>/'
}

# The verdict cell must branch on whether a verdict was actually found. A bare
# `grep ... | tail -1 || echo 'not run'` never fires the fallback: the pipeline
# exits on tail (status 0), so a missing verdict prints an empty cell, not "not
# run". Anchored and case-sensitive, to match the reviewer scripts.
verdict() {
  local file="$1" v
  [ -f "$file" ] || { echo "not run"; return; }
  v="$(grep -hoE '\b(APPROVE|REQUEST_CHANGES)\b' "$file" | tail -1)"
  if [ -n "$v" ]; then echo "$v"; else echo "not run"; fi
}

{
  echo "## Review round ${ROUND} — triage @ \`${SHA}\`"
  echo
  echo "Both reviewers ran against \`${SHA}\`. Every finding below carries a"
  echo "disposition; none is silently fixed or silently ignored."
  echo
  echo "### Reviewer A — Frank (codex, diff-local)"
  echo
  extract "$frank_report" "Frank"
  echo
  echo "### Reviewer B — George (grok, deep-tree)"
  echo
  extract "$george_report" "George"
  echo
  echo "### Convergences"
  echo
  echo "_Findings both lenses raised independently — historically the highest-confidence class. List them here._"
  echo
  echo "### Verdicts"
  echo
  echo "| Reviewer | Verdict @ \`${SHA}\` |"
  echo "| --- | --- |"
  printf "| Frank  | %s |\n" "$(verdict "$frank_report")"
  printf "| George | %s |\n" "$(verdict "$george_report")"
  echo
  echo "> A round is clean only when **both** reviewers post a clean statement"
  echo "> naming this SHA. Hitting the round cap with findings open is an"
  echo "> **escalation, not an approval** — it blocks merge until the residual"
  echo "> findings are explicitly accepted."
} > "$OUT"

echo "Triage skeleton: $OUT"
echo
echo "Fill in every disposition, then post it:"
echo "  gh pr comment <pr> --body-file $OUT      # or"
echo "  gh issue comment <issue> --body-file $OUT"

if [ -n "$PR" ]; then
  echo
  read -r -p "Post to PR #$PR now? Dispositions filled in? [y/N] " reply
  case "$reply" in
    [yY]) gh pr comment "$PR" --body-file "$OUT" && echo "Posted to PR #$PR." ;;
    *) echo "Not posted." ;;
  esac
fi
