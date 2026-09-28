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
 * the raw pair never reaches a screen. The one other reader, the transcode
 * sweep (#1010, through `freeByteCount`), compares free bytes across two
 * readings to decide a retry and renders nothing.
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
 * **Tone: `"low"` is `info`; `"critical"` is `alert` (DRI decision, Seth,
 * 2026-09-24, reversing the call this paragraph used to make).** Through
 * 2026-09-24 this docblock said BOTH bands were `info` and neither was ever
 * `alert` — reasoned from `encoder-notice.ts`'s invariant that painting a
 * standing condition red on the app's home screen teaches people to ignore
 * red, which is the cost `notice-tone.ts` exists to avoid (George R4 G3; the
 * product half was decided by the DRI at the time). The DRI has since judged
 * that reasoning does not hold for `"critical"`: a critical condition
 * rendered in the same tone as a low one does not read as more urgent, and
 * the critical copy (`strings.storageCritical`) now states a concrete
 * consequence — new recordings may not save — which is the shape `alert`
 * exists for. `"low"` keeps `info`: nothing has failed at that band, and
 * there is still time to act (mark segments Finished, or share and erase). A
 * real out-of-space failure still has its own full-screen recovery
 * (`recovery-copy.ts`), unrelated to either band here. This TYPE carries no
 * tone of its own — the mapping lives in `components/
 * storage-pressure-notice.ts`, pinned by `tests/storage-pressure-notice.test.ts`.
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
 * integers, `free * 100` and `quota * PERCENT` stay exact for every figure
 * this module accepts (see `MAX_SAFE_BYTE_COUNT`, which is what makes that
 * sentence true rather than nearly true), and the edges have no floating-point
 * fuzz for a test to straddle.
 */
export const LOW_PRESSURE_FREE_BYTES = 100 * 1024 * 1024;
export const LOW_PRESSURE_FREE_PERCENT = 15;
export const CRITICAL_PRESSURE_FREE_BYTES = 30 * 1024 * 1024;
export const CRITICAL_PRESSURE_FREE_PERCENT = 5;

/**
 * The largest figure this module will judge: `Number.MAX_SAFE_INTEGER / 100`,
 * about 90 TB.
 *
 * `Number.MAX_SAFE_INTEGER` itself was the bound first, and it made the
 * exactness claim above false — Frank round 1 P3. Both sides of the percent
 * test are multiplied by up to 100, so a figure above a hundredth of the safe
 * range has its product rounded, and two products that differ exactly can
 * round to the same double: at `quota = 9_007_199_254_740_987` and
 * `usage = 7_656_119_366_529_839` the exact answer is `"low"` and the float
 * answer was `"ok"`. Dividing the bound by the same 100 the arithmetic
 * multiplies by removes the gap rather than papering over it, and the honest
 * answer for anything above it is `"unknown"`: a band this module cannot
 * compute exactly is a band it should not report. No real quota comes near
 * 90 TB; this is about the claim being true, not about the case arising.
 */
export const MAX_SAFE_BYTE_COUNT = Math.floor(Number.MAX_SAFE_INTEGER / 100);

/**
 * A figure this module is willing to do arithmetic on.
 *
 * `undefined` is the spec's own answer for either field, not only what an
 * absent API produces. The range does the rest without a `Number.isFinite`
 * call: `NaN` fails both comparisons, `-Infinity` fails `>= 0`, and
 * `Infinity` — like any figure past `MAX_SAFE_BYTE_COUNT` — fails the upper
 * bound, which is there because beyond it the arithmetic below stops being
 * exact and, far enough past it, `free * 100` reaches `Infinity` — at which
 * point every comparison answers nonsense instead of failing loudly.
 *
 * The `value !== undefined` clause is there for the type system, which will
 * not narrow `number | undefined` through a comparison, and it is runtime-
 * redundant: `undefined >= 0` is already `false`. So no test can kill a
 * mutation of that clause alone. Recorded here rather than left for a later
 * mutation sweep to rediscover as a coverage hole it is not.
 */
function isByteCount(value: number | undefined): value is number {
  return value !== undefined && value >= 0 && value <= MAX_SAFE_BYTE_COUNT;
}

/**
 * Free bytes for one `usage`/`quota` pair, or `undefined` for a reading
 * {@link storagePressure} would call `"unknown"`.
 *
 * For a caller that compares two readings rather than banding one: the
 * transcode sweep (#1010) holds out a segment that failed until a later
 * reading shows more room than the one taken at the failure. Same guard as
 * `storagePressure`, so the two never disagree about what a usable reading is.
 * Negative when `usage` exceeds `quota`, for the reason given there. Like the
 * band, the figure is for a decision and never for the screen.
 */
export function freeByteCount(
  usage: number | undefined,
  quota: number | undefined
): number | undefined {
  if (!isByteCount(usage) || !isByteCount(quota) || quota === 0) {
    return undefined;
  }
  return quota - usage;
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

/**
 * A band worth putting on screen — the other two states are silence.
 *
 * The union a consumer sees is deliberately narrower than the one decided
 * above (George R4 G5). Both other producers for the Books
 * standing-condition slot return `null` for "nothing to say" —
 * `storageMarker` here in `persistence.ts`, and `encoderNotice` in
 * `components/encoder-notice.ts` — so a screen writes `{marker && <Notice>}`.
 * A producer that always returns a string makes that `&&` always true and
 * paints the word `ok` at the translator. The four states stay where they are
 * decided; only what there is to show leaves.
 */
export type StoragePressureMarker = "low" | "critical";

/**
 * The marker for a band, or `null` when there is nothing to show.
 *
 * `"ok"` and `"unknown"` are both silence, for different reasons that matter
 * upstream and not here: one is headroom we measured, the other a question we
 * could not ask.
 */
export function storagePressureMarker(
  band: StoragePressure
): StoragePressureMarker | null {
  return band === "low" || band === "critical" ? band : null;
}
