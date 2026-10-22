/**
 * THROWAWAY (#1520). The HTML page the hidden web view loads with the old
 * Capacitor origin as its base URL. It reads the old app's IndexedDB and
 * never writes to it:
 *
 * - it lists the databases the page can see (`indexedDB.databases()`);
 * - it opens `tc-mobile` WITHOUT a version, so it never upgrades it, and
 *   aborts the open if the database does not exist (`oldVersion === 0`), so
 *   it never creates an empty one at the old origin;
 * - it counts every object store;
 * - it exports the first `clipData` entry to native code as base64 chunks
 *   (react-native-webview messages must be strings).
 *
 * The page reports `location.origin` first. That one value answers the iOS
 * question in the research note (§4.3): whether a page loaded with base URL
 * `capacitor://localhost`, with no scheme handler registered, runs at that
 * origin at all.
 */

const DB_NAME = "tc-mobile";
/** A multiple of 3, so every chunk is valid base64 on its own. */
const CHUNK_BYTES = 3 * 64 * 1024;

const script = `
(function () {
  var DB_NAME = ${JSON.stringify(DB_NAME)};
  var CHUNK_BYTES = ${CHUNK_BYTES};
  function post(o) { window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
  function fail(stage, e) { post({ type: "error", stage: stage, message: String(e && (e.name + ": " + e.message) || e) }); }
  function req(r) { return new Promise(function (res, rej) { r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }
  function toBase64(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }
  async function run() {
    post({ type: "origin", origin: String(location.origin), href: String(location.href), indexedDB: typeof indexedDB });
    if (typeof indexedDB === "undefined") { fail("indexedDB", "indexedDB is undefined at this origin"); return; }
    var list = [];
    var hasDatabases = typeof indexedDB.databases === "function";
    if (hasDatabases) {
      try { list = (await indexedDB.databases()).map(function (d) { return { name: d.name, version: d.version }; }); }
      catch (e) { fail("databases", e); }
    }
    post({ type: "databases", hasDatabases: hasDatabases, list: list });

    var db;
    try {
      db = await new Promise(function (res, rej) {
        var open = indexedDB.open(DB_NAME);
        open.onupgradeneeded = function (ev) {
          if (ev.oldVersion === 0) { open.transaction.abort(); }
        };
        open.onsuccess = function () { res(open.result); };
        open.onerror = function () { rej(open.error); };
        open.onblocked = function () { rej(new Error("open blocked")); };
      });
    } catch (e) {
      post({ type: "no-database", message: String(e && (e.name + ": " + e.message) || e) });
      return;
    }

    var names = Array.prototype.slice.call(db.objectStoreNames);
    var counts = {};
    try {
      var tx = db.transaction(names, "readonly");
      for (var i = 0; i < names.length; i++) {
        counts[names[i]] = await req(tx.objectStore(names[i]).count());
      }
    } catch (e) { fail("count", e); }
    post({ type: "counts", name: db.name, version: db.version, counts: counts });

    if (names.indexOf("clipData") < 0) { post({ type: "no-clip" }); db.close(); return; }
    try {
      var tx2 = db.transaction(names.indexOf("clipMeta") >= 0 ? ["clipData", "clipMeta"] : ["clipData"], "readonly");
      var cursor = await req(tx2.objectStore("clipData").openCursor());
      if (!cursor) { post({ type: "no-clip" }); db.close(); return; }
      var key = cursor.key;
      var value = cursor.value;
      var meta = null;
      if (names.indexOf("clipMeta") >= 0) { meta = await req(tx2.objectStore("clipMeta").get(key)); }
      var bytes = value instanceof ArrayBuffer ? new Uint8Array(value)
        : ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        : null;
      if (!bytes) { fail("clip", "clipData value is not binary: " + Object.prototype.toString.call(value)); db.close(); return; }
      var total = Math.ceil(bytes.length / CHUNK_BYTES);
      post({ type: "clip-begin", key: String(key), byteLength: bytes.length, chunks: total,
        meta: meta && { encoding: meta.encoding, sampleRate: meta.sampleRate, durationMs: meta.durationMs, byteLength: meta.byteLength } });
      for (var c = 0; c < total; c++) {
        post({ type: "clip-chunk", index: c, b64: toBase64(bytes.subarray(c * CHUNK_BYTES, (c + 1) * CHUNK_BYTES)) });
      }
      post({ type: "clip-end", chunks: total });
    } catch (e) { fail("clip", e); }
    db.close();
  }
  run().catch(function (e) { fail("run", e); });
})();
`;

export const probeHtml = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>${script}</script></body></html>`;

/** Each message the page posts, parsed. */
export type ProbeMessage =
  | { type: "origin"; origin: string; href: string; indexedDB: string }
  | {
      type: "databases";
      hasDatabases: boolean;
      list: { name?: string; version?: number }[];
    }
  | { type: "no-database"; message: string }
  | {
      type: "counts";
      name: string;
      version: number;
      counts: Record<string, number>;
    }
  | { type: "no-clip" }
  | {
      type: "clip-begin";
      key: string;
      byteLength: number;
      chunks: number;
      meta: {
        encoding?: string;
        sampleRate?: number;
        durationMs?: number;
        byteLength?: number;
      } | null;
    }
  | { type: "clip-chunk"; index: number; b64: string }
  | { type: "clip-end"; chunks: number }
  | { type: "error"; stage: string; message: string };
