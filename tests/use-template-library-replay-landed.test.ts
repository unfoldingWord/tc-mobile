// @vitest-environment jsdom
import "fake-indexeddb/auto";

import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTemplateLibrary } from "@/hooks/use-template-library";
import { listBooks } from "@/lib/storage/books";
import { getDb } from "@/lib/storage/db";
import { loadObsTemplate } from "@/lib/templates/obs";

import { clearAllStores } from "./support";

/**
 * A Template Library create whose write LANDED but whose answer was lost
 * (#1655's deferred "replay after an unknown outcome", #1747). The real store
 * runs over fake-indexeddb; the wrapper lets the first write commit and then
 * throws, as a caller would see a failure after a durable write. The
 * translator taps Create again with the same name. The replay must be the same
 * create: it answers `ok`, writes nothing new, and is not refused as a name
 * another book holds (the stored book holds that name, and it is this one).
 *
 * `use-template-library-retry.test.ts` covers the other half, a write that
 * fails before anything is stored, against a mocked store.
 */

const store = vi.hoisted(() => ({ loseNextAnswer: false, calls: 0 }));
vi.mock("@/lib/storage/template-book", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@/lib/storage/template-book")>();
  return {
    ...real,
    createBookFromPlan: async (
      ...args: Parameters<typeof real.createBookFromPlan>
    ) => {
      store.calls += 1;
      const book = await real.createBookFromPlan(...args);
      if (store.loseNextAnswer) {
        store.loseNextAnswer = false;
        throw new Error("the write landed; its answer was lost");
      }
      return book;
    },
  };
});
vi.mock("@/hooks/report-failure", () => ({ reportFailure: vi.fn() }));

type Library = ReturnType<typeof useTemplateLibrary>;
type Outcome = Awaited<ReturnType<Library["create"]>>;

function Probe({
  onApi,
  onCreated,
}: {
  onApi: (api: Library) => void;
  onCreated: () => void;
}) {
  const api = useTemplateLibrary(false, onCreated);
  useEffect(() => {
    onApi(api);
  });
  return null;
}

async function rowCounts(): Promise<Record<string, number>> {
  const db = await getDb();
  return {
    books: await db.count("books"),
    chapters: await db.count("chapters"),
    segments: await db.count("segments"),
  };
}

let root: Root;
beforeEach(async () => {
  await clearAllStores();
  store.loseNextAnswer = false;
  store.calls = 0;
  document.body.innerHTML = "<div id='root'></div>";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("useTemplateLibrary replays a create whose write landed", () => {
  it("answers ok on the same-name retry and leaves one book", async () => {
    const entry = await loadObsTemplate();
    const onCreated = vi.fn();
    let api: Library | null = null;
    await act(async () => {
      root.render(createElement(Probe, { onApi: (a) => (api = a), onCreated }));
    });

    store.loseNextAnswer = true;
    let first: Outcome = null;
    await act(async () => {
      first = await api!.create(entry, "Open Bible Stories");
    });
    expect(first).toEqual({ ok: false, key: "saveFailed" });
    expect(onCreated).not.toHaveBeenCalled();
    // The first write is durable: the book is on the shelf already.
    const landed = await rowCounts();
    expect(landed.books).toBe(1);

    let second: Outcome = null;
    await act(async () => {
      second = await api!.create(entry, "Open Bible Stories");
    });
    expect(second).toEqual({ ok: true });
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(store.calls).toBe(2);

    // Nothing new was written, and the one book carries the name.
    expect(await rowCounts()).toEqual(landed);
    const shelf = await listBooks();
    expect(shelf.map((b) => b.name)).toEqual(["Open Bible Stories"]);
  });
});
