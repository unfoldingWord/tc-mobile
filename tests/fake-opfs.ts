import type { SpoolDirectory } from "@/hooks/archive-spool";

/**
 * An in-memory stand-in for the slice of the origin private file system that
 * `hooks/archive-spool.ts` uses (#1003). Node has no OPFS, so this is what the
 * spool's tests run against; it is not evidence about any browser's OPFS.
 *
 * It is deliberately a WORSE disk than a real `FileSystemWritableFileStream`:
 * writes are not queued, each one lands when its own latency elapses, so two
 * overlapping writes can land out of order. A spool that relied on the
 * stream's own queue for order would pass in a browser and corrupt here. A
 * write's bytes are copied at call time, as a browser's are.
 */
export interface FakeOpfsOptions {
  /** Leave `createWritable` off the file handle (older WebKit). */
  readonly noCreateWritable?: boolean;
  /** Reject `createWritable` with this. */
  readonly createWritableError?: Error;
  /** Reject the `n`th write (1-based) with a `QuotaExceededError`-shaped error. */
  readonly failWriteAt?: number;
  /** Reject every `removeEntry` with this. */
  readonly removeError?: Error;
  /** Milliseconds before a write of `bytes` lands. Default: none. */
  readonly latency?: (bytes: number) => number;
}

interface FakeEntry {
  /** What a `getFile()` reads: the last committed contents. */
  committed: Uint8Array<ArrayBuffer>;
}

export interface FakeOpfs {
  /** Hand this to `openArchiveSpool` / `spoolArchive`. */
  readonly source: () => Promise<SpoolDirectory>;
  /** Names of the files in the spool directory right now. */
  files(): string[];
  /** How many writes were in progress at once, at most. */
  maxConcurrentWrites(): number;
  /** Writables aborted so far. */
  aborted(): number;
}

const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function fakeOpfs(options: FakeOpfsOptions = {}): FakeOpfs {
  const dirs = new Map<string, Map<string, FakeEntry>>();
  let concurrent = 0;
  let maxConcurrent = 0;
  let writes = 0;
  let aborts = 0;

  const directory = (entries: Map<string, FakeEntry>): SpoolDirectory => ({
    getDirectoryHandle: async (name, { create }) => {
      let child = dirs.get(name);
      if (!child) {
        if (!create) throw new DOMException(name, "NotFoundError");
        child = new Map();
        dirs.set(name, child);
      }
      return directory(child);
    },
    getFileHandle: async (name, { create }) => {
      let entry = entries.get(name);
      if (!entry) {
        if (!create) throw new DOMException(name, "NotFoundError");
        entry = { committed: new Uint8Array(0) };
        entries.set(name, entry);
      }
      const file = entry;
      const createWritable = async () => {
        if (options.createWritableError) throw options.createWritableError;
        // A swap buffer: written at each write's own landing time, committed on
        // close, dropped on abort — what the browser's swap file does.
        const swap: { at: number; bytes: Uint8Array }[] = [];
        let offset = 0;
        let state: "open" | "closed" | "aborted" = "open";
        return {
          write: async (chunk: Uint8Array<ArrayBuffer>) => {
            if (state !== "open") throw new TypeError(`writable is ${state}`);
            const n = ++writes;
            const bytes = chunk.slice();
            // Where this write goes is decided when it LANDS, like an
            // unqueued append: an earlier write still in flight lands after.
            concurrent++;
            maxConcurrent = Math.max(maxConcurrent, concurrent);
            try {
              await pause(options.latency?.(bytes.length) ?? 0);
              if (options.failWriteAt === n)
                throw new DOMException("disk full", "QuotaExceededError");
              swap.push({ at: offset, bytes });
              offset += bytes.length;
            } finally {
              concurrent--;
            }
          },
          close: async () => {
            if (state !== "open") throw new TypeError(`writable is ${state}`);
            state = "closed";
            const out = new Uint8Array(offset);
            for (const { at, bytes } of swap) out.set(bytes, at);
            file.committed = out;
          },
          abort: async () => {
            state = "aborted";
            aborts++;
          },
        };
      };
      return {
        ...(options.noCreateWritable ? {} : { createWritable }),
        getFile: async () => new File([file.committed], name),
      };
    },
    removeEntry: async (name) => {
      if (options.removeError) throw options.removeError;
      if (!entries.delete(name)) throw new DOMException(name, "NotFoundError");
    },
  });

  const root = directory(new Map());
  return {
    source: () => Promise.resolve(root),
    files: () => [...dirs.values()].flatMap((entries) => [...entries.keys()]),
    maxConcurrentWrites: () => maxConcurrent,
    aborted: () => aborts,
  };
}
