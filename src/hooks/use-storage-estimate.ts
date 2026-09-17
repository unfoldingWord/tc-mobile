import { useEffect, useState } from "react";

/**
 * How full this origin's storage is, straight off `navigator.storage.
 * estimate()` — #247, the deferred half of #12's audit. `lib/storage/
 * pressure.ts` turns this into the three-state read the Books screen shows;
 * this file owns only the browser call, matching how `use-storage-
 * persistence.ts` owns `navigator.storage.persist()`/`persisted()` and leaves
 * the decision to `lib/storage/persistence.ts`.
 *
 * **Called once per Books mount, not on a timer or after every write.** The
 * issue's fix shape asks for "once on Books mount and after each recorder
 * close (the writes happen there)". The recorder closes while the Segments
 * screen owns it, and `App.tsx` unmounts `BooksScreen` for the whole time a
 * chapter is open (`chapterId === null` is what mounts it) — so there is no
 * recorder-close moment at which this hook's own component is even mounted to
 * re-fire from. Reaching the recorder's close from here would mean lifting an
 * estimate-refresh trigger up through `App.tsx` and threading it back down as
 * a prop `BooksScreen` does not otherwise need, for a screen that already
 * unmounts and remounts on every trip through a chapter. Scoped to
 * Books-mount-only for v1: `BooksScreen` remounts every time the translator
 * returns to it — including right after closing the recorder and stepping
 * Back out of the chapter — so the common "just recorded, now home" path
 * still gets a fresh read; what is missing is a re-read that fires the
 * INSTANT the recorder closes while the translator stays inside the same
 * chapter recording segment after segment. That gap is real and open on #247.
 */

/** The slice of `navigator.storage` this needs. Optional, like `use-storage-
 * persistence.ts`'s `StorageDurabilityManager`, so "the API is not here" is a
 * shape the type system admits. `StorageManager` satisfies it. */
export interface StorageEstimateSource {
  estimate?: () => Promise<{ usage?: number; quota?: number }>;
}

/** `usage`/`quota` exactly as `StorageEstimate` returns them — both already
 * optional in the spec itself, not just when the API is absent. */
export interface StorageEstimateReading {
  readonly usage: number | undefined;
  readonly quota: number | undefined;
}

/**
 * Read one estimate. **Never rejects** — a coarse origin-storage estimate is
 * not the translator's work failing (same reasoning as
 * `ensurePersistedStorage`), so an absent API or a rejected call both become
 * `null` rather than an unhandled rejection in a mount effect.
 */
export async function readStorageEstimate(
  source: StorageEstimateSource | undefined
): Promise<StorageEstimateReading | null> {
  if (!source || typeof source.estimate !== "function") return null;
  try {
    const { usage, quota } = await source.estimate();
    return { usage, quota };
  } catch {
    // Deliberately not reported — see the docblock above. `null` is the
    // honest "we could not ask", the same rendering `storagePressure`'s
    // undefined-input branch already gives an absent reading.
    return null;
  }
}

/** The manager, or `undefined` where there is none — matches
 * `use-storage-persistence.ts`'s `browserStorageManager`. */
function browserStorageSource(): StorageEstimateSource | undefined {
  if (typeof navigator === "undefined" || !("storage" in navigator)) {
    return undefined;
  }
  const manager: unknown = navigator.storage;
  return typeof manager === "object" && manager !== null ? manager : undefined;
}

/**
 * The Books screen's storage-pressure reading, refreshed once every time this
 * mounts. `null` while unknown (no API, a rejected call, or not yet resolved)
 * — `lib/storage/pressure.ts`'s `storagePressure` already reads an unknown
 * `usage`/`quota` as `"ok"`, so a caller can pass this straight through
 * without a separate null check.
 *
 * Not covered by any test in this repo: everything below this line. There is
 * no jsdom or renderer here (same limitation `useStoragePersistence`'s own
 * docblock names) — only `readStorageEstimate` and `storagePressure` are
 * pinned in Node.
 */
export function useStorageEstimate(): StorageEstimateReading | null {
  const [reading, setReading] = useState<StorageEstimateReading | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readStorageEstimate(browserStorageSource()).then((result) => {
      if (!cancelled) setReading(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return reading;
}
