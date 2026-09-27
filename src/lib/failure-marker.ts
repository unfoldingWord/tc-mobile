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

/** True when a row with this context should mark the Books ≡ control. */
export function lightsFailureMarker(context: string): boolean {
  return !INFORMATIONAL_CONTEXTS.has(context);
}
