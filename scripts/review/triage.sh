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
SHA="$(git rev-parse --short=9 HEAD)"
OUT=".review/triage-round${ROUND}-${SHA}.md"
mkdir -p .review

frank_report="$(ls -t .review/frank-*.md 2>/dev/null | head -1 || true)"
george_report="$(ls -t .review/george-*.md 2>/dev/null | head -1 || true)"

# Frank numbers findings as "1. **P1 — ...**"; George uses "### 1. ..." under a
# "## P1" heading. Pull whichever shape is present rather than assuming one.
# On what USED to live here.
#
# Three review rounds were spent trying to decide, from a report's text,
# whether a reviewer found nothing. Each fix was defeated by a new way for
# arbitrary transcript text to look like the reviewer's conclusion: an
# unanchored substring (Frank R2 / George R2), then an unindented fenced
# example (Frank R3), then a column-0 file dump (George R3). George R3 named
# them for what they are — "transcript-embed siblings" — and AGENTS.md is
# explicit that siblings mean the fix approach is wrong, not that one more
# round will land it.
#
# The approach was wrong because the premise was: a reviewer report embeds
# the reviewer PROMPT and the DIFF UNDER REVIEW, so any phrase this script
# looks for can be quoted into it by the very change being reviewed. There is
# no pattern that survives that, because the adversary is the report's own
# subject matter.
#
# What kept the detector alive was an assumption that removing it would put a
# warning on a third of all rounds. Measured across the 38 reports in
# `.review/`: 28 extract findings normally, 13 extract empty and already
# warn, and the all-clear branch fires for exactly ONE. It was worth a single
# avoided checkbox in 38 rounds, against a defect class that cost three
# rounds and four findings.
#
# So nothing here infers cleanliness any more. An empty extraction always
# produces an unchecked line that a human has to resolve. That is also the
# honest statement: the script does not know, and no longer pretends to.

# Pull one reviewer's findings out of their report.
#
# #524: `grep` exits 1 when it matches NOTHING, and this script runs under
# `set -euo pipefail` (above). An unguarded `grep | sed | ...` pipeline here
# therefore KILLS the script mid-`{ ... } > "$OUT"` block the moment a
# reviewer has no findings — truncating the triage at this reviewer's heading
# and silently dropping everything after it, including the OTHER reviewer's
# findings and the whole verdicts table. Because `extract` is called for Frank
# first, a clean Frank erased George entirely; the file left behind was a
# plausible-looking ~200 bytes with no marker that anything was missing.
#
# So the grep is run on its own, its failure absorbed, and the empty case
# handled explicitly. The two empty cases are NOT rendered the same way: a
# reviewer who genuinely found nothing is normal, while an extraction that
# came up empty against a REQUEST_CHANGES verdict means the report format has
# drifted out from under this parser, and that must be loud.
extract() {
  local file="$1" lens="$2" raw verdict
  [ -f "$file" ] || { echo "- _no report found for ${lens}_"; return; }

  raw="$(grep -hoE '^(###[[:space:]]+[0-9]+\.[[:space:]]+.*|[0-9]+\.[[:space:]]+\*\*P[123][^*]*\*\*.*)$' "$file" || true)"
  verdict="$(grep -hoE 'APPROVE|REQUEST_CHANGES' "$file" | tail -1 || true)"

  if [ -z "$raw" ]; then
    # Nothing extracted. Neither arm reports that as a clean review — see the
    # note above this function for why nothing here infers cleanliness at all.
    # The two arms differ only in loudness: an empty extraction against a
    # BLOCKING verdict is a flat contradiction ("found nothing" and "blocks
    # merge" cannot both be true, and when they disagree it is the parser that
    # is wrong), so it shouts. Anything else asks for confirmation.
    if [ "$verdict" = "REQUEST_CHANGES" ]; then
      echo "- [ ] **${lens}** — ⚠️ **NOTHING EXTRACTED, and the verdict is \`REQUEST_CHANGES\`.** The report blocks merge but this parser found no findings in it, so the format has drifted. Read \`$file\` by hand and fill this section in before posting."
    else
      echo "- [ ] **${lens}** — ⚠️ **Nothing extracted** (verdict: ${verdict:-unknown}). This is NOT evidence of a clean report — an unrecognised finding format extracts as empty too. Read \`$file\` by hand and either list its findings here or write the all-clear yourself."
    fi
    return
  fi

  # awk dedupe: codex echoes its final report twice (once streamed, once as the
  # final message), so every Frank finding otherwise appears in duplicate.
  printf '%s\n' "$raw" \
    | sed -E 's/^###[[:space:]]+//; s/^\*\*//; s/\*\*$//; s/[[:space:]]+$//' \
    | awk '!seen[$0]++' \
    | sed -E "s|^|- [ ] **${lens}** — |" \
    | sed -E 's/$/\n      - disposition: FIXED <commit> | REFUTED <file:line + why> | DEFERRED #<issue>/'
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
  printf "| Frank  | %s |\n" "$(grep -hoE 'APPROVE|REQUEST_CHANGES' "${frank_report:-/dev/null}" 2>/dev/null | tail -1 || echo 'not run')"
  printf "| George | %s |\n" "$(grep -hoE 'APPROVE|REQUEST_CHANGES' "${george_report:-/dev/null}" 2>/dev/null | tail -1 || echo 'not run')"
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
