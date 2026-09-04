import { useEffect, useState } from "react";

import { storageMarker, type StorageMarker } from "@/lib/storage/persistence";

/**
 * Ask the browser to keep this app's storage, once per launch (#12).
 *
 * `navigator.storage` is a browser API, so it lives here and not in `lib/` —
 * `lib/storage/persistence.ts` holds the decision this hook's answer feeds. The
 * whole sequence is a plain async function over an injected manager, so it is
 * exercised in Node against stubs (the split `performErase` uses); the React
 * half below is the thin part.
 *
 * **The September gate is the request only.** ADR 0002 listed three mitigations
 * for PCM's ~5.3 MB/minute. Transcode-on-Finished shipped in B8, the 22 050 Hz
 * capture rate is deferred, and this is the third — the only one that addresses
 * *loss* rather than size. A nearly-full `estimate()` marker is deliberately not
 * here: it needs a headroom threshold nobody has decided, and sampled once on a
 * screen mount it would go stale while the translator records. #12 carries it.
 */

/**
 * The slice of `navigator.storage` this needs, with both methods optional.
 *
 * Optional is the point: it is what makes "the API is not here" a shape the
 * type system admits rather than a runtime surprise, and it is what lets a test
 * hand in one method, the other, or neither. `StorageManager` satisfies it.
 */
export interface StorageDurabilityManager {
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
}

/**
 * Read whether storage is persisted and, only if it is not, ask for it. Resolves
 * `true`/`false` for a known answer and `undefined` for unknown.
 *
 * **Never rejects.** A durability query is not the translator's work failing, and
 * there is no error channel worth spending on a phone in a village for it — the
 * unknown state the screen already renders (silence) is the honest report. So a
 * rejection becomes `undefined` here rather than an unhandled promise in a
 * mount effect.
 *
 * **Idempotent by construction, not by a flag:** `persisted()` is read first and
 * `persist()` is called only on an explicit `false`, so re-running this against
 * a device that granted the first request makes no second request at all.
 */
export async function ensurePersistedStorage(
  manager: StorageDurabilityManager | undefined
): Promise<boolean | undefined> {
  if (!manager || typeof manager.persisted !== "function") {
    // No API, or no way to read an answer back. Not an error: unknown.
    //
    // A bare `persist()` without `persisted()` is deliberately NOT attempted:
    // some browsers answer a persistence request with a permission prompt, and
    // firing one we cannot read the answer back from would leave a translator
    // with a dialog nobody can explain and us with nothing recorded. No browser
    // is known to expose one method without the other. Not device-verified.
    return undefined;
  }

  let persisted: boolean;
  try {
    persisted = await manager.persisted();
  } catch {
    // Deliberately not reported. See "Never rejects" above: there is no sink
    // for this on a field device, and the screen's silence is already the
    // correct rendering of "we could not ask".
    return undefined;
  }

  if (persisted || typeof manager.persist !== "function") return persisted;

  try {
    return await manager.persist();
  } catch {
    // The query already answered `false`, and that answer still stands — a
    // failed request leaves durability ungranted, not unknown. Swallowed for
    // the same reason as above, and the marker the screen shows is unchanged.
    return false;
  }
}

/**
 * The manager, or `undefined` where there is none — older iOS Safari, and a
 * plain Node test run (Node 22 has a `navigator`, but no `navigator.storage`).
 */
function browserStorageManager(): StorageDurabilityManager | undefined {
  if (typeof navigator === "undefined" || !("storage" in navigator)) {
    return undefined;
  }
  const manager: unknown = navigator.storage;
  return typeof manager === "object" && manager !== null ? manager : undefined;
}

/**
 * One request per page load, shared by every mount.
 *
 * Module scope rather than a ref (the pattern `mp3-codec.ts` uses for its warmed
 * worker): the Books screen unmounts whenever a chapter opens, and "request
 * `persist()` once" must not become once per visit home. Holding the promise
 * rather than a boolean also means a mount that arrives while the first request
 * is still in flight gets that request's answer instead of starting a second.
 */
let request: Promise<boolean | undefined> | null = null;

/**
 * Ask for durable storage once the device holds work worth keeping, and return
 * the marker the screen shows — `null` while unknown or already persisted.
 *
 * **Why this trigger.** The audit's shape is "once after the first successful
 * write", and the save path is another lane's file this week. `hasContent` is
 * that same moment reached from the read side: a book only exists because
 * `createNextBook` committed, so a successful shelf read that finds one *is* a
 * successful write having happened. Asking on an empty shelf would also spend
 * the browser's one-time decision before there is anything to lose.
 *
 * **The answer itself is unknown and must be read off a device.** Whether an
 * installed PWA on Android is granted persistence is not something this
 * repository can determine, and no run has recorded it — #12 stays open on
 * that. This code asks and reports; it does not know what the answer will be.
 *
 * Not covered by any test in this repo: everything below this line. There is no
 * jsdom or renderer here, so the effect and its gating are review and on-device
 * surface, exactly as `useEraseSegment`'s guard is. What IS pinned is
 * `ensurePersistedStorage` and `storageMarker`.
 */
export function useStoragePersistence(
  hasContent: boolean
): StorageMarker | null {
  const [persisted, setPersisted] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    if (!hasContent) return;
    request ??= ensurePersistedStorage(browserStorageManager());
    let cancelled = false;
    // `ensurePersistedStorage` never rejects, so there is no dropped rejection
    // here and no second channel to catch one in.
    void request.then((answer) => {
      if (!cancelled) setPersisted(answer);
    });
    return () => {
      cancelled = true;
    };
  }, [hasContent]);

  return storageMarker(persisted);
}
