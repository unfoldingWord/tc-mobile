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

# ---------------------------------------------------------------------------
# #348 round 2 (Frank at c7b46e3, P1 — overruling round 1's REFUTE):
# verdict_token() took the LAST anchored verdict line found ANYWHERE in the
# file, not the model's actual final answer. Round 1 refuted this because
# none of 28 archived reports showed the failure shape — but absence in 28
# samples does not show the shape cannot occur, and it is exactly what #348
# exists to close: a model that writes a premature/draft "Verdict: APPROVE"
# line, keeps investigating, and then the run stalls or dies before it
# produces a real final answer. The one (only) anchored line in that
# transcript is the draft, so the old whole-file search reported it as a
# clean pass.
#
# The fix has two parts, one per reviewer, because the two CLIs expose
# different guarantees:
#
# Frank (codex): `codex exec -o/--output-last-message <FILE>` (confirmed via
# `codex exec --help`) writes ONLY the agent's last message — not the
# streamed transcript — to a file of its own. frank.sh now passes this file
# to verdict_token() instead of the tee'd transcript
# (scripts/review/frank.sh). A run that stalls before producing a genuine
# final message should, per that flag's own contract, never populate the
# file at all — so a missing/empty last-message file is read as "no
# verdict", not scanned for a stray earlier line.
# Labeled assumption: this rests on codex's documented flag contract
# ("specifies file where the last message from the agent should be
# written"), not on an observed real stall — inducing a genuine stall
# against the live API was out of scope here. Simulated directly in
# tests/review-verdict.test.ts's frank.sh entry-path tests instead (a stub
# that never writes the -o file).
#
# George (grok): no equivalent isolated final-message file exists — `grok
# --output-format json` gives one (probed directly, prints one JSON object
# with the model's own final "text" once the run truly ends), but only at
# the very end of the run, with none of today's live streaming to stdout.
# Losing that live view breaks the stall-watching workflow this harness is
# operated under (watching stdout / ~/.grok/logs for a quiet PID is how a
# stall is currently caught at all), so george.sh keeps the tee'd streaming
# transcript. Instead, verdict_token() bounds ITS search to the TAIL of
# whatever file it is given — VERDICT_TAIL_LINES non-blank lines, counted
# from the end. A draft verdict followed by real further investigation runs
# to many more lines than that in every archived report read here (new P1/
# P2/P3 sections, evidence tables); a real final verdict does not — even
# though George's own reports are NOT guaranteed to end on the verdict line
# itself. Confirmed directly: george-492-r1-c21a6aa.md:128-132 and
# george-457-r5-25ea428.md:77-81 (both in
# /workspace/temp/tc-mobile-review/) put one trailing wrap-up sentence AFTER
# the verdict line, which is why this is a tail WINDOW, not a
# last-non-blank-line-only rule (that stricter rule was tried first and
# rejected here on this direct evidence — it would have misread both of
# those real, legitimate reports as "no verdict"). Frank's transcript-based
# $REPORT is not used for its verdict anymore, but the same tail window
# applies uniformly to whatever file a caller passes, including Frank's new
# last-message file, as defense in depth.
VERDICT_TAIL_LINES=10

# Prints the LAST anchored verdict token within the last VERDICT_TAIL_LINES
# non-blank lines of FILE (case preserved from the file), or prints nothing
# and returns 1 when FILE is missing, empty, or has no anchored verdict line
# within that tail window — including a transcript that only echoes the
# instruction asking for one, or one whose only anchored verdict line is a
# draft buried earlier than the tail window.
verdict_token() {
  local file="$1" token
  [ -f "$file" ] || return 1
  token="$(grep -v '^[[:space:]]*$' "$file" 2>/dev/null \
    | tail -n "$VERDICT_TAIL_LINES" \
    | grep -iE "$VERDICT_LINE_RE" \
    | grep -ioE 'APPROVE|REQUEST_CHANGES' | tail -1)"
  [ -n "$token" ] || return 1
  printf '%s\n' "$token"
}
