/**
 * Where a share's zip lands while it is being built (#1003).
 *
 * `lib/export/book.ts` streams the archive to an injected `ArchiveSink` as it
 * is produced. This is the browser half: a spool file in the origin private
 * file system (OPFS, `navigator.storage.getDirectory()`), written chunk by
 * chunk, so a Psalms-sized book no longer sits in memory until the share sheet
 * takes it. The File handed to the sheet is read back from that spool file.
 *
 * **Where there is no usable OPFS, the spool is memory** — the same chunks in
 * an array that Share Book always kept, so nothing is lost but the saving. That
 * is chosen by feature detection, not by platform: no `navigator.storage`, no
 * `getDirectory`, a `getDirectory` that refuses (some private windows do), or
 * a file handle with no `createWritable` (WebKit shipped OPFS years before it
 * shipped `createWritable` on the main thread). None of those is a failure, so
 * none is reported; the share goes ahead from memory.
 *
 * **Which of those a Capacitor WebView or a given phone takes is not known
 * here.** Nothing in this file has run on a phone, and whether the Android
 * System WebView and WKWebView expose a writable OPFS on the phones in the
 * field is the device check on #1002, not a claim this module makes.
 *
 * **The spool's lifetime is the share's.** The builder that opened it releases
 * it when the export returns nothing, is cancelled or throws; once it is handed
 * to `useShareFlow` as a prepared File, the flow releases it when that File is
 * done with — staged to the native cache, handed to the sheet, dismissed,
 * failed, or abandoned by a reset or unmount (`share-flow.ts`). A spool left by
 * a page that was killed mid-share is NOT swept; see the PR for #1003.
 */

import { reportFailure } from "./report-failure";
import { randomShareId } from "./share-target";
import { type ArchiveSink, memoryArchiveSink } from "@/lib/export/book";

/** The OPFS directory every spool file lives in, and nothing else does. */
const SPOOL_DIR = "tc-mobile-share-spool";

/** The part of a `FileSystemWritableFileStream` the spool uses. */
interface SpoolWritable {
  write(chunk: Uint8Array<ArrayBuffer>): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

/** The part of a `FileSystemFileHandle` the spool uses. */
interface SpoolFileHandle {
  /** Absent where OPFS exists without main-thread writes (older WebKit). */
  readonly createWritable?: () => Promise<SpoolWritable>;
  getFile(): Promise<File>;
}

/** The part of a `FileSystemDirectoryHandle` the spool uses. */
export interface SpoolDirectory {
  getDirectoryHandle(
    name: string,
    options: { create: boolean }
  ): Promise<SpoolDirectory>;
  getFileHandle(
    name: string,
    options: { create: boolean }
  ): Promise<SpoolFileHandle>;
  removeEntry(name: string): Promise<void>;
}

/** An archive being written somewhere, and how to get it back as one File. */
interface ArchiveSpool {
  /** Hand this to the export. */
  readonly sink: ArchiveSink;
  /**
   * Wait for every write, close the spool and return the archive as a File
   * named `name`. Call once, after the export resolved with a result. Rejects
   * if a write or the close failed.
   */
  finish(name: string, type: string): Promise<File>;
  /**
   * Drop the spool: abort an unfinished write and delete the file. Idempotent
   * and never rejects — a failed delete is reported to the failure funnel as
   * `"share-spool-release"`, because what it leaves behind is an archive-sized
   * file nobody will read. A File already returned by `finish` must not be
   * read after this.
   */
  release(): Promise<void>;
}

/** Where the root directory comes from. Injected so Node can test the spool. */
export type SpoolRootSource = () => Promise<SpoolDirectory> | undefined;

/**
 * The page's OPFS root, or `undefined` where the API is absent. The one place
 * this module reads a browser global.
 */
const opfsRoot: SpoolRootSource = () => {
  const storage = globalThis.navigator?.storage as
    { getDirectory?: () => Promise<SpoolDirectory> } | undefined;
  return typeof storage?.getDirectory === "function"
    ? storage.getDirectory()
    : undefined;
};

/** Is this a DOMException-shaped `NotFoundError`? */
function isNotFound(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    (cause as { name?: unknown }).name === "NotFoundError"
  );
}

function memorySpool(): ArchiveSpool {
  let sink: ReturnType<typeof memoryArchiveSink> | null = memoryArchiveSink();
  const released = new Error("archive spool already released");
  return {
    sink: {
      write: (chunk) => (sink ? sink.write(chunk) : Promise.reject(released)),
    },
    finish: (name, type) => {
      if (!sink) return Promise.reject(released);
      // The chunks go to `File` as parts: the browser assembles the Blob, and
      // no archive-sized buffer is built here on top of them.
      return Promise.resolve(new File([...sink.chunks], name, { type }));
    },
    release: () => {
      // Dropping the one reference is the whole release: the chunks are
      // garbage once the File (if any) is gone too.
      sink = null;
      return Promise.resolve();
    },
  };
}

/**
 * The OPFS spool, or `null` when this browser cannot give one — the caller
 * falls back to memory. Every refusal on the way (no root, a root that
 * rejects, no `createWritable`, a `createWritable` that rejects) lands here as
 * `null`, and a file entry already created for it is removed first.
 */
async function opfsSpool(
  source: SpoolRootSource
): Promise<ArchiveSpool | null> {
  let dir: SpoolDirectory;
  let handle: SpoolFileHandle;
  const name = `${randomShareId()}.zip`;
  try {
    const root = source();
    if (root === undefined) return null;
    dir = await (await root).getDirectoryHandle(SPOOL_DIR, { create: true });
    handle = await dir.getFileHandle(name, { create: true });
  } catch {
    // Not an error to report: a browser that exposes OPFS and then refuses it
    // (a private window) is one of the documented reasons to use memory, and
    // the share still goes ahead. See the header.
    return null;
  }
  let writable: SpoolWritable;
  try {
    if (typeof handle.createWritable !== "function")
      throw new TypeError("createWritable is not available");
    writable = await handle.createWritable();
  } catch {
    // The same fallback as above, one step later: an OPFS without main-thread
    // writes. The empty entry `getFileHandle` just created is removed rather
    // than left in the directory.
    await removeSpoolFile(dir, name);
    return null;
  }

  // Writes run strictly one after another, in call order — the `ArchiveSink`
  // contract — because the export hands over an entry's chunks in one burst.
  // A failed write poisons the chain: every later write rejects too, so a
  // half-written archive can never be closed and shared.
  let tail: Promise<void> = Promise.resolve();
  let state: "open" | "closed" | "released" = "open";
  let releasing: Promise<void> | null = null;
  return {
    sink: {
      write: (chunk) => {
        tail = tail.then(() => {
          if (state !== "open")
            throw new Error(`archive spool is ${state}, cannot write`);
          return writable.write(chunk);
        });
        return tail;
      },
    },
    finish: async (fileName, type) => {
      await tail;
      if (state !== "open")
        throw new Error(`archive spool is ${state}, cannot finish`);
      await writable.close();
      state = "closed";
      const file = await handle.getFile();
      // Re-wrapped for the name and type the share needs; the spool's own
      // entry name is a random id. A File made from a Blob refers to that
      // Blob's bytes (here, the spool file on disk) rather than reading them.
      return new File([file], fileName, { type });
    },
    release: () =>
      (releasing ??= (async () => {
        const wasOpen = state === "open";
        state = "released";
        // Let a write still running settle first; its outcome no longer
        // matters, only that nothing is writing while the file goes.
        await tail.catch(() => undefined);
        if (wasOpen) {
          try {
            await writable.abort();
          } catch {
            // An abort that fails leaves at most the browser's own swap file,
            // which it discards with the stream; the entry itself is removed
            // just below either way, and that removal is what gets reported.
          }
        }
        await removeSpoolFile(dir, name);
      })()),
  };
}

/** Delete one spool file; a failure other than "already gone" is reported. */
async function removeSpoolFile(
  dir: SpoolDirectory,
  name: string
): Promise<void> {
  try {
    await dir.removeEntry(name);
  } catch (cause) {
    if (isNotFound(cause)) return;
    console.error("Could not remove a share spool file", cause);
    reportFailure(cause, "share-spool-release");
  }
}

/**
 * Open a spool for one archive: OPFS where this browser allows it, memory
 * otherwise. Never rejects.
 */
export async function openArchiveSpool(
  source: SpoolRootSource = opfsRoot
): Promise<ArchiveSpool> {
  return (await opfsSpool(source)) ?? memorySpool();
}

/** A built archive: the export's own result, its File, and how to drop it. */
interface SpooledArchive<T> {
  readonly result: T;
  readonly file: File;
  /** {@link ArchiveSpool.release}: call once the File is done with. */
  readonly release: () => Promise<void>;
}

/**
 * Run one archive export into a fresh spool and return its File, or `null`
 * when the export did (nothing to share, or cancelled). The one way Share Book
 * and Share your work build their zips, so the ownership rule is written once:
 * on `null` or a throw the spool is released here, before this returns; on a
 * result it is the caller's, through `release`.
 */
export async function spoolArchive<T>(
  build: (sink: ArchiveSink) => Promise<T | null>,
  fileName: string,
  type: string,
  source: SpoolRootSource = opfsRoot
): Promise<SpooledArchive<T> | null> {
  const spool = await openArchiveSpool(source);
  try {
    const result = await build(spool.sink);
    if (result === null) {
      await spool.release();
      return null;
    }
    const file = await spool.finish(fileName, type);
    return { result, file, release: spool.release };
  } catch (cause) {
    await spool.release();
    throw cause;
  }
}
