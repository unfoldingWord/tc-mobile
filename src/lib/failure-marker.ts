/**
 * Which failure-log rows light the Books ≡ marker (#1005).
 *
 * The log carries a row that is not a failure: `"recorder-take-cap"`, written
 * when a take is sealed and saved at the 20-minute cap. The DRI's decision on
 * #1076, verbatim: "Log it, don't light ≡ (Recommended)". So that row stays in
 * the log, and goes out with the problem report, but on its own it leaves ≡
 * plain. `"pending-take-replayed"` is the second such row, on the same rule.
 *
 * Decided by the row's context rather than by a new field on the row. Rows
 * already stored on a phone therefore read exactly as before, and any context
 * not listed here — including one from an older or newer build — lights the
 * marker, which is the safe default for a failure channel.
 *
 * `"stale-chunk-reload"` (#1421 O1) is the third: the app reloaded itself
 * once because a lazily loaded file from an older build was gone. The reload
 * is the recovery, so it is recorded but leaves ≡ plain; the action that hit
 * it writes its own row as before. `"stale-chunk"`, the same failure when no
 * reload is allowed (it already reloaded once for this build, or audio is
 * unsaved), is a failure and lights ≡ by the default.
 */
const INFORMATIONAL_CONTEXTS: ReadonlySet<string> = new Set([
  "recorder-take-cap",
  // A take left waiting when the app closed, saved by the launch replay (#38).
  // The one record that it existed, so a tester can confirm it through Send
  // (the DRI's pick on PR #1706: "A: one text round + log row (Recommended)").
  "pending-take-replayed",
  "stale-chunk-reload",
]);

/**
 * Should a failed in-tap audio resume light ≡? The DRI's pick on #1692, verbatim:
 * "Log only, no ≡ (Recommended)".
 *
 * `false`: these two rows are logged and go out with Send, but do not mark ≡,
 * because a refused resume can happen routinely on iOS and a marker that
 * lights on routine events stops meaning anything. The same pick set the rule
 * for the rows below: routine, recoverable failures are logged without
 * lighting ≡, and a failure that loses or blocks the person's work lights it.
 * (`"playback-tap-resume"` and `"chapter-play"` predate this and light it; they
 * are not in this set.)
 */
const RESUME_FAILURES_LIGHT_MARKER = false;

const RESUME_CONTEXTS: readonly string[] = [
  "playback-buffer-tap-resume",
  "sheet-open-resume",
];

/**
 * Recorder-sheet failures that are routine and recoverable, so they are logged
 * and go out with Send but do not light ≡ (the #1692 rule above):
 *
 * - `"recorder-finished-flag"`: the Finished mark was refused (a segment
 *   deleted under the sheet, a quota refusal). The sheet says so in place and
 *   the recording is untouched; nothing is lost.
 * - `"recorder-edit-apply"`: an edit's buffer could not be allocated. The edit
 *   is dropped and shown in place, the history and the saved audio are
 *   unchanged, and the person can try again.
 * - `"recorder-segment-resume-retry"`: the audio-context resume fired in the
 *   "Try again" tap was refused. It is fire-and-forget and never gates the
 *   re-read, so the retry goes ahead regardless; a refused resume is a routine
 *   iOS event (the same reasoning as the two in-tap resume rows above).
 *
 * Every other recorder-sheet context in the log (`"recorder-commit-stop"`,
 * `"recorder-commit-close"`, `"recorder-close-tail"`, `"recorder-close-rejected"`,
 * `"recorder-recovered-save"`, `"recorder-recovered-share"`) is a commit or an
 * exit that failed where a recording could be lost or stranded, so it lights.
 * So does `"recorder-back-no-handle"`: a Back found the recorder screen with no
 * recorder to close, so the Back did nothing and whether the take was committed
 * is not known from here (inference; the cause is an unobserved unmount gap).
 */
const ROUTINE_RECOVERABLE_CONTEXTS: ReadonlySet<string> = new Set([
  "recorder-finished-flag",
  "recorder-edit-apply",
  "recorder-segment-resume-retry",
]);

/** True when a row with this context should mark the Books ≡ control. */
export function lightsFailureMarker(context: string): boolean {
  if (INFORMATIONAL_CONTEXTS.has(context)) return false;
  if (ROUTINE_RECOVERABLE_CONTEXTS.has(context)) return false;
  if (RESUME_CONTEXTS.includes(context)) return RESUME_FAILURES_LIGHT_MARKER;
  return true;
}
