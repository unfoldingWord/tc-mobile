import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

/**
 * Where a prepared share File is handed to the operating system (#336).
 *
 * `share-flow.ts` owns *when* a share happens — the two-gesture state machine
 * and the iOS activation contract. This module owns *through what*: the Web
 * Share API in a browser, or Capacitor's Share plugin inside the native shell.
 *
 * Why the split exists. The first external tester's Android APK failed BOTH
 * Share Chapter and Share Book with the generic "try again", while the same
 * build shared fine on an emulator the same day (#336). Web Share in the
 * Android System WebView is version dependent, and the training's borrowed
 * phones will not all carry a current WebView — so inside the shell the file
 * goes out through the native plugin, which needs no Web Share at all.
 *
 * **Not device-verified.** The Filesystem and Share plugin calls are a device
 * boundary: what is covered in `tests/share-target.test.ts` is the route
 * decision and the assembly around those calls, through an injected
 * {@link NativeShareBridge}. The plugin calls themselves have never been run
 * on a phone.
 */

/** The directory, under the OS cache, that holds the files being shared. */
export const SHARE_CACHE_DIR = "tc-mobile-share";

/**
 * How much of the file crosses the bridge at a time.
 *
 * Capacitor's Filesystem takes binary data as base64 on native (`data: string |
 * Blob`, "Blob data is only supported on Web"), so every byte written has to be
 * a JS string at some point. A book zip is tens of megabytes and the File is a
 * Blob the browser backs itself — `use-book-share.ts` builds it from fflate's
 * stream chunks precisely so no archive-sized buffer is ever allocated. Reading
 * it whole would undo that and add ~1.33x of base64 on top, in the JS heap of a
 * 4 GB phone. So it goes a slice at a time and the peak stays ~1.8 MB.
 *
 * A MULTIPLE OF 3 on purpose: base64 encodes three bytes to four characters, so
 * an aligned chunk carries no `=` padding. The plugin decodes each call's data
 * on its own, which would be correct with padding too — but the decoder itself
 * is inside a binary dependency of `@capacitor/filesystem` and cannot be read
 * here, so the alignment removes the question rather than assuming an answer:
 * padding-free chunks concatenate to the original bytes whether the native side
 * decodes per call or joins the strings first.
 */
export const SHARE_CHUNK_BYTES = 768 * 1024;

/** What the platform can do, read at the moment of the decision. */
export interface ShareEnvironment {
  /** Running inside the Capacitor shell (the APK / the iOS app). */
  readonly native: boolean;
  /** The browser has `navigator.share`. */
  readonly webShare: boolean;
  /** The browser's `navigator.canShare`, or null when it has none. */
  readonly canShareFiles: ((file: File) => boolean) | null;
}

/**
 * The plugin calls a {@link NativeShareSession} makes, as an injected boundary so
 * the assembly around them is testable in plain Node. Mirrors the Capacitor
 * plugin signatures minus the parts this module fixes (`Directory.Cache`).
 */
export interface NativeShareBridge {
  /** Create or TRUNCATE `path` and write the first chunk. Returns its file URI. */
  writeFile(options: {
    path: string;
    data: string;
    recursive: boolean;
  }): Promise<{ uri: string }>;
  /** Append a further chunk to a file `writeFile` already created. */
  appendFile(options: { path: string; data: string }): Promise<void>;
  /** Remove a directory and everything in it. */
  rmdir(options: { path: string; recursive: boolean }): Promise<void>;
  /** Open the OS share sheet for the given file URIs. */
  share(options: { files: string[] }): Promise<void>;
}

type ShareRoute = "native" | "web" | "unsupported";

/**
 * Which way this share goes. Called twice per share: once before the encode with
 * `file === null` (so a browser that cannot share at all does not pay for a
 * whole book encode first) and once after, with the File.
 *
 * `native` wins first and WITHOUT consulting `canShare`. Two reasons, and both
 * are the bugs this exists for: the WebView may have no `navigator.share` to
 * gate on (#336), and Android Chrome's Web Share allowlist rejects
 * `application/zip` (#272) while the native `ACTION_SEND` intent carries any
 * MIME type. Neither web capability says anything about the native path.
 */
export function selectShareRoute(
  env: ShareEnvironment,
  file: File | null
): ShareRoute {
  if (env.native) return "native";
  if (!env.webShare) return "unsupported";
  if (file !== null && env.canShareFiles !== null && !env.canShareFiles(file))
    return "unsupported";
  return "web";
}

/**
 * Does a share that RESOLVED prove the file left the phone?
 *
 * On the web route, yes: `navigator.share` rejects a dismissed sheet with
 * `AbortError`, so a resolve means the translator picked a target.
 *
 * On the native route, **no**, and the gap is not closeable from here.
 * `SharePlugin.java`'s `activityResult` rejects a `RESULT_CANCELED` chooser
 * only while `stopped` is false, and `handleOnStop` sets `stopped` the moment
 * the activity stops — a notification, a call, any trip away and back. So a
 * chooser the translator dismissed with Back can resolve as success. That flag
 * cannot be tightened: it is the plugin's PRIMARY success signal, because
 * `ACTION_SEND` targets usually never call `setResult`. `Share.share`'s
 * `activityType` is no way out either — it is empty for a real share whenever
 * the chosen component is not reported, so an empty value distinguishes
 * nothing, which is why it is not threaded through this seam.
 *
 * What follows from it depends entirely on what the caller does with the news.
 * Share Chapter and Share Book lose nothing to a false success — the audio is
 * still in IndexedDB. The held-take rescue (#165) holds the ONLY copy of a
 * recording, so it must not offer a one-tap exit that drops it on a signal that
 * can be false (George stand-in R4 P2).
 */
export function resolveProvesDelivery(route: ShareRoute): boolean {
  return route === "web";
}

/**
 * Probe the platform. Browser globals, so this is the hooks layer's job and it
 * is NOT unit-tested — {@link selectShareRoute} takes the result as data, which
 * is the part with the decisions in it.
 */
export function readShareEnvironment(): ShareEnvironment {
  const hasCanShare = typeof navigator.canShare === "function";
  return {
    native: Capacitor.isNativePlatform(),
    webShare: typeof navigator.share === "function",
    canShareFiles: hasCanShare
      ? (file: File): boolean => navigator.canShare({ files: [file] })
      : null,
  };
}

/** A File already written to the app cache, waiting to be offered to the OS. */
export interface StagedShare {
  /** The `file://` URI the share plugin takes. */
  readonly uri: string;
  /** Its own directory, so abandoning it removes nothing else. */
  readonly dir: string;
}

/** Hands prepared Files to the OS share sheet, and owns the cache they sit in. */
export interface NativeShareSession {
  /**
   * Write the File into the app cache, ready to be offered.
   *
   * **This is the slow half, and it is deliberately separate from {@link send}**
   * (George R5 P2). A book zip is tens of megabytes and crosses the bridge in
   * 768 KB chunks, so this runs for seconds. Every caller already has a place
   * for slow work — `useShareFlow`'s tap 1, which paints `preparing` — and none
   * of them has a place for it in the gesture that opens the sheet. Putting it
   * there made "Share now" look like a dead button and left the flow `ready`
   * while it ran.
   *
   * `signal` aborts it: a menu closed mid-write stops the write and takes the
   * partial file with it.
   */
  stage(file: File, signal?: AbortSignal): Promise<StagedShare>;
  /**
   * Offer an already-staged file to the OS share sheet. The ONLY thing tap 2
   * does on the native route, which is what keeps the menus' "the sheet opens in
   * this gesture" contract true on both routes.
   *
   * **User activation is irrelevant here** — the chooser is started by the
   * plugin as an Android Intent / a `UIActivityViewController`, not by the
   * WebView. The web path's activation contract is `share-flow.ts`'s business
   * and is unchanged.
   */
  send(staged: StagedShare): Promise<void>;
  /** Drop a staged file that will never be offered (the menu closed, unmount). */
  discard(staged: StagedShare): Promise<void>;
}

/**
 * A share session over one bridge.
 *
 * **A share that succeeded is never deleted by this app.** Three rounds of
 * review went looking for a signal that the receiving app had finished reading
 * the file, and there is none: `Share.share` resolves when the chooser activity
 * returns (Frank R2 P1), a process boundary proves nothing because Android can
 * kill the app mid-upload (Frank R3 P2), and neither a count of later shares nor
 * an elapsed day proves consumption either (Frank R5 P1) — Drive can be sitting
 * offline waiting for connectivity. Every one of those was a heuristic standing
 * in for knowledge the app cannot have, and on the held-take rescue (#165) the
 * cost of guessing wrong is the only copy of a recording.
 *
 * So the lifetime belongs to the platform, which is what `Directory.Cache` is
 * for: the OS reclaims it under storage pressure, and the user can clear it from
 * Settings. What this code still owns is the case where nothing was ever handed
 * over — a failed write or a rejected chooser — and it cleans those up at once.
 *
 * **Every share still gets its own directory**, which is what makes concurrent
 * shares safe: Share Chapter and the held-take rescue can be in flight together
 * and neither can write over the other's bytes (Frank R2 P2). The name is a
 * random id, because nothing is ever swept: a directory outlives the process
 * that made it, and a name a later run could reproduce is a name a later run
 * could truncate (Frank R6 P2).
 */
export function createNativeShareSession(
  bridge: NativeShareBridge
): NativeShareSession {
  return {
    async stage(file: File, signal?: AbortSignal): Promise<StagedShare> {
      // A random id, not a sequence or a timestamp (Frank R6 P2). Nothing is
      // ever swept, so a directory outlives the process that made it: a counter
      // restarts at 1 with the app, and `Date.now()` can return a value it has
      // already returned once the clock is corrected backwards. Either way a
      // new share could pick the name of an old one and `writeFile` would
      // TRUNCATE a file a recipient was still reading — on the held-take path,
      // possibly the only exported copy.
      const dir = `${SHARE_CACHE_DIR}/${randomShareId()}`;
      const path = `${dir}/${cacheFilename(file.name)}`;
      try {
        // Checked IMMEDIATELY BEFORE each bridge call, never merely before the
        // read that precedes it (Frank R6 P2). Reading and base64-encoding a
        // 768 KB slice is itself an await, so a cancel arriving during the read
        // would otherwise still buy one more native write — the expensive half —
        // on exactly the slow device this cancel exists for.
        throwIfAborted(signal);
        // `writeFile` truncates, so a repeat of this call over the same path
        // overwrites rather than appending to a partial: safely re-runnable.
        const first = await readChunkBase64(file, 0);
        throwIfAborted(signal);
        const { uri } = await bridge.writeFile({
          path,
          data: first,
          recursive: true,
        });
        for (
          let at = SHARE_CHUNK_BYTES;
          at < file.size;
          at += SHARE_CHUNK_BYTES
        ) {
          throwIfAborted(signal);
          const chunk = await readChunkBase64(file, at);
          throwIfAborted(signal);
          await bridge.appendFile({ path, data: chunk });
        }
        throwIfAborted(signal);
        return { uri, dir };
      } catch (cause) {
        // Nothing reached the OS — the write failed, or it was cancelled — so
        // there is no reader to race: drop this share's own partial file rather
        // than leave a truncated chapter behind.
        await removeDir(bridge, dir);
        throw cause;
      }
    },

    async send(staged: StagedShare): Promise<void> {
      try {
        await bridge.share({ files: [staged.uri] });
      } catch (cause) {
        // The chooser refused or the user dismissed it: nothing was handed to
        // anything, so this file has no reader and goes now. A rejection is the
        // only evidence of that this code ever gets — which is why the resolved
        // case does nothing at all. See the doc comment above: there is no
        // signal that a recipient is finished, so a sent file stays until the OS
        // reclaims the cache.
        await removeDir(bridge, staged.dir);
        throw asDomRejection(cause);
      }
    },

    discard: (staged: StagedShare): Promise<void> =>
      removeDir(bridge, staged.dir),
  };
}

/**
 * 128 random bits as hex, for one staged share's directory.
 *
 * **`getRandomValues`, deliberately not `crypto.randomUUID`** (Frank R6 P2,
 * second pass). `randomUUID` needs Chromium 92 / WebKit 15.4; `getRandomValues`
 * has been there since Chromium 11. This whole PR exists because the Android
 * System WebView on the phone that failed may be OLD (#336), so reaching for
 * the newer API here would put a `TypeError` in the one place the fix has to
 * work. It also means one path rather than a primary and an untested fallback.
 */
function randomShareId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}

/** The abort shape `share-flow.ts` already classifies as a dismissal. */
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true)
    throw new DOMException("Share cancelled", "AbortError");
}

/** The real bridge: Capacitor's Filesystem and Share plugins. */
const capacitorShareBridge: NativeShareBridge = {
  writeFile: ({ path, data, recursive }) =>
    // No `encoding`: that is what tells the plugin the data is base64 and the
    // bytes are binary. Passing Encoding.UTF8 would write the base64 text.
    Filesystem.writeFile({ path, data, directory: Directory.Cache, recursive }),
  appendFile: async ({ path, data }) => {
    await Filesystem.appendFile({ path, data, directory: Directory.Cache });
  },
  rmdir: async ({ path, recursive }) => {
    await Filesystem.rmdir({ path, directory: Directory.Cache, recursive });
  },
  share: async ({ files }) => {
    // `files` only. The same reason `share-flow.ts` passes no `title` to
    // `navigator.share`: the file carries its own name, and a title alongside it
    // is a known share-target trap.
    await Share.share({ files });
  },
};

/**
 * The app's one native share session, so Share Chapter, Share Book and the
 * recorder's held-take rescue all go through the same bridge and the same cache
 * directory.
 */
export const nativeShare: NativeShareSession =
  createNativeShareSession(capacitorShareBridge);

/**
 * Translate a plugin rejection into what `classifyShareError` reads.
 *
 * The Share plugin rejects a chooser the user dismissed with a plain Error
 * reading "Share canceled" — `SharePlugin.java`'s `activityResult`
 * (`RESULT_CANCELED` -> `call.reject("Share canceled")`) and `SharePlugin.swift`
 * line 63. Left alone it would classify as `failed` and show a translator an
 * error for tapping Back, which is the one outcome that is not news.
 */
function asDomRejection(cause: unknown): unknown {
  if (cause instanceof Error && /^share cancell?ed$/i.test(cause.message))
    return new DOMException(cause.message, "AbortError");
  return cause;
}

async function removeDir(
  bridge: NativeShareBridge,
  path: string
): Promise<void> {
  try {
    await bridge.rmdir({ path, recursive: true });
  } catch {
    // Deliberately no channel, and it never rejects. This only ever runs on a
    // share that failed, where the wanted state is "the directory is not
    // there" and the caller is already throwing the real cause; `rmdir` also
    // rejects for the ordinary case that the write never created the directory
    // at all. A failure here costs cache bytes the OS can reclaim — never a
    // wrong file shared, and never a share that does not happen.
  }
}

/** Read `[at, at + SHARE_CHUNK_BYTES)` of the file as base64. */
async function readChunkBase64(file: File, at: number): Promise<string> {
  const end = Math.min(at + SHARE_CHUNK_BYTES, file.size);
  const bytes = new Uint8Array(await file.slice(at, end).arrayBuffer());
  let binary = "";
  // `String.fromCharCode` takes its bytes as arguments, and a spread of a
  // megabyte of them overflows the call stack. 32 768 is the usual safe stride.
  const STRIDE = 0x8000;
  for (let i = 0; i < bytes.length; i += STRIDE)
    binary += String.fromCharCode(...bytes.subarray(i, i + STRIDE));
  return btoa(binary);
}

/**
 * A path segment safe to write and good enough to name the file the recipient
 * receives — the FileProvider serves it under this name, so it is translator-
 * facing, not just internal.
 *
 * `filenameSafe` (lib/utils) already sanitises the book name the copy is built
 * from, but the whole `file.name` reaches the filesystem here, so the narrower
 * guarantee is made where it is needed. Replacing every separator is what makes
 * a walk out of the share directory impossible; collapsing runs of dots and
 * refusing a leading one are defence in depth — a `..` segment cannot form once
 * there is no separator to bound it, and a dotfile is not a name to hand a
 * translator. The extension survives, because Android's share intent reads the
 * MIME type off it (`SharePlugin.getMimeType`).
 */
function cacheFilename(name: string): string {
  const cleaned = name
    .replace(/[^A-Za-z0-9._ -]/g, "_")
    .replace(/\.{2,}/g, ".")
    .trim();
  if (cleaned === "" || cleaned === ".") return "share";
  return cleaned.startsWith(".") ? `share${cleaned}` : cleaned;
}
