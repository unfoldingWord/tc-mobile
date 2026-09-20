import { useEffect, useState } from "react";

import { storagePressure, type StoragePressure } from "@/lib/storage/pressure";

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
 * The source, or `undefined` where there is none — older iOS Safari, and a
 * plain Node test run (Node 22 has a `navigator`, but no `navigator.storage`).
 * Matches `use-storage-persistence.ts`'s `browserStorageManager`.
 */
function browserStorageSource(): StorageEstimateSource | undefined {
  if (typeof navigator === "undefined" || !("storage" in navigator)) {
    return undefined;
  }
  const manager: unknown = navigator.storage;
  return typeof manager === "object" && manager !== null ? manager : undefined;
}

/**
 * The last band this page load resolved, held at module scope.
 *
 * The reason is George round 1 P2-2 on #214, one lane over: a hook that starts
 * every mount at "nothing known" makes a STANDING condition blink off for a
 * tick each time the screen remounts — and the Books screen unmounts on every
 * chapter open. For a `role="status"` notice that is a visible flicker and a
 * re-announce of a state that never actually changed. Seeding the next mount
 * with the last known band closes that gap; the fresh read still runs and
 * still wins, which is the difference from #214's `persist()` — there the
 * cached answer IS the answer, here it is only what to paint until the new one
 * lands.
 */
let lastBand: StoragePressure = "unknown";

/**
 * How full this origin's storage is, re-read once every time this mounts.
 *
 * **Not gated on content** the way `useStoragePersistence` is. That gate
 * exists because `persist()` spends a one-time browser decision and a warning
 * about an empty shelf would be stale; `estimate()` spends nothing, is safely
 * re-runnable, and an origin can be near its quota because of what some OTHER
 * part of this app wrote. The band answers for the device, not for a book.
 *
 * **Once per mount, not on a timer.** #247 asks for "once on Books mount and
 * after each recorder close (the writes happen there)". The first half is
 * this; the second half is not reachable from here, because the recorder
 * closes while the Segments screen owns it and Books is unmounted for the
 * whole time a chapter is open. Reaching it means a refresh trigger lifted
 * through `App.tsx`, which is a wiring decision and belongs with the wiring
 * PR. Worth stating plainly: a translator who stays inside one chapter
 * recording segment after segment will not see the band change until they come
 * back out. That gap is real and stays open on #247.
 *
 * Not covered by any test in this repo: everything below this line. There is
 * no jsdom or renderer here (the same limitation `useStoragePersistence`'s and
 * `useEraseSegment`'s docblocks name), so the effect, its cancellation and the
 * module-scope seeding above are review and on-device surface. What IS pinned
 * in Node is `readStorageEstimate` and `storagePressure`.
 *
 * @pivotpending No caller yet — #247's Books marker is the reader, and it is
 * deliberately a separate PR: `books-screen.tsx` was rewritten by #531 and the
 * marker lands once that has settled. Tagged rather than left to knip's
 * test-only blind spot, which would otherwise hide it.
 */
export function useStoragePressure(): StoragePressure {
  const [band, setBand] = useState<StoragePressure>(() => lastBand);

  useEffect(() => {
    let cancelled = false;
    // `readStorageEstimate` never rejects, so there is no dropped rejection
    // here and no second channel to catch one in.
    void readStorageEstimate(browserStorageSource()).then((reading) => {
      // Both writes are behind `cancelled`, not just the state one. Frank
      // round 1 P2-1: a slow read from an unmounted screen could otherwise
      // land AFTER a newer read from the current one and overwrite the cache
      // with its stale band, seeding the next mount with exactly the wrong
      // answer — the flicker this cache exists to prevent, inverted. A
      // cancelled read has been superseded by definition; its answer is not
      // worth keeping.
      if (cancelled) return;
      lastBand = storagePressure(reading?.usage, reading?.quota);
      setBand(lastBand);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return band;
}
