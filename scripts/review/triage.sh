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
# Does this report explicitly say "nothing" at EVERY severity?
#
# Only an affirmative all-clear may be rendered as "reported no findings".
# An empty extraction on its own proves nothing: Frank R1 and George R1 on
# #547 independently made the same point, and the tree agrees with them —
# 13 of the 38 reports in `.review/` extract zero findings under the regex
# below, and FIVE of those carry a REQUEST_CHANGES verdict. `george-38dbd60.md`
# is the clearest: real P1/P2/P3 findings written as `### P2` severity
# headings rather than `### 1. P2 — …`, so the parser sees none of them.
# dual-review.md is explicit that low-severity findings are "deferred to an
# issue, not dropped", and an APPROVE round carrying only P3s is legitimate —
# so "empty + APPROVE" must never be reported as clean.
#
# Only Frank's spelling is recognised, deliberately. He ends a clean review
# with an explicit line per severity. George has no stable clean shape in this
# tree — `### P1 — none`, `### P1` + `None.`, `### P2 — None that this diff
# newly introduces.`, and reports with no severity headings at all all appear —
# so there is nothing here to match reliably, and guessing would recreate the
# false-clean this function exists to prevent. A clean George round therefore
# gets an unchecked "confirm by hand" line instead. That is the honest answer:
# the script cannot tell, and says so.
explicit_all_clear() {
  local f="$1"
  grep -qiE 'No P1 findings' "$f" \
    && grep -qiE 'No P2 findings' "$f" \
    && grep -qiE 'No P3 findings' "$f"
}

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
    if explicit_all_clear "$file"; then
      echo "- _${lens} reported no findings at this SHA — explicit all-clear at P1, P2 and P3 (verdict: ${verdict:-unknown})._"
    elif [ "$verdict" = "REQUEST_CHANGES" ]; then
      echo "- [ ] **${lens}** — ⚠️ **NOTHING EXTRACTED, and the verdict is \`REQUEST_CHANGES\`.** The report blocks merge but this parser found no findings in it, so the format has drifted. Read \`$file\` by hand and fill this section in before posting."
    else
      echo "- [ ] **${lens}** — ⚠️ **Nothing extracted, and no explicit all-clear** (verdict: ${verdict:-unknown}). An unrecognised finding format extracts as empty too, so this is NOT evidence of a clean report. Read \`$file\` by hand and either list its findings or replace this line with the all-clear."
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
