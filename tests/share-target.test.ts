import { describe, expect, it } from "vitest";

import {
  SHARE_CACHE_DIR,
  SHARE_CHUNK_BYTES,
  type NativeShareBridge,
  type NativeShareSession,
  type ShareEnvironment,
  createNativeShareSession,
  resolveProvesDelivery,
  selectShareRoute,
  sharePlatformFrom,
} from "@/hooks/share-target";

/**
 * #336 — where a prepared share File is handed to the OS.
 *
 * The first external tester's Android APK failed BOTH Share Chapter and Share
 * Book with the generic "try again", while the same build shared fine on an
 * emulator. The gate is `share-flow.ts`'s `typeof navigator.share === "function"`
 * check, and Web Share support in the Android System WebView is version
 * dependent — so inside the Capacitor shell the share has to go through the
 * native plugin instead of the WebView's Web Share.
 *
 * What is node-testable is the part that decides and the part that assembles:
 * `selectShareRoute` (native vs web vs unsupported) and the share session (cache
 * write, chunking, share, and the lifetime of the file afterwards), the latter
 * through an injected {@link NativeShareBridge}. The plugin calls themselves —
 * Capacitor's Filesystem and Share — are a device boundary and are NOT covered
 * here.
 *
 * Every case builds its own session, so the cache lifetime one case exercises
 * cannot leak into the next.
 */

const WEB_ONLY: ShareEnvironment = {
  native: false,
  webShare: true,
  canShareFiles: null,
};

const mp3 = (bytes = 8): File =>
  new File([new Uint8Array(bytes)], "Genesis - Chapter 1.mp3", {
    type: "audio/mpeg",
  });

const zip = (): File =>
  new File([new Uint8Array(8)], "Genesis.zip", { type: "application/zip" });

interface BridgeCall {
  readonly op: "rmdir" | "write" | "append" | "share";
  readonly path?: string;
  readonly data?: string;
  readonly recursive?: boolean;
  readonly files?: readonly string[];
}

/** The directory a recorded write or share went to. */
const dirOf = (call: BridgeCall | undefined): string =>
  (call?.path ?? call?.files?.[0] ?? "").replace(/\/[^/]*$/, "");

const uriFor = (path: string): string => `file:///data/cache/${path}`;

interface Harness {
  readonly session: NativeShareSession;
  /** stage + send — the sequence both callers run, one gesture apart. */
  readonly share: (file: File, signal?: AbortSignal) => Promise<void>;
  readonly calls: BridgeCall[];
}

/**
 * A session over a bridge that records every call. Each `fails` entry makes that
 * operation reject — more than one, because a cleanup and the failure it is
 * cleaning up after can go wrong together.
 */
function harness(
  ...fails: readonly { op: BridgeCall["op"]; cause: unknown }[]
): Harness {
  const calls: BridgeCall[] = [];
  const maybeFail = (op: BridgeCall["op"]): void => {
    const fail = fails.find((candidate) => candidate.op === op);
    if (fail !== undefined) throw fail.cause;
  };
  const bridge: NativeShareBridge = {
    rmdir: async ({ path, recursive }) => {
      calls.push({ op: "rmdir", path, recursive });
      maybeFail("rmdir");
    },
    writeFile: async ({ path, data, recursive }) => {
      calls.push({ op: "write", path, data, recursive });
      maybeFail("write");
      return { uri: uriFor(path) };
    },
    appendFile: async ({ path, data }) => {
      calls.push({ op: "append", path, data });
      maybeFail("append");
    },
    share: async ({ files }) => {
      calls.push({ op: "share", files });
      maybeFail("share");
    },
  };
  const session = createNativeShareSession(bridge);
  return {
    session,
    share: async (file, signal) => {
      await session.send(await session.stage(file, signal));
    },
    calls,
  };
}

/** Re-assemble the bytes the bridge was asked to write, in call order. */
function writtenBytes(calls: readonly BridgeCall[]): Uint8Array {
  const binary = calls
    .filter((call) => call.op === "write" || call.op === "append")
    .map((call) => atob(call.data ?? ""))
    .join("");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

describe("selectShareRoute", () => {
  it("routes through the native plugin inside the Capacitor shell, whatever the WebView offers", () => {
    // #336 exactly: the System WebView exposes no `navigator.share`, so the web
    // gate would fail before any file is offered and both shares dead-end.
    const shell: ShareEnvironment = {
      native: true,
      webShare: false,
      canShareFiles: null,
    };
    expect(selectShareRoute(shell, null)).toBe("native");
    expect(selectShareRoute(shell, mp3())).toBe("native");
  });

  it("routes natively even when canShare rejects the file — #272's zip", () => {
    // Android Chrome's Web Share allowlist has no `application/zip`, which is
    // what made Share Book fail there. The native intent carries any MIME, so
    // the plugin path must not consult `canShare` at all.
    const shell: ShareEnvironment = {
      native: true,
      webShare: true,
      canShareFiles: () => false,
    };
    expect(selectShareRoute(shell, zip())).toBe("native");
  });

  it("keeps the browser on the Web Share path when it has one", () => {
    expect(selectShareRoute(WEB_ONLY, null)).toBe("web");
    expect(selectShareRoute(WEB_ONLY, mp3())).toBe("web");
    expect(
      selectShareRoute({ ...WEB_ONLY, canShareFiles: () => true }, mp3())
    ).toBe("web");
  });

  it("reports unsupported when a browser has no Web Share at all", () => {
    expect(selectShareRoute({ ...WEB_ONLY, webShare: false }, null)).toBe(
      "unsupported"
    );
  });

  it("reports unsupported when the browser refuses this particular file", () => {
    expect(
      selectShareRoute({ ...WEB_ONLY, canShareFiles: () => false }, zip())
    ).toBe("unsupported");
  });

  it("does not consult canShare at the pre-encode gate, where there is no file yet", () => {
    // The pre-encode gate exists so a browser with no Web Share does not pay for
    // a whole book encode first. It has no File to offer, so `canShare` must not
    // be asked (and must not be asked with a stand-in File either).
    let asked = 0;
    const env: ShareEnvironment = {
      ...WEB_ONLY,
      canShareFiles: () => {
        asked += 1;
        return false;
      },
    };
    expect(selectShareRoute(env, null)).toBe("web");
    expect(asked).toBe(0);
  });
});

describe("resolveProvesDelivery", () => {
  it("trusts a web resolve — navigator.share rejects a dismissal", () => {
    expect(resolveProvesDelivery("web", "web")).toBe(true);
  });

  it("does NOT trust a native resolve, so nothing destructive may hang off it", () => {
    // George stand-in R4 P2. `SharePlugin.java`'s `activityResult` rejects a
    // RESULT_CANCELED chooser only while `stopped` is false, and `handleOnStop`
    // sets `stopped` on any activity stop — a notification, a call. So a chooser
    // dismissed with Back can resolve as success. The held-take rescue (#165)
    // holds the only copy of a recording and offers a SINGLE-tap Done off this
    // signal, which is why it must read false here.
    expect(resolveProvesDelivery("native", "android")).toBe(false);
  });

  it("does not treat an unsupported route as delivery either", () => {
    expect(resolveProvesDelivery("unsupported", "ios")).toBe(false);
  });
});

describe("the native share session", () => {
  it("chunks on a boundary base64 cannot pad", () => {
    // Load-bearing and otherwise unasserted (George stand-in R4 P3-4): the
    // per-chunk decodes in these tests are independent, so they cannot observe
    // padding, and an unaligned chunk would only corrupt the file if the native
    // side joined the base64 strings before decoding. The alignment is what
    // makes that question moot; nothing else pins it.
    expect(SHARE_CHUNK_BYTES % 3).toBe(0);
  });

  it("writes the file into a directory of its own and hands that uri to the plugin", async () => {
    const { share, calls } = harness();
    await share(mp3());

    const write = calls.find((call) => call.op === "write");
    expect(write?.path).toMatch(
      new RegExp(`^${SHARE_CACHE_DIR}/[0-9a-f]{32}/Genesis_-_Chapter_1\\.mp3$`)
    );
    // Neither the share directory nor this share's own directory exists yet.
    expect(write?.recursive).toBe(true);
    expect(calls.at(-1)).toEqual({
      op: "share",
      files: [uriFor(write?.path ?? "")],
    });
  });

  it("never removes a share that succeeded, however many follow it", async () => {
    // Frank R5 P1, and the end of a three-round chain. `Share.share` resolving
    // does not prove the recipient read the file (R2 P1); neither does a process
    // boundary (R3 P2); and neither does a count of later shares or an elapsed
    // day (R5 P1) — Drive can be sitting offline waiting for connectivity. Every
    // such rule was a heuristic standing in for knowledge this app cannot have,
    // and on the held-take rescue (#165) guessing wrong costs the only copy of a
    // recording. So a successful share is never deleted here at all: the cache
    // directory is the platform's to reclaim.
    const { share, calls } = harness();
    for (let i = 0; i < 6; i += 1) await share(mp3());
    expect(calls.filter((call) => call.op === "share")).toHaveLength(6);
    expect(calls.some((call) => call.op === "rmdir")).toBe(false);
  });

  it("gives every share a name no other share can reuse, across sessions too", async () => {
    // Frank R6 P2. Nothing is swept, so a directory outlives the process that
    // made it — and a name a later run could reproduce is a name a later run
    // could TRUNCATE, out from under a recipient still reading it. A per-session
    // counter restarts at 1 with the app and `Date.now()` repeats itself once
    // the clock is corrected backwards, so neither can carry this. Two separate
    // sessions stand in for two runs of the app.
    const first = harness();
    const second = harness();
    await first.share(mp3());
    await second.share(mp3());

    const dirs = [...first.calls, ...second.calls]
      .filter((call) => call.op === "write")
      .map((call) => dirOf(call));
    expect(dirs).toHaveLength(2);
    expect(new Set(dirs).size).toBe(2);
    for (const dir of dirs)
      expect(dir).toMatch(new RegExp(`^${SHARE_CACHE_DIR}/[0-9a-f]{32}$`));
  });

  it("gives two concurrent shares separate directories, and neither removes the other's", async () => {
    // Frank R2 P2. Share Chapter and the recorder's held-take rescue can be in
    // flight at once; a single shared directory let one recursively delete the
    // other mid-write.
    const calls: BridgeCall[] = [];
    let releaseFirstWrite!: () => void;
    const firstWriteGate = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    let writes = 0;
    const bridge: NativeShareBridge = {
      rmdir: async ({ path, recursive }) => {
        calls.push({ op: "rmdir", path, recursive });
      },
      writeFile: async ({ path, data, recursive }) => {
        calls.push({ op: "write", path, data, recursive });
        writes += 1;
        if (writes === 1) await firstWriteGate;
        return { uri: uriFor(path) };
      },
      appendFile: async ({ path, data }) => {
        calls.push({ op: "append", path, data });
      },
      share: async ({ files }) => {
        calls.push({ op: "share", files });
      },
    };
    const session = createNativeShareSession(bridge);
    const stageThenSend = async (file: File): Promise<void> => {
      await session.send(await session.stage(file));
    };

    const first = stageThenSend(mp3());
    const second = stageThenSend(zip());
    releaseFirstWrite();
    await Promise.all([first, second]);

    const writePaths = calls
      .filter((call) => call.op === "write")
      .map((call) => call.path ?? "");
    expect(writePaths).toHaveLength(2);
    expect(dirOf({ op: "write", path: writePaths[0] })).not.toBe(
      dirOf({ op: "write", path: writePaths[1] })
    );
    // Neither removed anything: the sweep found no aged-out leftovers, and a
    // successful share is never removed at all.
    expect(calls.some((call) => call.op === "rmdir")).toBe(false);
    expect(calls.filter((call) => call.op === "share")).toHaveLength(2);
  });

  it("stops a cancelled write before the sheet, and takes the partial with it", async () => {
    // George R5 P2. The staging write is the slow half — a book zip in 768 KB
    // chunks — and it now runs on tap 1, where closing the menu is a normal
    // thing to do. `reset()` aborts; nothing may reach the OS after that, and
    // the half-written file must not be left behind.
    const { session, calls } = harness();
    const controller = new AbortController();
    controller.abort();

    const cause = await session
      .stage(mp3(), controller.signal)
      .catch((error: unknown) => error);

    expect(cause).toBeInstanceOf(DOMException);
    expect((cause as DOMException).name).toBe("AbortError");
    // Aborted before it started: nothing written, nothing offered.
    expect(calls.some((call) => call.op === "write")).toBe(false);
    expect(calls.some((call) => call.op === "share")).toBe(false);
  });

  it("stops a write cancelled between chunks, and removes what it had written", async () => {
    // The reachable case: the menu closes while a multi-chunk zip is going over
    // the bridge. The loop must not start another chunk, and the partial file
    // must not survive as a truncated chapter.
    const calls: BridgeCall[] = [];
    const controller = new AbortController();
    const bridge: NativeShareBridge = {
      rmdir: async ({ path, recursive }) => {
        calls.push({ op: "rmdir", path, recursive });
      },
      writeFile: async ({ path, data, recursive }) => {
        calls.push({ op: "write", path, data, recursive });
        // The translator taps the scrim just as the first chunk lands.
        controller.abort();
        return { uri: uriFor(path) };
      },
      appendFile: async ({ path, data }) => {
        calls.push({ op: "append", path, data });
      },
      share: async ({ files }) => {
        calls.push({ op: "share", files });
      },
    };
    const session = createNativeShareSession(bridge);
    const big = new File(
      [new Uint8Array(SHARE_CHUNK_BYTES * 3)],
      "Genesis.zip"
    );

    await expect(session.stage(big, controller.signal)).rejects.toThrow(
      DOMException
    );

    const written = dirOf(calls.find((call) => call.op === "write"));
    // The first chunk went; the other two never started.
    expect(calls.some((call) => call.op === "append")).toBe(false);
    expect(calls.some((call) => call.op === "share")).toBe(false);
    expect(calls.at(-1)).toEqual({
      op: "rmdir",
      path: written,
      recursive: true,
    });
  });

  it("does not write a chunk when the cancel lands while that chunk is being read", async () => {
    // Frank R6 P2. Reading and base64-encoding 768 KB is itself an await, so
    // checking the signal only BEFORE the read left a window in which a cancel
    // still bought one native write — the expensive half, on the slow device the
    // cancel exists for.
    const { session, calls } = harness();
    const controller = new AbortController();
    const file = mp3(16);
    const read = file.slice.bind(file);
    Object.defineProperty(file, "slice", {
      value: (...args: Parameters<Blob["slice"]>) => {
        // The menu closes while this chunk is being read.
        controller.abort();
        return read(...args);
      },
    });

    await expect(session.stage(file, controller.signal)).rejects.toThrow(
      DOMException
    );

    expect(calls.some((call) => call.op === "write")).toBe(false);
    expect(calls.some((call) => call.op === "share")).toBe(false);
  });

  it("discards a staged file the caller decided never to send", async () => {
    // What `reset()` and unmount call when a menu closes on an armed share.
    const { session, calls } = harness();
    const staged = await session.stage(mp3());
    expect(calls.some((call) => call.op === "rmdir")).toBe(false);

    await session.discard(staged);

    expect(calls.at(-1)).toEqual({
      op: "rmdir",
      path: staged.dir,
      recursive: true,
    });
    expect(calls.some((call) => call.op === "share")).toBe(false);
  });

  it("keeps the extension so the OS picks the right target app", async () => {
    const { share, calls } = harness();
    await share(zip());
    expect(calls.find((call) => call.op === "write")?.path).toMatch(
      /\/Genesis\.zip$/
    );
  });

  it("cannot be walked out of the share directory by a crafted name", async () => {
    const { share, calls } = harness();
    await share(new File([new Uint8Array(4)], "../../databases/take.mp3"));
    const path = calls.find((call) => call.op === "write")?.path ?? "";
    expect(path.startsWith(`${SHARE_CACHE_DIR}/`)).toBe(true);
    expect(path).not.toContain("..");
    expect(path).not.toContain("/databases/");
  });

  it("never leaves a raw space in the last path segment (George R6 P2)", async () => {
    // `shareFilename` (strings.ts) always interpolates spaces — "Genesis -
    // Chapter 1.mp3" — and Android's Share plugin reads the MIME type off
    // this exact segment with `MimeTypeMap.getFileExtensionFromUrl`, whose
    // allowlist (`[a-zA-Z_0-9.\-()%]+`) does not include a literal space. If
    // the URI Android's Filesystem plugin hands back is ever unencoded, a
    // space here degrades the share to a generic `*/*` intent — the share
    // sheet opens, but the audio/mpeg-only targets the field case (#336)
    // needs do not appear. Stripping it at the source removes the question
    // rather than trusting the URI to already be percent-encoded.
    const { share, calls } = harness();
    await share(mp3());
    const path = calls.find((call) => call.op === "write")?.path ?? "";
    expect(path).not.toMatch(/ /);
    expect(path).toMatch(
      new RegExp(`^${SHARE_CACHE_DIR}/[0-9a-f]{32}/Genesis_-_Chapter_1\\.mp3$`)
    );
  });

  it("streams a multi-megabyte file in bounded chunks, byte for byte", async () => {
    // A book zip is tens of megabytes and arrives as a Blob the browser backs
    // itself (use-book-share.ts builds the File from fflate's stream chunks).
    // Reading the whole thing into one base64 string would pull it into the JS
    // heap at ~1.33x — so the file goes over the bridge a slice at a time, and
    // the bytes that land must still be exactly the bytes we had.
    const size = SHARE_CHUNK_BYTES * 2 + 17;
    const source = new Uint8Array(size);
    // An LCG, NOT `(i * 31 + 7) % 256`. That fixture repeats every 256 bytes and
    // `SHARE_CHUNK_BYTES` is a multiple of 256, so every chunk held identical
    // bytes and a mutant that read chunk 0 three times passed this test. Caught
    // by mutation, which is the only thing that could have caught it — the
    // assertion was right and the data was lying to it.
    let state = 0x2545f491;
    for (let i = 0; i < size; i += 1) {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      source[i] = (state >>> 16) & 0xff;
    }
    const { share, calls } = harness();

    await share(new File([source], "Genesis.zip"));

    const writes = calls.filter(
      (call) => call.op === "write" || call.op === "append"
    );
    expect(writes).toHaveLength(3);
    expect(writes[0]?.op).toBe("write");
    expect(writes.slice(1).every((call) => call.op === "append")).toBe(true);
    for (const call of writes) {
      expect(atob(call.data ?? "").length).toBeLessThanOrEqual(
        SHARE_CHUNK_BYTES
      );
    }
    // Compared by index rather than `toEqual`, which walks 1.5M elements
    // through the full deep-equality machinery: locally that cost ~1.7s of the
    // test's ~1.9s, and on a CI runner it blew the 5s default timeout while
    // asserting nothing extra (the whole encode is ~30ms). `findIndex` still
    // names the first byte that differs, which is the only part of a diff over
    // a megabyte and a half anyone can read.
    const written = writtenBytes(calls);
    expect(written.length).toBe(size);
    expect(written.findIndex((byte, at) => byte !== source[at])).toBe(-1);
  });

  it("removes its own directory when the share sheet fails, and reports the failure", async () => {
    const { share, calls } = harness({
      op: "share",
      cause: new Error("no activity found"),
    });
    await expect(share(mp3())).rejects.toThrow("no activity found");
    const own = dirOf(calls.find((call) => call.op === "write"));
    expect(calls.at(-1)).toEqual({ op: "rmdir", path: own, recursive: true });
  });

  it("removes its own directory when the write itself fails", async () => {
    const { share, calls } = harness({
      op: "write",
      cause: new Error("disk full"),
    });
    await expect(share(mp3())).rejects.toThrow("disk full");
    expect(calls.some((call) => call.op === "share")).toBe(false);
    const own = dirOf(calls.find((call) => call.op === "write"));
    expect(calls.at(-1)).toEqual({ op: "rmdir", path: own, recursive: true });
  });

  it("reads a dismissed chooser as a dismissal, not a failure", async () => {
    // The plugin rejects a cancelled chooser with a plain Error whose message is
    // "Share canceled" (SharePlugin.java's activityResult, SharePlugin.swift:63)
    // — not a DOMException. Untranslated, `classifyShareError` would read it as
    // `failed` and show the translator an error for tapping Back.
    const { share } = harness({
      op: "share",
      cause: new Error("Share canceled"),
    });
    const cause = await share(mp3()).catch((error: unknown) => error);
    expect(cause).toBeInstanceOf(DOMException);
    expect((cause as DOMException).name).toBe("AbortError");
  });

  it("still reports the real failure when the cleanup fails too", async () => {
    // Frank R5b P2. This case used to fail `rmdir` on a SUCCESSFUL share, which
    // once exercised the pre-write sweep — but that sweep is gone, so `rmdir`
    // now runs only after a failure and the old version asserted nothing at all.
    // The live question is which error survives: a cleanup rejection replacing
    // the share's would send a translator looking at the wrong thing.
    const { share, calls } = harness(
      { op: "share", cause: new Error("no activity found") },
      { op: "rmdir", cause: new Error("permission denied") }
    );
    await expect(share(mp3())).rejects.toThrow("no activity found");
    const own = dirOf(calls.find((call) => call.op === "write"));
    // Attempted, and its failure swallowed rather than surfaced.
    expect(calls.at(-1)).toEqual({ op: "rmdir", path: own, recursive: true });
  });
});

/**
 * #381: iOS does not have Android's hole. `SharePlugin.swift`'s completion
 * handler resolves only when `completed` is true and rejects "Share canceled"
 * otherwise, so a resolve on native iOS proves a target was picked the way a
 * web resolve does. Android's `stopped` flag is unchanged and still untrusted.
 */
describe("resolveProvesDelivery is platform-aware (#381)", () => {
  const PLATFORMS = ["android", "ios", "web"] as const;

  it("trusts a web resolve on every platform", () => {
    for (const p of PLATFORMS)
      expect(resolveProvesDelivery("web", p)).toBe(true);
  });

  it("trusts a native resolve on iOS", () => {
    expect(resolveProvesDelivery("native", "ios")).toBe(true);
  });

  it("does NOT trust a native resolve on Android — the stopped-flag hole is real and unchanged", () => {
    expect(resolveProvesDelivery("native", "android")).toBe(false);
  });

  it("does not trust a native resolve on a platform that is not a native shell at all", () => {
    // `native` with `web` cannot happen (the route is chosen from
    // `isNativePlatform()`), but the answer for it must still be the cautious
    // one rather than an accident of the ios test.
    expect(resolveProvesDelivery("native", "web")).toBe(false);
  });

  it("never treats an unsupported route as delivery", () => {
    for (const p of PLATFORMS)
      expect(resolveProvesDelivery("unsupported", p)).toBe(false);
  });
});

describe("sharePlatformFrom — Capacitor's platform id, narrowed (#490)", () => {
  it("maps the two native ids and web", () => {
    expect(sharePlatformFrom("android")).toBe("android");
    expect(sharePlatformFrom("ios")).toBe("ios");
    expect(sharePlatformFrom("web")).toBe("web");
  });

  it("treats anything else — a custom platform, an empty id — as web, never as a native shell", () => {
    // Guessing "android" for an unknown id would draw the Android glyph on a
    // build nobody has checked it on, and would trust a native resolve
    // nowhere it has been proven.
    expect(sharePlatformFrom("electron")).toBe("web");
    expect(sharePlatformFrom("")).toBe("web");
    expect(sharePlatformFrom("Android")).toBe("web");
  });
});
