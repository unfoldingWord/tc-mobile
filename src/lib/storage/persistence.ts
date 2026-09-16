/**
 * What the Books screen says about storage durability — one decision, in one
 * place, so it can be pinned in plain Node (#12).
 *
 * `db.ts` calls IndexedDB this app's system of record, "not a cache". The
 * browser does not agree: until a persistence request is granted, the origin's
 * storage is best-effort and may be evicted when the device runs low on space.
 * There is no import or restore path in this repository and the only egress is
 * a lossy MP3 share that cannot be read back, so an eviction is total. The
 * request itself lives at the browser boundary in `hooks/`; this module owns
 * only the reading of its answer.
 *
 * Like `hooks/save-failure.ts` and `components/processing-status.ts`, the words
 * a translator sees live in `strings.ts`. This picks only which state applies.
 */

/**
 * A durability state worth showing. A union with one member on purpose: #12's
 * deferred half — a nearly-full `estimate()` — lands beside `"not-persisted"`
 * here rather than at the call sites.
 */
export type StorageMarker = "not-persisted";

/**
 * The marker for a `navigator.storage.persisted()` answer, or `null` when there
 * is nothing to say.
 *
 * Three parameters, not one, after George round 1 (#214 P2-1, P2-1-native):
 *
 * - `persisted`. **Three states, not two.** `undefined` is **unknown**, and
 *   unknown is silence: `navigator.storage` may not exist (the iOS Safari
 *   case), and a query can reject. Writing this as `!persisted` would put an
 *   eviction warning in front of every translator on a device we simply could
 *   not ask — a claim with no evidence behind it, on the one platform this
 *   repo has actually run on. Only an explicit `false` — the browser saying it
 *   has not promised to keep this data — is a candidate for the marker.
 * - `hasContent`. The same gate `useStoragePersistence` uses to decide whether
 *   to *ask* also has to gate whether to *show*: `persisted` is instance state
 *   that outlives the book it was read for, so a book deleted down to an empty
 *   shelf (#344, or a second tab's `dropBookCard`) must not keep showing "may
 *   delete your recordings" over the empty-shelf invite. `false` from a stale
 *   read is not evidence about a shelf that no longer has anything on it.
 * - `native`. The Capacitor training APK's storage is not evicted the way a
 *   browser tab's is (`docs/research/native-packaging.md`), and Share already
 *   makes this same distinction via `Capacitor.isNativePlatform()`
 *   (`hooks/share-target.ts`). `persist()` is still requested inside the
 *   shell — harmless, and free insurance if it ever runs on the browser
 *   storage stack under the hood — but the browser-eviction copy would be
 *   simply false there, so the marker never shows. In-shell
 *   `navigator.storage` behaviour is unobserved on a device; owed on #245.
 */
export function storageMarker(
  persisted: boolean | undefined,
  hasContent: boolean,
  native: boolean
): StorageMarker | null {
  if (native || !hasContent) return null;
  return persisted === false ? "not-persisted" : null;
}
