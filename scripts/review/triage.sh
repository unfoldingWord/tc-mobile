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
    if [ "$verdict" = "REQUEST_CHANGES" ]; then
      echo "- [ ] **${lens}** — ⚠️ **NO FINDINGS EXTRACTED, but the verdict is \`REQUEST_CHANGES\`.** The report format has probably drifted out from under this parser. Read \`$file\` by hand and fill this section in before posting."
    else
      echo "- _${lens} reported no findings at this SHA (verdict: ${verdict:-unknown})._"
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
