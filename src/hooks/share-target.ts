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

/** The directory, under the OS cache, that holds the file being shared. */
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
 * The plugin calls {@link shareFileNatively} makes, as an injected boundary so
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
  /** Remove the share directory and everything in it. */
  rmdir(options: { path: string; recursive: boolean }): Promise<void>;
  /** Open the OS share sheet for the given file URIs. */
  share(options: { files: string[] }): Promise<void>;
}

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
): "native" | "web" | "unsupported" {
  if (env.native) return "native";
  if (!env.webShare) return "unsupported";
  if (file !== null && env.canShareFiles !== null && !env.canShareFiles(file))
    return "unsupported";
  return "web";
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

/**
 * Hand a prepared File to the OS through the native share sheet.
 *
 * Write it into the app's own cache, share the resulting `file://` URI, and
 * leave the cache clean. **User activation is irrelevant here** — the chooser is
 * started by the plugin as an Android Intent / a `UIActivityViewController`, not
 * by the WebView, so none of the awaits below cost anything the way they would
 * on the Web Share path. `share-flow.ts`'s two-gesture contract exists for that
 * path and is unchanged.
 */
export async function shareFileNatively(
  file: File,
  bridge: NativeShareBridge
): Promise<void> {
  const path = `${SHARE_CACHE_DIR}/${cacheFilename(file.name)}`;
  // Clear the PREVIOUS share, not this one. Deleting the file the moment the
  // chooser returns would race a target app that reads the content URI after
  // its activity finishes (Drive queues the upload), so the cleanup is deferred
  // to the next share instead — one file at a time, in an OS-reclaimable cache.
  await clearShareCache(bridge);
  let uri: string;
  try {
    // `writeFile` truncates, so re-sharing the same chapter overwrites rather
    // than appending to what a previous run left: the whole sequence is safely
    // re-runnable.
    const first = await readChunkBase64(file, 0);
    uri = (await bridge.writeFile({ path, data: first, recursive: true })).uri;
    for (let at = SHARE_CHUNK_BYTES; at < file.size; at += SHARE_CHUNK_BYTES) {
      await bridge.appendFile({ path, data: await readChunkBase64(file, at) });
    }
  } catch (cause) {
    // Nothing reached the OS, so there is no reader to race: drop the partial
    // file now rather than leave a truncated chapter in the cache.
    await clearShareCache(bridge);
    throw cause;
  }
  try {
    await bridge.share({ files: [uri] });
  } catch (cause) {
    await clearShareCache(bridge);
    throw asDomRejection(cause);
  }
}

/** The real bridge: Capacitor's Filesystem and Share plugins. */
export const capacitorShareBridge: NativeShareBridge = {
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

async function clearShareCache(bridge: NativeShareBridge): Promise<void> {
  try {
    await bridge.rmdir({ path: SHARE_CACHE_DIR, recursive: true });
  } catch {
    // Deliberately no channel. The wanted state is "the directory is not
    // there", and `rmdir` rejects for the ordinary case that it never existed
    // (the first share after an install) as loudly as for a real failure. The
    // `writeFile` below truncates whatever it reuses either way, so failing
    // here costs cache bytes the OS can reclaim, never a wrong file shared.
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
