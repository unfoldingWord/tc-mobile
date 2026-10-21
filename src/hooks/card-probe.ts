/**
 * THROWAWAY spike probe for #1472 (E7 microSD), on `spike/card-store` only.
 * Never merged, never shipped to testers. The native half is
 * `CardProbePlugin.java`. Reached only from the phone check on a native
 * Android build (`components/card-probe-panel.tsx`).
 *
 * It does not import `lib/storage` and never opens the app's database: the
 * IndexedDB baseline uses its own database and deletes it afterwards.
 * Every function returns a plain JSON-able object the panel prints; the
 * tester pastes those lines into the spike sheet
 * (`docs/native/card-spike-sheet.md`).
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
import { Filesystem } from "@capacitor/filesystem";
import { deleteDB, openDB } from "idb";

import { SHARE_CHUNK_BYTES } from "./share-target";

interface Volume {
  path: string | null;
  removable?: boolean;
  state?: string;
  uuid?: string | null;
  freeBytes?: number;
}

interface CardProbe {
  volumes(): Promise<{ sdk: number; model: string; volumes: Volume[] }>;
  events(): Promise<{ events: { t: number; what: string }[] }>;
  writeStart(o: { dir: string; name: string }): Promise<void>;
  writeChunk(o: { data: string }): Promise<void>;
  writeCommit(): Promise<{ path: string; bytes: number; syncRenameMs: number }>;
  writeAbandon(): Promise<void>;
  list(o: { dir: string }): Promise<{ files: string[] }>;
  remove(o: { path: string }): Promise<{ deleted: boolean }>;
  fill(o: { path: string; bytes: number }): Promise<{ bytes: number }>;
  readChunk(o: {
    path: string;
    at: number;
    length: number;
  }): Promise<{ data: string; size: number }>;
  crc32(o: { path: string }): Promise<{ crc: number; bytes: number }>;
  pickTree(): Promise<{ uri: string }>;
  grants(): Promise<{
    grants: { uri: string; write: boolean; resolves: boolean }[];
  }>;
  treeWrite(o: {
    uri: string;
    name: string;
    bytes: number;
  }): Promise<{ ms: number; sizeAfter: number }>;
}

const probe = registerPlugin<CardProbe>("CardProbe");

const MB = 1024 * 1024;
const PCM_BYTES_PER_MINUTE = 5.3 * MB;
const IDB_NAME = "tc-mobile-card-probe";

/** Whether the probe's native half can exist here (a native Android shell). */
export function cardProbeAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

/** Run one probe step and return a printable line; a typed native code shows as `code`. */
export async function runStep(
  label: string,
  step: () => Promise<unknown>
): Promise<string> {
  try {
    return `${label} ${JSON.stringify(await step())}`;
  } catch (cause) {
    const e = cause as { code?: string; message?: string };
    return `${label} FAILED ${JSON.stringify({ code: e.code ?? null, message: e.message ?? String(cause) })}`;
  }
}

/** The card's app folder: the first removable, mounted volume `volumes()` names. */
async function cardDir(): Promise<string> {
  const { volumes } = await probe.volumes();
  const card = volumes.find((v) => v.path && v.removable);
  if (!card?.path) throw new Error("no removable volume reported");
  return card.path;
}

function heapMb(): number | null {
  const m = (performance as unknown as { memory?: { usedJSHeapSize: number } })
    .memory;
  return m ? Math.round(m.usedJSHeapSize / MB) : null;
}

function chunkBase64(seed: number): string {
  const bytes = new Uint8Array(SHARE_CHUNK_BYTES);
  for (let i = 0; i < bytes.length; i += 251) bytes[i] = (i + seed) & 0xff;
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** P2: `minutes` of PCM in 384 KiB base64 chunks, then fsync and rename. */
export async function writeSpeed(minutes: number) {
  const total = Math.round(minutes * PCM_BYTES_PER_MINUTE);
  const dir = await cardDir();
  let peak = heapMb() ?? 0;
  const t0 = performance.now();
  let written = 0;
  await probe.writeStart({ dir, name: `speed-${minutes}.bin` });
  for (let n = 0; written < total; n++) {
    const data = chunkBase64(n);
    await probe.writeChunk({ data });
    written += SHARE_CHUNK_BYTES;
    peak = Math.max(peak, heapMb() ?? 0);
  }
  const commit = await probe.writeCommit();
  return {
    minutes,
    bytes: commit.bytes,
    wallMs: Math.round(performance.now() - t0),
    syncRenameMs: commit.syncRenameMs,
    heapPeakMb: heapMb() === null ? null : peak,
    path: commit.path,
  };
}

/** P2 baseline: the same bytes into a throwaway IndexedDB, deleted afterwards. */
export async function idbBaseline(minutes: number) {
  const total = Math.round(minutes * PCM_BYTES_PER_MINUTE);
  const db = await openDB(IDB_NAME, 1, {
    upgrade: (d) => d.createObjectStore("c"),
  });
  try {
    const t0 = performance.now();
    for (let at = 0, n = 0; at < total; at += SHARE_CHUNK_BYTES, n++) {
      await db.put("c", new Uint8Array(SHARE_CHUNK_BYTES), n);
    }
    return { minutes, wallMs: Math.round(performance.now() - t0) };
  } finally {
    db.close();
    await deleteDB(IDB_NAME);
  }
}

/** P3: native CRC32 against a chunked base64 read and a `fetch` read, timed. */
export async function readBack(path: string) {
  const ref = await probe.crc32({ path });
  let t0 = performance.now();
  const crcB64 = new CrcAccumulator();
  for (let at = 0; at < ref.bytes; at += SHARE_CHUNK_BYTES) {
    const { data } = await probe.readChunk({
      path,
      at,
      length: SHARE_CHUNK_BYTES,
    });
    crcB64.add(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)));
  }
  const base64Ms = Math.round(performance.now() - t0);
  t0 = performance.now();
  const res = await fetch(Capacitor.convertFileSrc(`file://${path}`));
  const crcFetch = new CrcAccumulator();
  crcFetch.add(new Uint8Array(await res.arrayBuffer()));
  const fetchMs = Math.round(performance.now() - t0);
  return {
    nativeCrc: ref.crc,
    base64: { crc: crcB64.value(), ms: base64Ms },
    fetch: { crc: crcFetch.value(), ms: fetchMs, status: res.status },
    identical: crcB64.value() === ref.crc && crcFetch.value() === ref.crc,
  };
}

class CrcAccumulator {
  private static table: Uint32Array | null = null;
  private crc = 0xffffffff;
  add(bytes: Uint8Array) {
    const table = (CrcAccumulator.table ??= Uint32Array.from(
      { length: 256 },
      (_, n) => {
        let c = n;
        for (let k = 0; k < 8; k++)
          c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        return c >>> 0;
      }
    ));
    for (const b of bytes)
      this.crc = table[(this.crc ^ b) & 0xff]! ^ (this.crc >>> 8);
  }
  value(): number {
    return (this.crc ^ 0xffffffff) >>> 0;
  }
}

/** P11: does `@capacitor/filesystem` write a full card path, or prompt or fail? */
export async function filesystemFullPath() {
  const path = `${await cardDir()}/fs-probe.txt`;
  const out = await Filesystem.writeFile({ path, data: "probe" });
  return { uri: out.uri };
}

/** P6: fill the card to leave `leaveMb` free, then write a 10 minute take. */
export async function cardFull(leaveMb: number) {
  const dir = await cardDir();
  const before = (await probe.volumes()).volumes.find((v) => v.path === dir);
  const bytes = Math.max(0, (before?.freeBytes ?? 0) - leaveMb * MB);
  await probe.fill({ path: `${dir}/filler.bin`, bytes });
  const free = (await probe.volumes()).volumes.find((v) => v.path === dir);
  return { freeBefore: before?.freeBytes, freeAfterFill: free?.freeBytes };
}

export const cardProbe = {
  probe,
  cardDir,
  list: async () => probe.list({ dir: await cardDir() }),
};
