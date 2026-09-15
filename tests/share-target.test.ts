import { describe, expect, it } from "vitest";

import {
  SHARE_CACHE_DIR,
  SHARE_CHUNK_BYTES,
  type NativeShareBridge,
  type ShareEnvironment,
  selectShareRoute,
  shareFileNatively,
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
 * `selectShareRoute` (native vs web vs unsupported) and `shareFileNatively`
 * (cache write, chunking, share, cleanup), the latter through an injected
 * {@link NativeShareBridge}. The plugin calls themselves — Capacitor's
 * Filesystem and Share — are a device boundary and are NOT covered here.
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

interface Recorder {
  readonly bridge: NativeShareBridge;
  readonly calls: BridgeCall[];
}

/** A bridge that records every call; `fail` makes one operation reject. */
function recordingBridge(fail?: {
  op: BridgeCall["op"];
  cause: unknown;
}): Recorder {
  const calls: BridgeCall[] = [];
  const maybeFail = (op: BridgeCall["op"]): void => {
    if (fail?.op === op) throw fail.cause;
  };
  const bridge: NativeShareBridge = {
    rmdir: async ({ path, recursive }) => {
      calls.push({ op: "rmdir", path, recursive });
      maybeFail("rmdir");
    },
    writeFile: async ({ path, data, recursive }) => {
      calls.push({ op: "write", path, data, recursive });
      maybeFail("write");
      return { uri: `file:///data/cache/${path}` };
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
  return { bridge, calls };
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

describe("shareFileNatively", () => {
  it("writes the file into the share cache and hands its uri to the plugin", async () => {
    const { bridge, calls } = recordingBridge();
    await shareFileNatively(mp3(), bridge);

    const write = calls.find((call) => call.op === "write");
    expect(write?.path).toBe(`${SHARE_CACHE_DIR}/Genesis - Chapter 1.mp3`);
    // The parent directory does not exist on a first share.
    expect(write?.recursive).toBe(true);
    expect(calls.at(-1)).toEqual({
      op: "share",
      files: [`file:///data/cache/${SHARE_CACHE_DIR}/Genesis - Chapter 1.mp3`],
    });
  });

  it("clears the previous share's file before writing the new one", async () => {
    const { bridge, calls } = recordingBridge();
    await shareFileNatively(mp3(), bridge);
    expect(calls[0]).toEqual({
      op: "rmdir",
      path: SHARE_CACHE_DIR,
      recursive: true,
    });
  });

  it("keeps the extension so the OS picks the right target app", async () => {
    const { bridge, calls } = recordingBridge();
    await shareFileNatively(zip(), bridge);
    expect(calls.find((call) => call.op === "write")?.path).toBe(
      `${SHARE_CACHE_DIR}/Genesis.zip`
    );
  });

  it("cannot be walked out of the share directory by a crafted name", async () => {
    const { bridge, calls } = recordingBridge();
    await shareFileNatively(
      new File([new Uint8Array(4)], "../../databases/take.mp3"),
      bridge
    );
    const path = calls.find((call) => call.op === "write")?.path ?? "";
    expect(path.startsWith(`${SHARE_CACHE_DIR}/`)).toBe(true);
    expect(path).not.toContain("..");
    expect(path).not.toContain("/databases/");
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
    const { bridge, calls } = recordingBridge();

    await shareFileNatively(new File([source], "Genesis.zip"), bridge);

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

  it("removes the temp file when the share sheet fails, and reports the failure", async () => {
    const { bridge, calls } = recordingBridge({
      op: "share",
      cause: new Error("no activity found"),
    });
    await expect(shareFileNatively(mp3(), bridge)).rejects.toThrow(
      "no activity found"
    );
    // Cleared once before the write and once after the failed share.
    expect(calls.filter((call) => call.op === "rmdir")).toHaveLength(2);
    expect(calls.at(-1)?.op).toBe("rmdir");
  });

  it("removes the temp file when the write itself fails", async () => {
    const { bridge, calls } = recordingBridge({
      op: "write",
      cause: new Error("disk full"),
    });
    await expect(shareFileNatively(mp3(), bridge)).rejects.toThrow("disk full");
    expect(calls.some((call) => call.op === "share")).toBe(false);
    expect(calls.at(-1)?.op).toBe("rmdir");
  });

  it("reads a dismissed chooser as a dismissal, not a failure", async () => {
    // The plugin rejects a cancelled chooser with a plain Error whose message is
    // "Share canceled" (SharePlugin.java's activityResult, SharePlugin.swift:63)
    // — not a DOMException. Untranslated, `classifyShareError` would read it as
    // `failed` and show the translator an error for tapping Back.
    const { bridge } = recordingBridge({
      op: "share",
      cause: new Error("Share canceled"),
    });
    const cause = await shareFileNatively(mp3(), bridge).catch(
      (error: unknown) => error
    );
    expect(cause).toBeInstanceOf(DOMException);
    expect((cause as DOMException).name).toBe("AbortError");
  });

  it("survives a cleanup that cannot run — the share is what matters", async () => {
    // rmdir rejects when the directory was never there (the first share of a
    // session) as well as when it could not be removed. Neither is news.
    const { bridge, calls } = recordingBridge({
      op: "rmdir",
      cause: new Error("Directory does not exist"),
    });
    await shareFileNatively(mp3(), bridge);
    expect(calls.at(-1)?.op).toBe("share");
  });
});
