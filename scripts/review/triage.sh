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
source scripts/review/_verdict.sh

ROUND="${1:?usage: triage.sh <round> [pr-number]}"
PR="${2:-}"
SHA="$(git rev-parse --short=9 HEAD)"
OUT=".review/triage-round${ROUND}-${SHA}.md"
mkdir -p .review

# #348 round 4 (closes Frank's round-3 P1 #2). Before this, both lookups were
# `ls -t .review/frank-*.md` / `george-*.md` (and their *.final-message.txt
# counterparts) — TWO INDEPENDENT globs across every SHA ever reviewed in
# this checkout, sorted by mtime, each picking its own "newest" file. Frank's
# concrete scenario: Frank approves commit A (leaving A's final-message file
# on disk); the branch advances to commit B; Frank's review at B stalls (no
# final-message file for B). Running triage at B picks B's .md report
# (genuinely newest) but the newest final-message file OVERALL is still A's
# — `verdict_token` on A's file finds APPROVE, and triage stamps
# "Frank | APPROVE" under B's SHA, disagreeing with B's own failed run.
#
# Fixed two ways, together:
#   - Every lookup is now scoped to a glob prefix that embeds THIS SHA
#     (frank.sh/george.sh, #348 round 4: filenames are
#     "frank-$SHA-$RUN_ID.md" / ".final-message.txt", RUN_ID a lexically
#     sortable nanosecond-timestamp-plus-pid string) — never a bare
#     "frank-*.md" that spans every SHA ever run.
#   - The verdict file is derived from the SAME run id as the picked
#     report (verdict_file_for below), never chosen independently via its
#     own newest-mtime glob. A newer run that aborted before writing its own
#     final-message file must read as "not run", not silently inherit an
#     older run's leftover approval — Frank's exact scenario above, and the
#     same shape as george.sh's own P1 #1 this round (a run that dies before
#     its completion artifact is (re)written must never be read as a pass).
#   - `sort` (lexical, on the RUN_ID's fixed-width numeric prefix), not
#     `ls -t` (mtime order) — immune to a clock/mtime tie or reorder.
latest_report_for() {
  # $1: glob prefix, e.g. ".review/frank-${SHA}-"
  ls -1 "$1"*.md 2>/dev/null | sort | tail -1 || true
}

verdict_file_for() {
  local report="$1" prefix="$2" run_id f
  [ -n "$report" ] || { echo ""; return; }
  run_id="${report#"$prefix"}"
  run_id="${run_id%.md}"
  f="${prefix}${run_id}.final-message.txt"
  [ -f "$f" ] && echo "$f" || echo ""
}

frank_report="$(latest_report_for ".review/frank-${SHA}-")"
george_report="$(latest_report_for ".review/george-${SHA}-")"
frank_verdict_file="$(verdict_file_for "$frank_report" ".review/frank-${SHA}-")"
george_verdict_file="$(verdict_file_for "$george_report" ".review/george-${SHA}-")"

# Frank numbers findings as "1. **P1 — ...**"; George uses "### 1. ..." under a
# "## P1" heading. Pull whichever shape is present rather than assuming one.
extract() {
  local file="$1" lens="$2"
  # $lens (was $lens_, a typo — #220 item 4, fixed here alongside the verdict
  # anchor because it aborts this exact branch under `set -u` whenever a
  # reviewer's report is missing, the "not run" default this file's Verdicts
  # table below also has to handle). #220's other items (dud
  # quarantine-on-every-failure-path, and the general robustness pass) are
  # NOT fixed here — left for #220.
  [ -f "$file" ] || { echo "- _no report found for $lens"; return; }
  # awk dedupe: codex echoes its final report twice (once streamed, once as the
  # final message), so every Frank finding otherwise appears in duplicate.
  #
  # `|| true` on the grep stage (#348 round 4): frank.sh/george.sh now
  # truncate $REPORT at entry (rule 2), so a run that crashes before writing
  # anything real still "reserves" its run id — the file this function is
  # handed can therefore be genuinely empty, not just missing. A zero-match
  # grep exits 1, and under this script's `set -e` that would abort triage.sh
  # ENTIRELY, not just this one reviewer's section (#220 item 1 named the
  # same landmine for a clean, zero-finding APPROVE report; round 4's own
  # entry-truncation makes the empty-file case common enough that this one
  # narrow guard is in scope here, distinct from #220's broader
  # quarantine-every-failure-path ask, which stays open). The rest of the
  # pipe sees empty input either way and produces no lines, so a
  # crashed/pending run's section is silently empty rather than taking the
  # whole triage run down with it.
  { grep -hoE '^(###[[:space:]]+[0-9]+\.[[:space:]]+.*|[0-9]+\.[[:space:]]+\*\*P[123][^*]*\*\*.*)$' "$file" || true; } \
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
  # #220's "line-anchored verdict" item + #348: verdict_token()
  # (scripts/review/_verdict.sh) matches a standalone verdict LINE, not a bare
  # substring — a report whose only mention of the words is prose (#220's
  # "whether to APPROVE or REQUEST_CHANGES" example) reads as "not run" here,
  # not as a false verdict pulled from that prose. #348 round 3: read from the
  # isolated completion artifact, not the .md report — see the lookup above.
  echo "| Reviewer | Verdict @ \`${SHA}\` |"
  echo "| --- | --- |"
  printf "| Frank  | %s |\n" "$(verdict_token "${frank_verdict_file:-/dev/null}" 2>/dev/null || echo 'not run')"
  printf "| George | %s |\n" "$(verdict_token "${george_verdict_file:-/dev/null}" 2>/dev/null || echo 'not run')"
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
