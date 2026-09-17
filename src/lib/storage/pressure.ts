/**
 * How full this origin's storage is, as a three-state read a Books-screen
 * glyph can show instead of a byte count (#247, the deferred half of #12
 * `persistence.ts` reserved a slot for).
 *
 * `navigator.storage.estimate()` answers are coarse by spec — a browser may
 * round or pad `usage`/`quota` for fingerprinting resistance — and they are
 * PER-ORIGIN, not per-device: the OS can still hand this origin a comfortable
 * quota while the disk itself is nearly full, and the reverse. Nothing in this
 * module, and nothing that consumes it, may render the raw numbers; the whole
 * point of `storagePressure` is turning them into a state a translator who may
 * not read can act on (mark segments Finished, or share and erase) before the
 * last 10% rather than after a failed save.
 *
 * This is a pure decision over two numbers — no DOM, no `navigator` — so it is
 * unit-tested in plain Node like `persistence.ts`'s `storageMarker`. The
 * browser call that produces `usage`/`quota` lives behind the hooks boundary,
 * in `hooks/use-storage-estimate.ts`.
 */

/** `"ok"` shows nothing; `"low"` is `info` tone, `"critical"` is `alert` tone
 * — the same two tones `notice-tone.ts` already defines, in the same Books
 * Notice-chain slot `persistence.ts`'s `"not-persisted"` uses. */
export type StoragePressure = "ok" | "low" | "critical";

/**
 * Thresholds, named and separate so each can be pinned at its own edge.
 *
 * **These are a proposal, not a measured fact** (AGENTS.md "never claim
 * verification you did not perform"; #247's "Evidence class" says the same).
 * They come from #247's issue body, itself a judgement call with no field data
 * behind it yet — `estimate()`'s accuracy on Android Chrome, the platform this
 * app most needs the warning on, is inference from the spec, not an observed
 * value. Record what a real device reports before treating these as tuned.
 *
 * Two units, not one, because a fixed byte floor and a fixed percentage
 * protect against different devices: a percentage alone lets a device with a
 * huge quota wait until a huge absolute amount is gone before it warns, and a
 * byte floor alone fires far too early for a device with a tiny quota to begin
 * with. Either tripping is enough — see `storagePressure` below.
 */
export const LOW_PRESSURE_FREE_RATIO = 0.15; // under 15% of quota free
export const LOW_PRESSURE_FREE_BYTES = 100 * 1024 * 1024; // under 100 MB free
export const CRITICAL_PRESSURE_FREE_RATIO = 0.05; // under 5% of quota free
export const CRITICAL_PRESSURE_FREE_BYTES = 30 * 1024 * 1024; // under 30 MB free

/**
 * `usage`/`quota` straight off `StorageEstimate` — both **optional in the
 * spec itself**, not just when the API is absent, so accepting `undefined`
 * here (rather than requiring the hook to pre-decide "no data") is what lets
 * an absent API, a rejected `estimate()` (both turned into `null` by
 * `readStorageEstimate`, then spread as two `undefined`s here) and a browser
 * that answers with a partial estimate all fall through the same branch.
 * `"ok"` in this state is silence, exactly like `storageMarker`'s `undefined`
 * case: a warning needs evidence, and no reading is not evidence of pressure.
 *
 * A non-positive or non-finite `quota` is treated the same way — there is no
 * meaningful free-space fraction to compare against.
 */
export function storagePressure(
  usage: number | undefined,
  quota: number | undefined
): StoragePressure {
  if (
    usage === undefined ||
    quota === undefined ||
    !Number.isFinite(usage) ||
    !Number.isFinite(quota) ||
    quota <= 0
  ) {
    return "ok";
  }

  const free = quota - usage;
  const freeRatio = free / quota;

  if (
    free <= CRITICAL_PRESSURE_FREE_BYTES ||
    freeRatio <= CRITICAL_PRESSURE_FREE_RATIO
  ) {
    return "critical";
  }
  if (free <= LOW_PRESSURE_FREE_BYTES || freeRatio <= LOW_PRESSURE_FREE_RATIO) {
    return "low";
  }
  return "ok";
}
