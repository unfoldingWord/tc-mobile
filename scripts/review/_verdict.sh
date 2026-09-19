#!/usr/bin/env bash
# Shared verdict-line detection for the review harness (frank.sh, george.sh,
# triage.sh). Sourced, not executed.
#
# #348: `grep -qE "APPROVE|REQUEST_CHANGES"` — a bare substring match
# anywhere in the report — matches the reviewer prompt's OWN instruction line
# ("End with a verdict line: APPROVE or REQUEST_CHANGES."), because Codex's
# transcript echoes the prompt back (confirmed directly:
# frank-500-b3484d6.md:93 has that exact sentence). A stalled run that
# produced no real review then reads as a clean pass — a false PASS, the
# dangerous direction. #220 names the same shape for prose ("whether to
# APPROVE or REQUEST_CHANGES") and for triage.sh's own extraction.
#
# The fix: a verdict counts only when it is a LINE of the model's own answer,
# not a substring anywhere in the transcript. Anchor to a line that IS the
# verdict and nothing else — optional markdown bold, an optional "Verdict:"
# label (itself optionally bold), the token, optional trailing bold, only
# whitespace after it. Shapes actually observed across archived reports
# (frank-500-b3484d6.md; george-500-r2-b3484d6.md; george-492-r1/r3/r4;
# george-498-r1; george-499-r1/r2/r3/r4; george-457-r2/r3/r4/r5) all match:
#   Verdict: APPROVE
#   **Verdict:** REQUEST_CHANGES
#   **Verdict: REQUEST_CHANGES**
#   **REQUEST_CHANGES**
#   REQUEST_CHANGES
# #220 suggested a strict bare-token anchor
# (`^(APPROVE|REQUEST_CHANGES)[[:space:]]*$`) and asked to "first confirm the
# reviewers actually emit a bare verdict line... decide the exact form" — the
# archived evidence above shows George routinely wraps the token in markdown
# bold and/or a "Verdict:" label, so a strict bare-token anchor would reject
# most of George's real output. This anchor is the deliberately wider "whole
# trimmed line is a verdict marker" form instead, matched case-insensitively
# (token case has not been observed to vary, but neither script's own
# case-sensitivity before this consistently mattered).
#
# The instruction sentence above never starts a line with either form and
# never ends one right after the token, so it cannot match this anchor —
# that is the entire fix.
#
# Scoped to #220's "line-anchored verdict" item only. The other three items
# in #220 (triage.sh pipefail-safety on a no-match grep inside extract(),
# dud quarantine on all failure paths, and the general robustness pass) are
# untouched here — tracked on #220, not #348.
VERDICT_LINE_RE='^[[:space:]]*\*{0,2}(Verdict:?[[:space:]]*\*{0,2}[[:space:]]*)?(APPROVE|REQUEST_CHANGES)\*{0,2}[[:space:]]*$'

# Prints the LAST anchored verdict token in FILE (case preserved from the
# file), or prints nothing and returns 1 when FILE is missing or has no
# anchored verdict line — including a transcript that only echoes the
# instruction asking for one.
verdict_token() {
  local file="$1" token
  [ -f "$file" ] || return 1
  token="$(grep -iE "$VERDICT_LINE_RE" "$file" 2>/dev/null \
    | grep -ioE 'APPROVE|REQUEST_CHANGES' | tail -1)"
  [ -n "$token" ] || return 1
  printf '%s\n' "$token"
}
