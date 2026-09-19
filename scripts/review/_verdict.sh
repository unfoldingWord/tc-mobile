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
# Round 2's fix gave Frank an isolated artifact (`codex exec
# -o/--output-last-message <FILE>`, confirmed via `codex exec --help`: writes
# ONLY the agent's last message, never the streamed transcript) but George
# had no equivalent, so round 2 bolted on a distance-based defense instead: a
# VERDICT_TAIL_LINES-line tail window on George's still-live-streamed
# transcript, on the theory that real further investigation always runs
# longer than that before a stall. Frank at 0fa4d99 (P1 #2, round 3) called
# this what it is — a heuristic, not a guarantee: a draft verdict inside the
# window (Frank's own example: 9 non-blank lines of investigation, one line
# under the old window of 10) still reads as a clean pass, and the test that
# shipped with it only proved the one chosen distance, not the claimed
# property.
#
# THE ONE RULE, replacing both round 2's window and the two-different-rules
# split it left between reviewers: a verdict is read ONLY from a completion
# artifact that the calling script itself wrote FOR THIS RUN, and that
# artifact is removed before the tool starts. No tail windows, no scanning a
# live-streamed transcript at all — verdict_token() itself no longer knows or
# cares how a stall shows up, because a stall now simply means the artifact
# it is handed was never (re)populated.
#
# Both callers now hand verdict_token() a FILE WHOSE ENTIRE CONTENT IS THE
# MODEL'S OWN FINAL ANSWER, nothing else mixed in:
#   - frank.sh: codex exec's own -o/--output-last-message file, cleared with
#     `rm -f` immediately before every invocation (scripts/review/frank.sh) —
#     round 3's P1 #1 was exactly a stale copy of this file from an earlier
#     successful run surviving an unwritten rerun and being read as current.
#   - george.sh: `grok --output-format json` (probed directly, round 2 and
#     again round 3 via a live smoke call: prints exactly one JSON object,
#     once, at genuine completion, whose own "text" field is the model's
#     final answer and nothing else) — grok has no separate last-message
#     flag, but this is the equivalent artifact. The raw JSON is captured to
#     its own file, cleared with `rm -f` before every invocation, and its
#     "text" field is extracted to a second file that verdict_token() below
#     reads (scripts/review/george.sh). Losing today's live-streamed stdout
#     costs nothing: the George runners that watch for a stall already watch
#     ~/.grok/logs/unified.jsonl for a quiet PID, not stdout.
#
# verdict_token() therefore no longer needs any notion of "how far back is
# safe" — the whole (small) file it is handed already IS the final answer. It
# still requires that answer to CONTAIN a standalone anchored verdict LINE
# (VERDICT_LINE_RE above), because a genuine final answer's own prose can
# still merely mention both words without committing to either (#220's
# example), so the line anchor stays; only the distance-based tail window is
# gone.
#
# Prints the LAST anchored verdict token in FILE (case preserved from the
# file), or prints nothing and returns 1 when FILE is missing, empty, or has
# no anchored verdict line — including a final answer that only echoes the
# instruction asking for one, or only mentions both words in prose.
verdict_token() {
  local file="$1" token
  [ -f "$file" ] || return 1
  token="$(grep -v '^[[:space:]]*$' "$file" 2>/dev/null \
    | grep -iE "$VERDICT_LINE_RE" \
    | grep -ioE 'APPROVE|REQUEST_CHANGES' | tail -1)"
  [ -n "$token" ] || return 1
  printf '%s\n' "$token"
}
