/**
 * The error `playSamples` (`hooks/audio-io.ts`) throws when its #469 resume
 * bound fails closed: the timeout, or the gate that still finds the shared
 * context unusable.
 *
 * `playSamples` has already written that failure's row (`"playback-resume"`,
 * `"-timeout"` or `"-unusable"`) by the time this reaches a caller. The
 * callers' own catch sites in `use-audio-session.ts` report every OTHER
 * playback failure (#1213), so they need a way to tell this one apart and not
 * write a second row for it. That is this class's only job.
 *
 * `name` is left as the inherited `"Error"`, so a stored row for this failure
 * reads exactly as it did before the class existed.
 *
 * Its own module, not an export of `audio-io.ts`: the `use-audio-session`
 * tests replace `@/hooks/audio-io` with a mock factory, and an `instanceof`
 * check against an export that factory does not define would throw inside
 * the catch it is guarding.
 */
export class PlaybackResumeError extends Error {}

/**
 * The error `playSamples` (`hooks/audio-io.ts`) throws when a Play started on
 * a context that reports `"running"` but whose `currentTime` did not advance
 * within `CLOCK_STALL_TIMEOUT_MS` (#1251). `playSamples` has already written
 * that failure's `"playback-clock-stalled"` row, so the callers' catch sites
 * skip it for the same reason they skip {@link PlaybackResumeError}.
 *
 * In this module, not `audio-io.ts`, for the same mock-factory reason as the
 * class above.
 */
export class PlaybackClockStalledError extends Error {}
