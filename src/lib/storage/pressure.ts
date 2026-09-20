/**
 * How close this origin is to running out of room, as a band a Books-screen
 * marker can show — #247, the half of #12 that the 2026-09-04 narrowing left
 * behind when the September gate was scoped to `persist()` alone.
 *
 * `persistence.ts` answers a different question: whether the BROWSER has
 * promised not to take this origin's storage back. Nothing there stops the
 * TRANSLATOR filling the phone, and the only place that is learned today is a
 * failed save (#38's recovery screen) or a quota classification on a write
 * (#172/#235) — both after the loss of the morning's work. A band read before
 * the last of the room is gone is what leaves time to mark segments Finished
 * (ADR 0009's transcode reclaims ~90%) or share and erase.
 *
 * **Nothing may render the numbers this is computed from.** A
 * `navigator.storage.estimate()` answer is coarse by spec — a browser may
 * round or pad `usage`/`quota` to resist fingerprinting — and it is
 * PER-ORIGIN, not per-device: the OS can hand this origin a comfortable quota
 * while the disk itself is nearly full, and the reverse. A band is the most a
 * coarse reading can honestly support, and a band is also the only thing a
 * translator who may not read can act on. The hook that owns the browser call
 * (`hooks/use-storage-pressure.ts`) returns only this type for that reason:
 * the raw pair never leaves it.
 *
 * Pure arithmetic over two numbers — no DOM, no `navigator` — so it is pinned
 * in plain Node (`tests/storage-pressure.test.ts`) the way `storageMarker` is.
 */

/**
 * A band, and how a caller is meant to read each one.
 *
 * `"unknown"` and `"ok"` both render nothing, and they are still two states
 * rather than one: `"ok"` is a positive claim that there is room, made from
 * numbers, and `"unknown"` is the absence of any claim at all. Collapsing them
 * would mean this module reporting headroom it never saw — and the mistake
 * that matters here is in the other direction too: a marker that fires on a
 * browser that answered `undefined` is worse than no marker, because a warning
 * with nothing behind it teaches a translator to ignore the one that is real.
 *
 * `"low"` is `info` tone and `"critical"` is `alert` — the two tones
 * `notice-tone.ts` already defines, in the Books standing-condition slot
 * `"not-persisted"` already uses. That mapping is the wiring PR's to make; it
 * is written here only so the band names are not read as free-floating.
 */
export type StoragePressure = "unknown" | "ok" | "low" | "critical";

/**
 * The floors, named so each can be pinned at its own edge.
 *
 * **These are a proposal, not a measured fact.** They are #247's issue-body
 * figures, and #247's own "Evidence class" says the same: `estimate()`'s
 * accuracy on Android Chrome — the platform this warning matters most on — is
 * inference from the spec, and this repository has never recorded a reading
 * from a device. Record what a real phone reports before treating these as
 * tuned (AGENTS.md: never claim verification you did not perform).
 *
 * Two units rather than one, because a fixed fraction and a fixed byte count
 * fail on opposite devices: a fraction alone lets a large quota burn a large
 * absolute amount before it says anything, and a byte floor alone fires
 * immediately on a phone whose whole quota is small. Either floor tripping is
 * enough — see `storagePressure`.
 *
 * The fractions are whole percents, not ratios, so the comparison below can be
 * a multiplication of integers instead of a division: byte counts are
 * integers, `free * 100` and `quota * PERCENT` stay exact for any quota this
 * module accepts, and the edges have no floating-point fuzz for a test to
 * straddle.
 */
export const LOW_PRESSURE_FREE_BYTES = 100 * 1024 * 1024;
export const LOW_PRESSURE_FREE_PERCENT = 15;
export const CRITICAL_PRESSURE_FREE_BYTES = 30 * 1024 * 1024;
export const CRITICAL_PRESSURE_FREE_PERCENT = 5;

/**
 * A figure this module is willing to do arithmetic on.
 *
 * `undefined` is the spec's own answer for either field, not only what an
 * absent API produces. The range does the rest without a `Number.isFinite`
 * call: `NaN` fails both comparisons, `-Infinity` fails `>= 0`, and
 * `Infinity` — like any figure past `Number.MAX_SAFE_INTEGER` — fails the
 * upper bound, which is there because beyond it the arithmetic below stops
 * being exact and `free * 100` can reach `Infinity`, at which point every
 * comparison answers nonsense instead of failing loudly.
 *
 * The `value !== undefined` clause is there for the type system, which will
 * not narrow `number | undefined` through a comparison, and it is runtime-
 * redundant: `undefined >= 0` is already `false`. So no test can kill a
 * mutation of that clause alone. Recorded here rather than left for a later
 * mutation sweep to rediscover as a coverage hole it is not.
 */
function isByteCount(value: number | undefined): value is number {
  return value !== undefined && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

/**
 * The band for one `usage`/`quota` pair.
 *
 * Both fields are optional in `StorageEstimate` itself, so an absent API, a
 * rejected call, a partial answer and a browser that pads its figures into
 * nonsense all arrive here and all leave as `"unknown"`. A zero quota is the
 * trap worth naming: zero free out of zero quota is arithmetically 0% free,
 * which every floor below would read as `"critical"` — a full-red marker on a
 * browser that told us nothing. A quota has to be a positive byte count before
 * any of this means anything.
 *
 * `usage` above `quota` is NOT malformed and is not treated as unknown: a
 * browser can lower a quota under device pressure while data already sits
 * above it. Negative headroom is worse than none, and falls out of the same
 * comparisons.
 *
 * Both floors are `<`, not `<=`, matching #247's wording ("under 15% free or
 * under 100 MB"): holding exactly the headroom we insist on keeping is still
 * holding it. Critical is asked first, so a reading under both floors reports
 * the worse of the two.
 */
export function storagePressure(
  usage: number | undefined,
  quota: number | undefined
): StoragePressure {
  if (!isByteCount(usage) || !isByteCount(quota) || quota === 0) {
    return "unknown";
  }

  const free = quota - usage;

  if (
    free < CRITICAL_PRESSURE_FREE_BYTES ||
    free * 100 < quota * CRITICAL_PRESSURE_FREE_PERCENT
  ) {
    return "critical";
  }
  if (
    free < LOW_PRESSURE_FREE_BYTES ||
    free * 100 < quota * LOW_PRESSURE_FREE_PERCENT
  ) {
    return "low";
  }
  return "ok";
}
