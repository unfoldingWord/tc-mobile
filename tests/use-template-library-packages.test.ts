// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTemplateLibrary } from "@/hooks/use-template-library";
import { reportFailure } from "@/hooks/report-failure";

/**
 * `useTemplateLibrary` reads the build's package list (#1451's done-when
 * addition, part of #1450). The list module is wrapped so its real
 * `loadTemplateEntries` runs over a synthetic list (OBS, an invented second
 * source, and whatever this test adds); the hook is not edited for it. One
 * package that fails to load is written to the problem report and skipped;
 * the library shows the rest. Only when nothing loads is the library failed.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const hymnal: unknown = JSON.parse(
  readFileSync(
    path.join(ROOT, "tests", "fixtures", "templates", "hymnal-min.json"),
    "utf8"
  )
);

const list = vi.hoisted(() => ({
  extra: [] as (() => Promise<{ pkg: unknown; titles: unknown[] }>)[],
  obs: true,
}));

vi.mock("@/lib/templates/packages", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@/lib/templates/packages")>();
  const { loadObsTemplate } = await import("@/lib/templates/obs");
  return {
    ...real,
    loadTemplateEntries: () =>
      real.loadTemplateEntries([
        ...(list.obs ? [loadObsTemplate] : []),
        ...list.extra,
      ]),
  };
});
vi.mock("@/hooks/report-failure", () => ({ reportFailure: vi.fn() }));

type Library = ReturnType<typeof useTemplateLibrary>;

function Probe({ onApi }: { onApi: (api: Library) => void }) {
  const api = useTemplateLibrary(true, () => {});
  useEffect(() => {
    onApi(api);
  });
  return null;
}

let root: Root;
let api: Library | null;
beforeEach(() => {
  list.extra = [];
  list.obs = true;
  api = null;
  vi.mocked(reportFailure).mockClear();
  document.body.innerHTML = "<div id='root'></div>";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

async function openLibrary(): Promise<Library> {
  await act(async () => {
    root.render(createElement(Probe, { onApi: (a) => (api = a) }));
  });
  // Let the list settle and the effect's state land. The OBS catalogue is a
  // lazy chunk, so its first load can take more than one turn: wait for the
  // status to leave "loading", with a bound so a hang fails rather than spins.
  for (let turn = 0; turn < 200; turn += 1) {
    if (api !== null && (api as Library).status !== "loading") break;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
  if (api === null) throw new Error("the probe never rendered");
  if ((api as Library).status === "loading")
    throw new Error("the library never left loading");
  return api;
}

describe("useTemplateLibrary reads the package list", () => {
  it("lists every package the list holds, a synthetic second source included", async () => {
    list.extra = [() => Promise.resolve({ pkg: hymnal, titles: [] })];
    const lib = await openLibrary();
    expect(lib.status).toBe("ready");
    expect(lib.entries.map((e) => e.pkg.id)).toEqual(["obs", "hymnal:fixture"]);
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("reports one package that fails to load and still lists the others", async () => {
    const cause = new Error("chunk failed to load");
    list.extra = [
      () => Promise.reject(cause),
      () => Promise.resolve({ pkg: hymnal, titles: [] }),
    ];
    const lib = await openLibrary();
    expect(lib.status).toBe("ready");
    expect(lib.entries.map((e) => e.pkg.id)).toEqual(["obs", "hymnal:fixture"]);
    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(reportFailure).toHaveBeenCalledWith(cause, "template-load");
  });

  it("is failed only when nothing loads, with one report per package", async () => {
    list.obs = false;
    const first = new Error("first");
    const second = new Error("second");
    list.extra = [() => Promise.reject(first), () => Promise.reject(second)];
    const lib = await openLibrary();
    expect(lib.status).toBe("failed");
    expect(lib.entries).toEqual([]);
    expect(vi.mocked(reportFailure).mock.calls).toEqual([
      [first, "template-load"],
      [second, "template-load"],
    ]);
  });
});

/** The same hook with `open` driven by the test, so a reopen can be staged. */
function OpenProbe({
  open,
  onApi,
}: {
  open: boolean;
  onApi: (api: Library) => void;
}) {
  const api = useTemplateLibrary(open, () => {});
  useEffect(() => {
    onApi(api);
  });
  return null;
}

async function show(open: boolean): Promise<void> {
  await act(async () => {
    root.render(createElement(OpenProbe, { open, onApi: (a) => (api = a) }));
  });
}

describe("useTemplateLibrary on a reopen (#1655 follow-up, #1747)", () => {
  it("reads loading again while a reopen's load is in flight, not the last load's failure", async () => {
    list.obs = false;
    list.extra = [() => Promise.reject(new Error("nothing loads"))];
    await show(true);
    for (let turn = 0; turn < 200; turn += 1) {
      if (api !== null && (api as Library).status !== "loading") break;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 5));
      });
    }
    expect((api as Library | null)?.status).toBe("failed");

    // Close, then reopen on a load the test holds open.
    await show(false);
    let settle: (value: { pkg: unknown; titles: unknown[] }) => void = () => {};
    list.extra = [
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    ];
    await show(true);
    expect((api as Library | null)?.status).toBe("loading");

    await act(async () => {
      settle({ pkg: hymnal, titles: [] });
      await new Promise((r) => setTimeout(r, 5));
    });
    expect((api as Library | null)?.status).toBe("ready");
    expect((api as Library | null)?.entries.map((e) => e.pkg.id)).toEqual([
      "hymnal:fixture",
    ]);
  });
});
