/**
 * The phone check's browser side (#1009): the probes that need `navigator`,
 * IndexedDB, the encoder worker and `sessionStorage`. The arithmetic, the
 * report and the allocation loop are pure and live in `lib/phone-check/`.
 *
 * ── It never touches the app's data ──
 *
 * The storage probe opens its OWN database, {@link PHONE_CHECK_DB_NAME}, with
 * `idb` directly, and deletes it before it returns — on success and on failure.
 * Nothing in this file imports `lib/storage/db.ts`, which owns the app's
 * database. `tests/phone-check-storage.test.ts` spies on `indexedDB.open` and
 * fails if any other name is opened while the check runs.
 *
 * ── Failures ──
 *
 * A probe that throws is reported through the app's one funnel,
 * `reportFailure(cause, "phone-check")`, and becomes a `failed` outcome
 * carrying the error's name for the report. An allocation that fails is NOT a
 * failure in that sense — it is the measurement — so the memory ceiling
 * reports it only in its result.
 */
import { deleteDB, openDB } from "idb";

import { withEncoder } from "./mp3-codec";
import { reportFailure } from "./report-failure";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import {
  errorName,
  parseBreadcrumb,
  serializeBreadcrumb,
  type AllocationBreadcrumb,
  type AllocationDeps,
} from "@/lib/phone-check/allocation";
import { runEncodeProbe } from "@/lib/phone-check/encode-probe";
import {
  MB,
  type DeviceInfo,
  type EncodeResult,
  type ProbeOutcome,
  type StorageResult,
} from "@/lib/phone-check/report";
import { ENCODE_PROBE_SECONDS, speechLikePcm } from "@/lib/phone-check/speech";

/** The `reportFailure` context for everything the phone check raises. */
export const PHONE_CHECK_CONTEXT = "phone-check";

/** The throwaway database. Never the app's (`"tc-mobile"`, `lib/storage/db.ts`). */
export const PHONE_CHECK_DB_NAME = "tc-mobile-phone-check";

/** How much PCM the storage probe writes and reads back (#1009: ~50 MB). */
const STORAGE_PROBE_BYTES = 50 * MB;

/** One record's size: about a minute of canonical PCM, the size of a long take. */
const STORAGE_PROBE_CHUNK_BYTES = 5 * MB;

const STORE = "chunks";

/** Run a probe; a throw is reported to the funnel and becomes a `failed` outcome. */
export async function settleProbe<T>(
  run: () => Promise<T>
): Promise<ProbeOutcome<T>> {
  try {
    return { status: "ok", value: await run() };
  } catch (cause) {
    reportFailure(cause, PHONE_CHECK_CONTEXT);
    return { status: "failed", errorName: errorName(cause) };
  }
}

/** The slice of `navigator` the device probe reads, so a test can hand in its own. */
export interface DeviceSource {
  readonly userAgent?: string;
  readonly deviceMemory?: number;
  readonly hardwareConcurrency?: number;
  readonly storage?: {
    readonly estimate?: () => Promise<{ quota?: number; usage?: number }>;
    readonly persisted?: () => Promise<boolean>;
  };
}

function finiteOrNull(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** What the phone says about itself. A method the browser lacks reads as `null`. */
export async function readDeviceInfo(
  source: DeviceSource
): Promise<DeviceInfo> {
  const estimate = source.storage?.estimate
    ? await source.storage.estimate()
    : null;
  const persisted = source.storage?.persisted
    ? await source.storage.persisted()
    : null;
  return {
    userAgent: source.userAgent ?? "",
    deviceMemoryGb: finiteOrNull(source.deviceMemory),
    cores: finiteOrNull(source.hardwareConcurrency),
    quotaBytes: finiteOrNull(estimate?.quota),
    usageBytes: finiteOrNull(estimate?.usage),
    persisted: typeof persisted === "boolean" ? persisted : null,
  };
}

/**
 * Five minutes of synthetic speech through the REAL worker codec, on the
 * app's one encoder lane (`withEncoder`, ADR 0009) — so it waits behind a
 * transcode already running, and a failure here counts toward encoder health
 * exactly as any other encode does. The samples are built before the clock
 * starts; only the encode is timed.
 */
export function runWorkerEncodeProbe(): Promise<EncodeResult> {
  const samples = speechLikePcm(ENCODE_PROBE_SECONDS);
  return withEncoder(undefined, (codec) =>
    runEncodeProbe(codec, samples, CANONICAL_SAMPLE_RATE, () =>
      performance.now()
    )
  );
}

/** A read-back that did not return what was written. */
class StorageReadbackError extends Error {
  override name = "StorageReadbackError";
}

/** A fill that is never constant, so a read-back of the wrong bytes is caught. */
function chunkSample(chunk: number, i: number): number {
  return ((i * 31 + chunk * 7) % 32_000) - 16_000;
}

export interface StorageProbeOptions {
  readonly bytes?: number;
  readonly chunkBytes?: number;
  readonly now?: () => number;
}

/**
 * Write `bytes` of PCM to the throwaway database, one record per transaction
 * (as a take commit is), read every record back, check it, and delete the
 * database. The delete runs on every path out, including a throw, so a failed
 * run leaves nothing on the phone.
 */
export async function runStorageProbe(
  options: StorageProbeOptions = {}
): Promise<StorageResult> {
  const bytes = options.bytes ?? STORAGE_PROBE_BYTES;
  const chunkBytes = options.chunkBytes ?? STORAGE_PROBE_CHUNK_BYTES;
  const now = options.now ?? (() => performance.now());
  const chunkSamples = Math.floor(chunkBytes / 2);
  const chunks = Math.max(1, Math.ceil(bytes / chunkBytes));

  // A database left by a run the page died in the middle of.
  await deleteDB(PHONE_CHECK_DB_NAME);
  const db = await openDB(PHONE_CHECK_DB_NAME, 1, {
    upgrade(upgrading) {
      upgrading.createObjectStore(STORE);
    },
  });
  try {
    const writeStart = now();
    for (let c = 0; c < chunks; c++) {
      const samples = new Int16Array(chunkSamples);
      for (let i = 0; i < chunkSamples; i++) samples[i] = chunkSample(c, i);
      const tx = db.transaction(STORE, "readwrite");
      await Promise.all([tx.store.put(samples, c), tx.done]);
    }
    const writeMs = now() - writeStart;

    const readStart = now();
    for (let c = 0; c < chunks; c++) {
      const value: unknown = await db.get(STORE, c);
      const last = chunkSamples - 1;
      if (
        !(value instanceof Int16Array) ||
        value.length !== chunkSamples ||
        value[0] !== chunkSample(c, 0) ||
        value[last] !== chunkSample(c, last)
      ) {
        throw new StorageReadbackError(`chunk ${c} did not read back`);
      }
    }
    const readMs = now() - readStart;

    return { bytes: chunks * chunkSamples * 2, writeMs, readMs };
  } finally {
    db.close();
    await deleteDB(PHONE_CHECK_DB_NAME);
  }
}

/** Where the memory ceiling leaves its breadcrumb. */
export const ALLOCATION_BREADCRUMB_KEY = "tc-mobile:phone-check:allocation";

/** The slice of `Storage` the breadcrumb uses. */
export type BreadcrumbStore = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

/**
 * `sessionStorage`, or `null` where reading it throws (a blocked or private
 * context) — the ceiling still runs there, it just cannot survive a reload.
 */
export function sessionBreadcrumbStore(): BreadcrumbStore | null {
  try {
    return window.sessionStorage;
  } catch (cause) {
    reportFailure(cause, PHONE_CHECK_CONTEXT);
    return null;
  }
}

/** The breadcrumb a page that died mid-ceiling left behind, if any. */
export function readAllocationBreadcrumb(
  store: BreadcrumbStore | null
): AllocationBreadcrumb | null {
  if (store === null) return null;
  try {
    return parseBreadcrumb(store.getItem(ALLOCATION_BREADCRUMB_KEY));
  } catch (cause) {
    reportFailure(cause, PHONE_CHECK_CONTEXT);
    return null;
  }
}

/** Write the breadcrumb, or clear it with `null`. Never throws. */
export function writeAllocationBreadcrumb(
  store: BreadcrumbStore | null,
  crumb: AllocationBreadcrumb | null
): void {
  if (store === null) return;
  try {
    if (crumb === null) store.removeItem(ALLOCATION_BREADCRUMB_KEY);
    else store.setItem(ALLOCATION_BREADCRUMB_KEY, serializeBreadcrumb(crumb));
  } catch (cause) {
    reportFailure(cause, PHONE_CHECK_CONTEXT);
  }
}

/**
 * The real allocator for the ceiling: `Int16Array`s, each one TOUCHED once per
 * 4 KB page so the memory is committed rather than merely reserved, all held
 * until {@link release} is called.
 */
export function browserAllocationDeps(
  store: BreadcrumbStore | null,
  onStep: (attemptingMb: number) => void
): AllocationDeps & { readonly release: () => void } {
  let held: Int16Array[] = [];
  return {
    allocate(mb) {
      const block = new Int16Array((mb * MB) / 2);
      for (let i = 0; i < block.length; i += 2048) block[i] = 1;
      held.push(block);
    },
    writeBreadcrumb: (crumb) => writeAllocationBreadcrumb(store, crumb),
    yieldTurn: () => new Promise((resolve) => setTimeout(resolve, 0)),
    onStep,
    release() {
      held = [];
    },
  };
}
