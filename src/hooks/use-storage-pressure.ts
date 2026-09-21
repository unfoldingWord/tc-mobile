import { useEffect, useState } from "react";

import {
  storagePressure,
  storagePressureMarker,
  type StoragePressure,
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
 * Read by the Books screen (`books-screen.tsx`, through
 * `storagePressureNotice`) — #247's wiring half, landed once #531's rewrite
 * had settled.
 *
 * **The marker is all that leaves this file.** `useStoragePressure` returns
 * `"low" | "critical" | null` rather than the `usage`/`quota` pair, so
 * "nothing may render the numbers" (`pressure.ts`'s docblock: the estimate is
 * coarse and per-origin, and #247 asks for no number on screen) is a property
 * of the boundary rather than a rule a future caller has to remember.
 *
 * **There is deliberately no cross-mount cache here, and that is a decision,
 * not an omission.** Two rounds of review built one — a module-scope band plus
 * a refresh generation — and it produced four P2s, every one of them the cache
 * disagreeing with the fact that Books unmounts for the whole time a chapter
 * is open. The DRI removed it (round 6, option B): it existed to serve a
 * consumer that does not exist yet, and the question it answers — whether a
 * remount painting the marker one frame late actually matters — cannot be
 * answered from inside this repository, because nothing here renders and
 * nobody has watched a real Books screen on a real phone. So this hook reads
 * once per mount and holds nothing between mounts.
 *
 * **The wiring PR (`books-screen.tsx`) left it that way rather than guess.**
 * Whether the one-frame-late paint on remount is worth a cache is a product
 * judgement that needs a real screen on a real phone, which nobody has done —
 * so it is recorded as an open gap on #247, not silently decided either way.
 * If a future reading says it matters, the invalidation belongs at module
 * scope, bumped by the write that changed the world — the shape
 * `mp3-codec.ts`'s encoder health and `failure-log.ts`'s count already use —
 * and NOT on a React prop, which dies with the screen that held it. That
 * analysis is George R6 H2 and is recorded on #247.
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
 * The storage-pressure marker for the Books standing-condition slot, or `null`
 * when there is nothing to show. One read, once, when this mounts.
 *
 * **It holds nothing between mounts.** Books unmounts for the whole time a
 * chapter is open, so every trip home starts this at `null` and paints the
 * marker only once the read lands — an effect later, not on the first render.
 * That is the deliberate shape after round 6; see this module's header for why
 * the cache that used to close that gap was removed and what the wiring PR has
 * to decide before building another one.
 *
 * **Not gated on content** the way `useStoragePersistence` is. That gate exists
 * because `persist()` spends a one-time browser decision; `estimate()` spends
 * nothing and is safely re-runnable, and an origin can be near its quota
 * because of what some OTHER part of this app wrote. The band answers for the
 * device, not for a book.
 *
 * **CONTRACT — this is NOT `null` until the shelf has loaded** (George R6 H3).
 * The other two producers for the same Books slot are: `storageMarker` takes
 * `hasContent` and answers `null` without a loaded shelf, and `encoderNotice`
 * has nothing to report before a book exists to encode from. This one is
 * different on purpose — the device can be full before this app has read
 * anything — so it can return a marker while Books is still loading or showing
 * a load failure, and that slot is exclusive and acute-first
 * (`books-screen.tsx:1124-1137`). **The consumer must not show this marker
 * while that slot is showing something** — `storagePressureNotice`
 * (`components/storage-pressure-notice.ts`) is where that gate now lives, as
 * an explicit `hasContent`/acute-trio (`loading`/`loadFailed`/`deleteFailed`)
 * parameter rather than as JSX prose in the screen (#542, Frank P2-2 /
 * George P3-5) — a `ready` parameter on THIS hook was considered and left
 * out: the ordering is the screen's decision, the screen already holds those
 * flags, and this file has just finished removing one parameter that existed
 * for a caller that does not exist yet.
 *
 * **The recorder-close half of #247's fix shape is not here.** #247 asks for
 * "once on Books mount and after each recorder close". This is the first half.
 * The second needs an invalidation that survives an unmount, which is exactly
 * what round 6 deferred — a translator who stays inside one chapter recording
 * segment after segment sees no change until they come back out. Open on #247.
 *
 * Not covered by any test in this repo: everything below this line. There is
 * no jsdom or renderer here (the same limitation `useStoragePersistence`'s and
 * `useEraseSegment`'s docblocks name), so the effect and its cancellation are
 * review and on-device surface. Every decision they make IS pinned in Node:
 * `storagePressure`, `storagePressureMarker`, `readStorageEstimate` and
 * `storageEstimateSourceOf`.
 *
 * Read by `books-screen.tsx` (#247's wiring half), through
 * `storagePressureNotice`.
 */
export function useStoragePressure(): StoragePressureMarker | null {
  const [band, setBand] = useState<StoragePressure>("unknown");

  useEffect(() => {
    let cancelled = false;
    // `readStorageEstimate` never rejects, so there is no dropped rejection
    // here and no second channel to catch one in.
    void readStorageEstimate(storageEstimateSourceOf(globalThis)).then(
      (reading) => {
        // A read that outlives its mount has nothing left to tell: with no
        // cross-mount cache, the only thing this could still do is set state
        // on a screen that is gone. (This guard carried more weight when there
        // was a module cache behind it — Frank R1 P2-1 — and that reason is
        // gone with the cache. It stays as the plain cleanup it always also
        // was.)
        if (cancelled) return;
        setBand(storagePressure(reading?.usage, reading?.quota));
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return storagePressureMarker(band);
}
