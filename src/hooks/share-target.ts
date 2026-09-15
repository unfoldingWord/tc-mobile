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
 * How many completed shares keep their file before the oldest is removed.
 *
 * A share sheet gives no signal that the receiving app has finished reading the
 * file — `Share.share` resolves when the chooser activity returns, which can be
 * well before Drive has uploaded what it was handed. So the lifetime is
 * measured in user actions rather than in milliseconds: a directory is removed
 * only once {@link SHARE_RETAINED} further shares have each been prepared,
 * offered, and dismissed. Two is not enough to be comfortable and ten is
 * hoarding; three bounds the cache at three shares while putting two complete
 * round trips between a hand-off and its cleanup.
 */
export const SHARE_RETAINED = 3;

/**
 * How old a share's directory must be before a later session removes it.
 *
 * Within a session, {@link SHARE_RETAINED} counts completed user round trips.
 * Across sessions there are no round trips to count, and a process boundary
 * proves nothing: Android can kill the app while the target app is still
 * uploading what the chooser handed it (Frank R3 P2). So a later run judges a
 * leftover by its age, which the directory name carries.
 *
 * A day. A background upload still unfinished after that has failed for reasons
 * a deleted cache file will not change, and it bounds the cache to one day of
 * shares. A device clock that moves backwards makes a directory look newer than
 * it is, which errs towards keeping bytes rather than deleting them.
 */
export const SHARE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

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
  /** Name every entry directly inside a directory. */
  readdir(options: { path: string }): Promise<{ names: string[] }>;
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

/** Hands prepared Files to the OS share sheet, and owns the cache they sit in. */
export interface NativeShareSession {
  /**
   * Write the File into the app cache and offer it to the OS share sheet.
   *
   * **User activation is irrelevant here** — the chooser is started by the
   * plugin as an Android Intent / a `UIActivityViewController`, not by the
   * WebView, so none of the awaits inside cost anything the way they would on
   * the Web Share path. `share-flow.ts`'s two-gesture contract exists for that
   * path and is unchanged.
   */
  share(file: File): Promise<void>;
}

/**
 * A share session over one bridge.
 *
 * The cache lifetime lives here rather than in module variables so that two
 * callers cannot get two different views of it, and so a test gets a clean one
 * per case instead of whatever the previous case left behind.
 *
 * **Every share gets its own directory.** That is what makes concurrent shares
 * safe — Share Chapter and the recorder's held-take rescue can be in flight at
 * once, and neither can write over or delete the other's bytes (Frank R2 P2).
 * Nothing in the active path removes a directory other than its own, and a
 * completed share's file is removed only once {@link SHARE_RETAINED} further
 * shares have finished, never the moment the chooser returns — `Share.share`
 * resolves when the chooser activity returns, which can be before the receiving
 * app has read what it was handed (Frank R2 P1). For the held-take rescue those
 * may be the only surviving bytes of a recording.
 *
 * **Restarting the app proves nothing either** (Frank R3 P2). Android can kill
 * the app while the target is still uploading, so a previous run's leftovers
 * are not automatically safe to delete. The startup sweep is therefore by AGE,
 * read out of the directory name, not by "some other process made it".
 */
export function createNativeShareSession(
  bridge: NativeShareBridge
): NativeShareSession {
  // One sweep per session, shared as a promise rather than latched with a
  // boolean: a second share starting while the first is still sweeping must
  // WAIT for it, not skip it and write into a directory the sweep is about to
  // remove.
  let sweep: Promise<void> | null = null;
  // Completed shares, oldest first. A directory enters only after its own share
  // resolved, so an in-flight share's directory is never a pruning candidate.
  const completed: string[] = [];
  let sequence = 0;

  return {
    async share(file: File): Promise<void> {
      sequence += 1;
      // Unique per share AND across runs — the timestamp is what makes the name
      // survivable as an age, which is the only evidence a later run has about
      // whether a directory is still being read. `sharedAt` parses it back.
      const dir = `${SHARE_CACHE_DIR}/${sequence}-${Date.now().toString(36)}`;
      const path = `${dir}/${cacheFilename(file.name)}`;
      sweep ??= sweepAgedOut(bridge);
      await sweep;
      let uri: string;
      try {
        // `writeFile` truncates, so a repeat of this call over the same path
        // overwrites rather than appending to a partial: safely re-runnable.
        const first = await readChunkBase64(file, 0);
        uri = (await bridge.writeFile({ path, data: first, recursive: true }))
          .uri;
        for (
          let at = SHARE_CHUNK_BYTES;
          at < file.size;
          at += SHARE_CHUNK_BYTES
        )
          await bridge.appendFile({
            path,
            data: await readChunkBase64(file, at),
          });
      } catch (cause) {
        // Nothing reached the OS, so there is no reader to race: drop this
        // share's own partial file rather than leave a truncated chapter.
        await removeDir(bridge, dir);
        throw cause;
      }
      try {
        await bridge.share({ files: [uri] });
      } catch (cause) {
        await removeDir(bridge, dir);
        throw asDomRejection(cause);
      }
      completed.push(dir);
      while (completed.length > SHARE_RETAINED) {
        const stale = completed.shift();
        if (stale !== undefined) await removeDir(bridge, stale);
      }
    },
  };
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
  readdir: async ({ path }) => {
    const { files } = await Filesystem.readdir({
      path,
      directory: Directory.Cache,
    });
    return { names: files.map((file) => file.name) };
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
 * The app's one native share session. A single instance on purpose: the cache
 * retention window above is only a bound if every caller shares it, so Share
 * Chapter, Share Book and the recorder's held-take rescue all go through this.
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

/**
 * Remove the leftovers of earlier sessions that are old enough to be certainly
 * finished with — and nothing else. Runs once per session, before the first
 * write, and never rejects: a cache that could not be listed is not a reason to
 * refuse a share.
 */
async function sweepAgedOut(bridge: NativeShareBridge): Promise<void> {
  const now = Date.now();
  let names: readonly string[];
  try {
    names = (await bridge.readdir({ path: SHARE_CACHE_DIR })).names;
  } catch {
    // The share directory has never existed (the first share after an install)
    // or could not be listed. Either way this session has nothing it may
    // remove, and the next `writeFile` creates the directory it needs.
    return;
  }
  for (const name of names) {
    const at = sharedAt(name);
    // `null` means the name was not written by this code — so its age is
    // unknown, and an unknown age is not a licence to delete someone's audio.
    if (at !== null && now - at > SHARE_MAX_AGE_MS)
      await removeDir(bridge, `${SHARE_CACHE_DIR}/${name}`);
  }
}

/** When the share that made this directory started, or null if unreadable. */
function sharedAt(name: string): number | null {
  const stamp = /^\d+-([0-9a-z]+)$/.exec(name)?.[1];
  if (stamp === undefined) return null;
  const at = Number.parseInt(stamp, 36);
  return Number.isFinite(at) && at > 0 ? at : null;
}

async function removeDir(
  bridge: NativeShareBridge,
  path: string
): Promise<void> {
  try {
    await bridge.rmdir({ path, recursive: true });
  } catch {
    // Deliberately no channel, and it never rejects. The wanted state is "the
    // directory is not there", and `rmdir` rejects for the ordinary case that
    // it never existed (the first share after an install) as loudly as for a
    // real failure. Every share writes to a path of its own, so a failure here
    // costs cache bytes the OS can reclaim — never a wrong file shared, and
    // never a share that does not happen.
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
