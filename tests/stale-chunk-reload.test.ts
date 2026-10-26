import { describe, expect, it } from "vitest";

import {
  createStaleChunkHandler,
  holdsUnsavedAudioNow,
  setUnsavedAudioCheck,
  type StaleChunkDeps,
} from "@/hooks/stale-chunk-reload";
import { chooseChunkRecovery, isChunkLoadError } from "@/lib/chunk-load";
import { lightsFailureMarker } from "@/lib/failure-marker";

/**
 * A lazy chunk that will not load after an update reloads the page once, then
 * fails (#1421 O1; the DRI's pick, verbatim: "Reload once, then fail
 * (Recommended)").
 *
 * Node only. The importer is injected and rejects with each engine's own
 * message; the handler is wired to it the way Vite's preload helper wires
 * `vite:preloadError` (dispatch, then rethrow). `sessionStorage` is a Map
 * that outlives a simulated reload, the way the real one outlives a reload in
 * the same tab.
 */

const ENGINE_MESSAGES = {
  chromium:
    "Failed to fetch dynamically imported module: https://example.test/assets/browser-D4EssyxD.js",
  webkit: "Importing a module script failed.",
  gecko:
    "error loading dynamically imported module: https://example.test/assets/browser-D4EssyxD.js",
} as const;

class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

interface Page {
  readonly reports: { context: string; cause: unknown }[];
  reloads: number;
  /** An `import()` through the handler, as the preload helper runs it. */
  load(importer: () => Promise<unknown>): Promise<unknown>;
  /** Run what the handler deferred (the flush, then the reload). */
  settle(): Promise<void>;
}

function openPage(
  storage: MemoryStorage | null,
  options: { build?: string; unsaved?: () => boolean } = {}
): Page {
  const deferred: (() => void)[] = [];
  const page: Page = {
    reports: [],
    reloads: 0,
    load: (importer) =>
      importer().catch((cause: unknown) => {
        handle(cause);
        throw cause;
      }),
    settle: async () => {
      for (const run of deferred.splice(0)) run();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
  const deps: StaleChunkDeps = {
    build: options.build ?? "1.1.0+abc1234",
    storage,
    holdsUnsavedAudio: options.unsaved ?? (() => false),
    report: (cause, context) => page.reports.push({ cause, context }),
    flush: () => Promise.resolve(),
    reload: () => {
      page.reloads += 1;
    },
    defer: (run) => deferred.push(run),
  };
  const handle = createStaleChunkHandler(deps);
  return page;
}

const rejecting = (message: string) => () =>
  Promise.reject(new TypeError(message));

describe("isChunkLoadError", () => {
  it.each(Object.entries(ENGINE_MESSAGES))(
    "recognises the %s message",
    (_engine, message) => {
      expect(isChunkLoadError(new TypeError(message))).toBe(true);
    }
  );

  it("recognises Vite's own stylesheet preload failure", () => {
    expect(
      isChunkLoadError(new Error("Unable to preload CSS for /assets/x.css"))
    ).toBe(true);
  });

  it("does not claim any other failure", () => {
    expect(isChunkLoadError(new Error("QuotaExceededError"))).toBe(false);
    expect(isChunkLoadError(new TypeError("x is not a function"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError({ message: 42 })).toBe(false);
  });
});

describe("a chunk that will not load", () => {
  it.each(Object.entries(ENGINE_MESSAGES))(
    "%s: reloads once, after the action's own rejection",
    async (_engine, message) => {
      const page = openPage(new MemoryStorage());
      await expect(page.load(rejecting(message))).rejects.toThrow(message);
      expect(page.reloads).toBe(0);
      await page.settle();
      expect(page.reloads).toBe(1);
      expect(page.reports.map((r) => r.context)).toEqual([
        "stale-chunk-reload",
      ]);
    }
  );

  it("fails without a second reload when the same build fails again", async () => {
    const storage = new MemoryStorage();
    const message = ENGINE_MESSAGES.webkit;

    const first = openPage(storage);
    await expect(first.load(rejecting(message))).rejects.toThrow();
    await first.settle();
    expect(first.reloads).toBe(1);

    // The reload landed on the same build: the old service worker still
    // served it. The tab's sessionStorage is the same.
    const second = openPage(storage);
    await expect(second.load(rejecting(message))).rejects.toThrow();
    await second.settle();
    expect(second.reloads).toBe(0);
    expect(second.reports.map((r) => r.context)).toEqual(["stale-chunk"]);

    // And it keeps failing, never reloading, for the rest of that build.
    await expect(second.load(rejecting(message))).rejects.toThrow();
    await second.settle();
    expect(second.reloads).toBe(0);
  });

  it("reloads once more when the reload landed on a newer build", async () => {
    const storage = new MemoryStorage();
    const first = openPage(storage, { build: "1.1.0+aaaaaaa" });
    await expect(
      first.load(rejecting(ENGINE_MESSAGES.chromium))
    ).rejects.toThrow();
    await first.settle();
    const next = openPage(storage, { build: "1.1.1+bbbbbbb" });
    await expect(
      next.load(rejecting(ENGINE_MESSAGES.chromium))
    ).rejects.toThrow();
    await next.settle();
    expect(next.reloads).toBe(1);
  });

  it("does not reload over unsaved audio; it reports instead", async () => {
    const storage = new MemoryStorage();
    const page = openPage(storage, { unsaved: () => true });
    await expect(
      page.load(rejecting(ENGINE_MESSAGES.chromium))
    ).rejects.toThrow();
    await page.settle();
    expect(page.reloads).toBe(0);
    expect(page.reports.map((r) => r.context)).toEqual(["stale-chunk"]);
    // Nothing was marked, so once the audio is saved the next failure in this
    // build may still reload.
    expect(storage.items.size).toBe(0);
  });

  it("calls the reload off when audio becomes unsaved while it waits", async () => {
    const storage = new MemoryStorage();
    let unsaved = false;
    const page = openPage(storage, { unsaved: () => unsaved });
    await expect(
      page.load(rejecting(ENGINE_MESSAGES.chromium))
    ).rejects.toThrow();
    // A recorder opens between the failure and the deferred reload.
    unsaved = true;
    await page.settle();
    expect(page.reloads).toBe(0);
    expect(page.reports.map((r) => r.context)).toEqual([
      "stale-chunk-reload",
      "stale-chunk",
    ]);
    // The mark is put back, so the retry is not spent.
    expect(storage.items.size).toBe(0);

    // Once the audio is saved, the next failure in this build reloads once.
    unsaved = false;
    await expect(
      page.load(rejecting(ENGINE_MESSAGES.chromium))
    ).rejects.toThrow();
    await page.settle();
    expect(page.reloads).toBe(1);
  });

  it("schedules one reload for several failures on one page", async () => {
    const page = openPage(new MemoryStorage());
    const a = page.load(rejecting(ENGINE_MESSAGES.chromium));
    const b = page.load(rejecting(ENGINE_MESSAGES.chromium));
    await expect(a).rejects.toThrow();
    await expect(b).rejects.toThrow();
    await page.settle();
    expect(page.reloads).toBe(1);
    expect(page.reports).toHaveLength(1);
  });

  it("reports instead of reloading when sessionStorage cannot be reached", async () => {
    const page = openPage(null);
    await expect(page.load(rejecting(ENGINE_MESSAGES.gecko))).rejects.toThrow();
    await page.settle();
    expect(page.reloads).toBe(0);
    expect(page.reports.map((r) => r.context)).toEqual(["stale-chunk"]);
  });

  it("reports instead of reloading when the mark cannot be written", async () => {
    const storage = new MemoryStorage();
    storage.setItem = () => {
      throw new DOMException("quota", "QuotaExceededError");
    };
    const page = openPage(storage);
    await expect(page.load(rejecting(ENGINE_MESSAGES.gecko))).rejects.toThrow();
    await page.settle();
    expect(page.reloads).toBe(0);
    expect(page.reports.map((r) => r.context)).toEqual(["stale-chunk"]);
  });

  it("leaves every other failure to the action", async () => {
    const page = openPage(new MemoryStorage());
    await expect(page.load(rejecting("x is not a function"))).rejects.toThrow();
    await page.settle();
    expect(page.reloads).toBe(0);
    expect(page.reports).toEqual([]);
  });
});

describe("chooseChunkRecovery", () => {
  it.each([null, undefined, "b"])(
    "puts unsaved audio ahead of every other answer (mark %s)",
    (reloadedBuild) => {
      expect(
        chooseChunkRecovery({
          build: "b",
          reloadedBuild,
          holdsUnsavedAudio: true,
        })
      ).toEqual({ kind: "report", reason: "unsaved-audio" });
    }
  );
});

describe("setUnsavedAudioCheck", () => {
  it("answers with the latest registration, and a stale removal keeps it", () => {
    expect(holdsUnsavedAudioNow()).toBe(false);
    const removeOld = setUnsavedAudioCheck(() => false);
    const removeNew = setUnsavedAudioCheck(() => true);
    expect(holdsUnsavedAudioNow()).toBe(true);
    removeOld();
    expect(holdsUnsavedAudioNow()).toBe(true);
    removeNew();
    expect(holdsUnsavedAudioNow()).toBe(false);
  });
});

describe("the failure-log rows", () => {
  it("a repeat failure lights ≡; the reload itself does not", () => {
    expect(lightsFailureMarker("stale-chunk")).toBe(true);
    expect(lightsFailureMarker("stale-chunk-reload")).toBe(false);
  });
});
