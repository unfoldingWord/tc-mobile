import { useEffect, useState } from "react";

import {
  adoptPressureReading,
  EMPTY_PRESSURE_CACHE,
  invalidateStalePressure,
  storagePressureMarker,
  type PressureCache,
  type StoragePressureMarker,
} from "@/lib/storage/pressure";

/**
 * The `navigator.storage.estimate()` boundary for #247's storage-pressure
 * marker, and the band it produces.
 *
 * `estimate()` is a browser API, so it lives here and not in `lib/` —
 * `lib/storage/pressure.ts` holds the decision this file's answer feeds,
 * exactly the split `use-storage-persistence.ts` and `lib/storage/
 * persistence.ts` already use for `persist()`/`persisted()`. The call itself
 * is a plain async function over an injected source, so it is exercised in
 * Node against stubs; the React half below is the thin part, and is the part
 * no test in this repo reaches.
 *
 * **This is the core only. Nothing on any screen consumes it yet.** #247's
 * other half — the Books marker — is a separate PR: `books-screen.tsx` was
 * rewritten by #531 (its overlays became system-Back layers) and the marker
 * lands once that has settled.
 *
 * **The band is all that leaves this file.** `useStoragePressure` returns a
 * `StoragePressure` rather than the `usage`/`quota` pair, so "nothing may
 * render the numbers" (`pressure.ts`'s docblock: the estimate is coarse and
 * per-origin, and #247 asks for no number on screen) is a property of the
 * boundary rather than a rule a future caller has to remember.
 */

/**
 * The slice of `navigator.storage` this needs, with the method optional.
 *
 * Optional is the point, as in `use-storage-persistence.ts`'s
 * `StorageDurabilityManager`: it makes "the API is not here" a shape the type
 * system admits rather than a runtime surprise. `StorageManager` satisfies it.
 */
export interface StorageEstimateSource {
  estimate?: () => Promise<{ usage?: number; quota?: number }>;
}

/**
 * One reading. Both fields are optional in `StorageEstimate` itself, not only
 * when the API is missing, so a partial answer is a normal answer here and
 * `storagePressure` is the one place that decides whether a figure is usable.
 */
export interface StorageEstimateReading {
  readonly usage: number | undefined;
  readonly quota: number | undefined;
}

/** What the browser handed back, or `undefined` if it was not a number at
 * all. The declared return type is `number | undefined`; this is what makes
 * that true at runtime, so a hostile or exotic implementation cannot put a
 * string in front of a byte-floor comparison. Range sanity is deliberately NOT
 * done here — `storagePressure` owns it, and owning it in one place is what
 * keeps the two halves from disagreeing. */
function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/**
 * Read one estimate. **Never rejects.**
 *
 * A coarse origin-storage estimate is not the translator's work failing, and
 * there is no channel worth spending on it on a phone in a village (the same
 * reasoning `ensurePersistedStorage` records). An absent API, a rejected call,
 * a synchronous throw, an answer that is not an object, and a property whose
 * getter throws all become `null` — "we could not ask" — which
 * `storagePressure` then reads as `"unknown"`, which shows nothing.
 *
 * **Everything this function touches happens inside the `try`**, including
 * reading `source.estimate` and reading the answer's two fields. Frank round 1
 * P2-2: `estimate`, `usage` and `quota` are properties, and a property can be
 * an accessor that throws. Read outside the `try`, such a throw made this
 * function REJECT — and `useStoragePressure` attaches only `.then`, so it
 * landed as an unhandled rejection in a mount effect, which is exactly what
 * "never rejects" exists to prevent. There is no shape of `source` left that
 * gets past this.
 */
export async function readStorageEstimate(
  source: StorageEstimateSource | undefined
): Promise<StorageEstimateReading | null> {
  try {
    // One guard, not two (`!source || typeof source.estimate !== "function"`):
    // an absent source and a source without the method are the same answer,
    // and as two clauses the first is unkillable by any test — the second
    // already covers it. The one that remains is type-required (TypeScript
    // will not call an optional method unnarrowed) and is itself
    // runtime-equivalent to the `catch` below, which would turn the same two
    // cases into the same `null` via a TypeError. It stays because "there is
    // no API to ask" reads better as a decision than as a swallowed
    // exception; it is recorded as an equivalent mutant rather than presented
    // as a tested guard. What the tests pin is the contract — `null` for
    // both — not this line. Called through `.call(source)` because a real
    // `StorageManager` method needs its receiver.
    const estimate = source?.estimate;
    if (typeof estimate !== "function") return null;
    // `unknown`, not the declared shape: the value crossing this boundary is
    // whatever the browser gave us, and the two lines below are what turn it
    // into the shape this function promises.
    const answer: unknown = await estimate.call(source);
    if (typeof answer !== "object" || answer === null) return null;
    const { usage, quota } = answer as { usage?: unknown; quota?: unknown };
    return {
      usage: numberOrUndefined(usage),
      quota: numberOrUndefined(quota),
    };
  } catch {
    // Deliberately not reported — see "Never rejects" above. `null` is the
    // honest report, and the screen's silence is its correct rendering.
    return null;
  }
}

/**
 * Find the estimate source on a global scope — `undefined` where there is
 * none, which is older iOS Safari and a plain Node test run (Node 22 has a
 * `navigator`, but no `navigator.storage`).
 *
 * **Takes the scope rather than reading the global itself**, which is what
 * makes it testable and is Frank round 2's finding: `readStorageEstimate`'s
 * protection covers its own body, but its ARGUMENT is evaluated first, so
 * `navigator` and `navigator.storage` — both properties, both able to be
 * accessors or proxy traps that throw (a `SecurityError` in an embedded shell
 * is the realistic one) — were read outside any `try`. That threw
 * synchronously inside the mount effect, before the cancellation cleanup was
 * installed, instead of producing the `"unknown"` band this module documents.
 * The same accessor class as round 1's `estimate` getter, one property
 * earlier; `globalThis` is the one reference in the chain that cannot throw,
 * so it is where the protected region now starts.
 */
export function storageEstimateSourceOf(
  scope: unknown
): StorageEstimateSource | undefined {
  try {
    const nav = (scope as { navigator?: unknown } | null | undefined)
      ?.navigator;
    const manager = (nav as { storage?: unknown } | null | undefined)?.storage;
    return typeof manager === "object" && manager !== null
      ? (manager as StorageEstimateSource)
      : undefined;
  } catch {
    // Deliberately not reported, for the same reason `readStorageEstimate`
    // swallows: a storage estimate is not the translator's work failing, and
    // "we could not ask" already has an honest rendering — silence.
    return undefined;
  }
}

/**
 * What this page load knows, held at module scope so it outlives the screen.
 *
 * Both transitions over it are pure and live in `lib/storage/pressure.ts` —
 * `invalidateStalePressure` and `adoptPressureReading` — which is deliberate:
 * this repo has no renderer, so a rule left inside the effect below would be
 * pinned by nothing (the reason `encoder-notice.ts` was lifted out of JSX).
 * Everything this module decides about staleness is tested in Node; what is
 * left here is the wiring to React, and that is the part that is only ever
 * reviewed.
 *
 * One cache for one Books screen. Two screens mounted at once with different
 * tokens would fight over it — there is only one Books, and if that ever stops
 * being true this belongs in a store rather than a module variable.
 */
let cache: PressureCache = EMPTY_PRESSURE_CACHE;

/**
 * The storage-pressure marker for the Books standing-condition slot, or `null`
 * when there is nothing to show. Re-read on mount, and whenever
 * `refreshToken` moves.
 *
 * **`refreshToken` is how a space-freeing write reaches this** (George R4 G1),
 * and it is the `useFailureCount(recoveryToken)` pattern from
 * `hooks/failure-log.ts`, not a new invention. A remount is NOT the only
 * invalidation, because the writes that free the most space do not unmount
 * anything: a book deleted from the shelf leaves Books mounted
 * (`App.tsx:307-318`), so without this a cached `"critical"` would stay
 * painted over "Start your first book" — a warning about audio the translator
 * had just deleted. The caller bumps it on delete, on erase and on recorder
 * close; until the wiring PR exists there is no caller, and the default of `0`
 * makes this a plain mount-scoped read.
 *
 * **A bump is not a re-render, it is an invalidation.** `invalidateStalePressure`
 * drops the held band the moment the token moves — in the render itself, not
 * in the effect — so the gap between the bump and the fresh read landing is
 * silence rather than a stale warning. That is George's point that a *fresh*
 * estimate on an emptied shelf is fine and a *stale* one is not, and it is why
 * the state here holds a band together with the generation it was read for
 * rather than a bare band.
 *
 * **Not gated on content** the way `useStoragePersistence` is. That gate
 * exists because `persist()` spends a one-time browser decision; `estimate()`
 * spends nothing, is safely re-runnable, and an origin can be near its quota
 * because of what some OTHER part of this app wrote. The band answers for the
 * device, not for a book — what an emptied shelf needs is a FRESH reading, not
 * a suppressed one, and that is what the token delivers.
 *
 * **Still not a timer, and one gap remains open.** #247 asks for "once on
 * Books mount and after each recorder close". The token now carries the
 * recorder-close half too — but only once the wiring PR bumps it. Until then,
 * a translator who stays inside one chapter recording segment after segment
 * sees no change until they come back out. Open on #247, and now with the seam
 * it needs.
 *
 * Not covered by any test in this repo: everything below this line. There is
 * no jsdom or renderer here (the same limitation `useStoragePersistence`'s and
 * `useEraseSegment`'s docblocks name), so the effect, its cancellation and its
 * two calls into the cache are review and on-device surface. What IS pinned in
 * Node is every decision they make: `storagePressure`,
 * `invalidateStalePressure`, `adoptPressureReading`, `storagePressureMarker`,
 * `readStorageEstimate` and `storageEstimateSourceOf`.
 *
 * @pivotpending No caller yet — #247's Books marker is the reader, and it is
 * deliberately a separate PR: `books-screen.tsx` was rewritten by #531 and the
 * marker lands once that has settled, which is also when `refreshToken` gets
 * its first bumper. Tagged rather than left to knip's test-only blind spot,
 * which would otherwise hide it.
 */
export function useStoragePressure(
  refreshToken = 0
): StoragePressureMarker | null {
  const [entry, setEntry] = useState<PressureCache>(() => cache);

  useEffect(() => {
    let cancelled = false;
    // A moved token means the held band is known-stale, so the module cache
    // drops it before the read rather than after. No `setState` here: what
    // this render shows is derived below, which is both what
    // `react-hooks/set-state-in-effect` requires and the better behaviour —
    // an effect-time reset would have left the stale band on screen for the
    // frame in which the token changed.
    cache = invalidateStalePressure(cache, refreshToken);
    // `readStorageEstimate` never rejects, so there is no dropped rejection
    // here and no second channel to catch one in.
    void readStorageEstimate(storageEstimateSourceOf(globalThis)).then(
      (reading) => {
        // Behind `cancelled`, both of them. Frank round 1 P2-1: a slow read
        // from an unmounted screen could otherwise land AFTER a newer read
        // from the current one and write its stale band, seeding the next
        // mount with exactly the wrong answer — the flicker this cache exists
        // to prevent, inverted. A cancelled read has been superseded by
        // definition. (A read outstanding across a token bump is cancelled by
        // the same cleanup, so it cannot write into the new generation.)
        if (cancelled) return;
        // `adoptPressureReading` is what refuses an unusable answer — a failed
        // read must not erase a band that is still true (George R4 G2).
        cache = adoptPressureReading(cache, reading?.usage, reading?.quota);
        setEntry(cache);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  // Staleness is decided HERE, in render, by the same pure function the cache
  // uses: an entry held for an older generation shows nothing, from the very
  // render in which the caller bumped the token. The state holds the entry
  // with its generation precisely so this question can be asked without a
  // second piece of state to keep in step.
  return storagePressureMarker(
    invalidateStalePressure(entry, refreshToken).band
  );
}
