import { useEffect, useState, useSyncExternalStore } from "react";

import {
  storagePressure,
  storagePressureMarker,
  type StoragePressure,
  type StoragePressureMarker,
} from "@/lib/storage/pressure";
import { reportFailure } from "./report-failure";

/**
 * The `navigator.storage.estimate()` boundary for #247's storage-pressure
 * marker, and the band it produces.
 *
 * `estimate()` is a browser API, so it lives here and not in `lib/` —
 * `lib/storage/pressure.ts` holds the decision this file's answer feeds,
 * exactly the split `use-storage-persistence.ts` and `lib/storage/
 * persistence.ts` already use for `persist()`/`persisted()`. The call itself
 * is a plain async function over an injected source, so it is exercised in
 * Node against stubs; the React half below is the thin part. As of #843 item
 * 2 one jsdom-mounted test reaches the effect itself (see
 * `useStoragePressure`'s own docblock below for what it does and does not
 * establish); it remains untouched on a real device.
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
 * **There is still no cross-mount CACHE here — that remains a decision, not
 * an omission — but there IS now a module-scope INVALIDATION, and the two are
 * different claims.** Two rounds of review once built a cache (a module-scope
 * band plus a refresh generation) and it produced four P2s, every one of them
 * the cache disagreeing with the fact that Books unmounts for the whole time a
 * chapter is open. The DRI removed it (round 6, option B): it existed to serve
 * a consumer that does not exist yet, and whether a remount painting the
 * marker one frame late actually matters could not be answered from inside
 * this repository, because nothing here renders and nobody had watched a real
 * Books screen on a real phone. **That question is still open** — a translator
 * who stays inside one chapter recording segment after segment, with Books
 * unmounted the whole time, still sees no update until they come back out
 * (the "recorder-close refresh" half of #247, `books-screen.tsx`'s own note).
 * This hook still starts a fresh mount at `"unknown"` and paints only once
 * `estimate()` lands; nothing here caches that answer across a remount.
 *
 * **What round 6 deferred, and #542 Part B's DRI comment (2026-09-24)
 * explicitly overrode, was narrower: a STALE reading resurrecting mid-visit
 * with no remount at all.** Delete a book down to an empty shelf — the line
 * correctly hides, because `hasReclaimableAudio` (`books-screen.tsx`) goes
 * false — then create a new one on the SAME visit, and without an
 * invalidation the marker painted whatever `estimate()` answered at mount,
 * before the delete freed anything. The DRI's words: "build the module-scope
 * estimate() invalidation now, bumped by book delete/create, without a device
 * reading" — authorizing exactly the shape this docblock used to defer,
 * scoped to those two writes only. `bumpStoragePressure` below is that
 * invalidation: a module-scope generation, in the same
 * `useSyncExternalStore` shape `mp3-codec.ts`'s encoder health and
 * `failure-log.ts`'s count already use, that `useStoragePressure` takes as an
 * effect dependency so a bump re-reads `estimate()` in whatever mount is
 * live — never a cached BAND, only a trigger to ask again. `use-books.ts`
 * calls it from `createBook`'s and `deleteBook`'s success paths, after each
 * write is durable. The recorder-close half above is deliberately NOT wired
 * to it — that scope was not authorized here and stays open on #247.
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
 * How many times a write that "changed the world" for storage has landed —
 * `bumpStoragePressure`'s call count (#542 Part A).
 *
 * Module scope, not a ref or a prop, for the reason this module's header
 * explains at length: the invalidation has to survive whichever Books mount
 * is live, and a React prop dies with the screen that held it. Mirrors
 * `mp3-codec.ts`'s `encoderHealth`/`healthListeners` and `failure-log.ts`'s
 * `logGeneration`/`logWatchers` — a plain module-scope counter, a listener
 * set, and a `useSyncExternalStore` pair — rather than inventing a fourth
 * shape for the same problem.
 *
 * A COUNTER, not a cached band: nothing here remembers what `estimate()` last
 * answered. Bumping only tells a live `useStoragePressure` instance "ask
 * again"; a mount that starts after the bump just reads the current value as
 * its initial one and asks anyway, the same as any other mount.
 */
let generation = 0;

/** Subscribers to {@link generation}, in the `useSyncExternalStore` shape. */
const generationListeners = new Set<() => void>();

/** The `getSnapshot` half of the store. */
function getGeneration(): number {
  return generation;
}

/** The `subscribe` half. Returns the unsubscribe. */
function subscribeToGeneration(onChange: () => void): () => void {
  generationListeners.add(onChange);
  return () => {
    generationListeners.delete(onChange);
  };
}

/**
 * The current generation, as a monotonic count of landed
 * {@link bumpStoragePressure} calls. For `tests/storage-pressure.test.ts`'s
 * readiness probe only (mirroring `mp3-codec.ts`'s `encoderHealth()`, which
 * the same test file's sibling reads directly rather than through
 * `subscribeToEncoderHealth`): nothing in the app needs a synchronous read of
 * this outside `useStoragePressure`'s own `useSyncExternalStore` snapshot, so
 * this exists to let a Node test pin the counter's own contract — that a bump
 * always advances it, and by exactly one per call — without a DOM renderer to
 * mount the hook in.
 */
export function storagePressureGeneration(): number {
  return generation;
}

/**
 * A write that changed the world for storage just landed: a book delete or a
 * book create committed (#542 Part A, DRI decision 2026-09-24 — scoped to
 * exactly those two; segment erase and recorder close are NOT wired to this,
 * and remain #247's separate, still-open "recorder-close refresh" bullet).
 *
 * Called from `use-books.ts`'s `deleteBook` and `createBook`, AFTER the
 * underlying IndexedDB transaction has committed — never from an optimistic
 * pre-commit state update — so a bump always means the read a subsequent
 * `estimate()` call makes can reflect the write, not a promise of one still
 * in flight.
 *
 * Idempotent in the sense that matters: a monotonic counter tolerates being
 * called more than once for one logical write (a retry, or two callers
 * bumping for the same commit) with no harm beyond one extra `estimate()`
 * read in whichever `useStoragePressure` mount is live — there is no
 * "already bumped" state to duplicate or corrupt.
 *
 * A listener that throws is reported, not swallowed — this store's whole
 * purpose is that a stale reading stops being silent — mirroring
 * `mp3-codec.ts`'s `publishHealth`.
 */
export function bumpStoragePressure(): void {
  generation += 1;
  // A copy, so a listener that unsubscribes from inside its own callback does
  // not mutate the set being iterated (same defensive copy `mp3-codec.ts`'s
  // `publishHealth` and `failure-log.ts`'s `notifyLog` both make).
  for (const listener of [...generationListeners]) {
    try {
      listener();
    } catch (cause) {
      reportFailure(cause, "storage-pressure-bump");
    }
  }
}

/**
 * The storage-pressure marker for the Books standing-condition slot, or `null`
 * when there is nothing to show. Reads `estimate()` on every mount, and again
 * whenever {@link bumpStoragePressure} fires while this instance is mounted.
 *
 * **Still no cross-mount CACHE.** Books unmounts for the whole time a chapter
 * is open, so every trip home still starts this at `"unknown"` and paints the
 * marker only once a read lands — an effect later, not on the first render.
 * That half of round 6's shape is unchanged; see this module's header for
 * what #542 Part A added instead (a module-scope INVALIDATION, not a cache)
 * and why the two are different claims.
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
 * an explicit `hasReclaimableAudio`/`deleteFailed` parameter rather than as
 * JSX prose in the screen (#542, Frank P2-2 / George P3-5; the predicate
 * itself was `hasContent` through round 1 and is `hasReclaimableAudio` as of
 * Part B; #843 item 4 dropped `loading` and `loadFailed`, which the screen
 * never renders alongside reclaimable audio) — a `ready` parameter on
 * THIS hook was considered and left out: the ordering is the screen's
 * decision, the screen already holds those flags, and this file has just
 * finished removing one parameter that existed for a caller that does not
 * exist yet.
 *
 * **The recorder-close half of #247's fix shape is still not here.** #247 asks
 * for "once on Books mount and after each recorder close". Part A's bump
 * covers book delete/create only (see {@link bumpStoragePressure}); a
 * translator who stays inside one chapter recording segment after
 * segment — Books unmounted the whole time — still sees no change until they
 * come back out. Open on #247.
 *
 * **As of #843 item 2, this effect IS mounted by one test** —
 * `tests/use-storage-pressure-mount.test.ts`, a jsdom `createRoot`/`act()`
 * harness in the shape `tests/use-segment-editor-mount.test.ts` already uses
 * for a different hook — which drives a real mount through a bump and pins
 * that `estimate()` is asked again and the marker updates from the second
 * answer. That test is what pins `generationValue` as load-bearing in the
 * dependency array below. It does NOT independently exercise the `requestGeneration`
 * guard's distinct reason for existing — inside `act()`, React flushes this
 * effect's cleanup (which already sets `cancelled`) before that harness's
 * next assertion runs, so that harness cannot tell `requestGeneration` apart
 * from `cancelled` alone; the gap `requestGeneration` closes is a live-browser
 * timing question between a synchronous listener notification and a React
 * effect re-run, still review and on-device surface, not established by this
 * or any test here. Every pure decision this effect calls into besides is
 * pinned in Node: `storagePressure`, `storagePressureMarker`,
 * `readStorageEstimate`, `storageEstimateSourceOf`, and
 * `bumpStoragePressure`'s own counter/listener contract
 * (`tests/storage-pressure.test.ts`).
 *
 * Read by `books-screen.tsx` (#247's wiring half), through
 * `storagePressureNotice`.
 */
export function useStoragePressure(): StoragePressureMarker | null {
  const [band, setBand] = useState<StoragePressure>("unknown");
  // `useSyncExternalStore`, not a ref, so a bump that lands while this
  // instance is mounted schedules the re-render `useEffect`'s dependency
  // array needs to see a new value at all. The effect below both depends on
  // this value AND reads it (#843 item 2) — see that effect's own comment.
  const generationValue = useSyncExternalStore(
    subscribeToGeneration,
    getGeneration,
    getGeneration
  );

  useEffect(() => {
    // The generation this run is answering for, read now rather than left as
    // a dependency nothing in the body touches (#843 item 2). Two rounds of
    // review named the shape that used to be here a risk precisely because it
    // wasn't a risk yet: `generationValue` sat in the dependency array only to
    // force a re-run, with nothing reading its value, so a "this dependency is
    // unused" cleanup — by a person or an eslint auto-fix — could delete the
    // array entry and nothing in this file would object; before #843 nothing
    // in the test suite mounted this effect, so nothing would have caught it
    // either. Reading the
    // value here, not just depending on it, is the fix: it is now an ordinary
    // used variable, and `tests/use-storage-pressure-mount.test.ts` mounts the
    // hook for real and asserts the re-read that depending on it produces.
    const requestGeneration = generationValue;
    let cancelled = false;
    // `readStorageEstimate` never rejects, so there is no dropped rejection
    // here and no second channel to catch one in.
    void readStorageEstimate(storageEstimateSourceOf(globalThis)).then(
      (reading) => {
        // Two staleness guards, not one, because they close two different
        // gaps. `cancelled` catches this run's OWN cleanup — unmount, or
        // React re-running this effect once a newer `generationValue` has
        // actually been rendered. `requestGeneration` catches what
        // `cancelled` cannot: `bumpStoragePressure` notifies its listeners
        // SYNCHRONOUSLY (see that function below), before React has
        // re-rendered and re-run this effect, so a response that resolves
        // inside that window would otherwise still be applied even though a
        // fresher generation — the reason for the bump — is already known.
        // Comparing against the CURRENT generation, not just this run's own
        // captured one, closes that window; with no cross-mount cache, the
        // only thing applying a superseded reading could do is paint a band
        // that the write which triggered the bump has already made stale.
        if (cancelled) return;
        if (getGeneration() !== requestGeneration) return;
        // #843 item 3 (DRI pick: "Keep last-known band"). `reading === null`
        // is `readStorageEstimate`'s "we could not ask" answer — an absent
        // API, a rejected call, a synchronous throw, or an unusable answer,
        // never a real reading (see that function's own docblock: it never
        // rejects, so `null` is the only failure shape that reaches here).
        // Before this, a failed re-read still called
        // `storagePressure(undefined, undefined)`, which is `"unknown"`, so a
        // transient failure on a bump-triggered re-read (book delete/create)
        // reset an already-shown, still-genuinely-live `"low"`/`"critical"`
        // line to nothing rather than leaving it standing. Skipping `setBand`
        // here leaves `band` at whatever it last held instead.
        //
        // **When there is no last-known band yet** — the FIRST read for this
        // mount fails — `band` is still its `useState` initial value,
        // `"unknown"`, and this skip leaves it exactly there: today's
        // unchanged behaviour for that case, not a new one, because there is
        // no prior band to hold. `tests/use-storage-pressure-mount.test.ts`
        // pins both halves.
        if (reading === null) return;
        setBand(storagePressure(reading.usage, reading.quota));
      }
    );
    return () => {
      cancelled = true;
    };
  }, [generationValue]);

  return storagePressureMarker(band);
}
