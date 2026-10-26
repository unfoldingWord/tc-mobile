/**
 * Which failure-log rows light the Books ≡ marker (#1005).
 *
 * The log carries a row that is not a failure: `"recorder-take-cap"`, written
 * when a take is sealed and saved at the 20-minute cap. The DRI's decision on
 * #1076, verbatim: "Log it, don't light ≡ (Recommended)". So that row stays in
 * the log, and goes out with the problem report, but on its own it leaves ≡
 * plain.
 *
 * Decided by the row's context rather than by a new field on the row. Rows
 * already stored on a phone therefore read exactly as before, and any context
 * not listed here — including one from an older or newer build — lights the
 * marker, which is the safe default for a failure channel.
 */
const INFORMATIONAL_CONTEXTS: ReadonlySet<string> = new Set([
  "recorder-take-cap",
]);

/**
 * PENDING DRI QUESTION: should a failed in-tap audio resume light ≡?
 *
 * The default is `false`: these two rows are logged and go out with Send, but
 * do not mark ≡, because a refused resume can happen routinely on iOS and a
 * marker that lights on routine events stops meaning anything. Flipping this
 * one constant to `true` makes both light it; no other file changes except the
 * two assertions in `tests/failure-marker.test.ts` that name it. (`"playback-tap-resume"`
 * and `"chapter-play"` predate this and light it; they are not in this set.)
 */
const RESUME_FAILURES_LIGHT_MARKER = false;

const RESUME_CONTEXTS: readonly string[] = [
  "playback-buffer-tap-resume",
  "sheet-open-resume",
];

/** True when a row with this context should mark the Books ≡ control. */
export function lightsFailureMarker(context: string): boolean {
  if (INFORMATIONAL_CONTEXTS.has(context)) return false;
  if (RESUME_CONTEXTS.includes(context)) return RESUME_FAILURES_LIGHT_MARKER;
  return true;
}
