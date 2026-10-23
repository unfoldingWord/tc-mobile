// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTemplateLibrary } from "@/hooks/use-template-library";
import { BookNameTakenError } from "@/lib/storage/books";
import { loadObsTemplate } from "@/lib/templates/obs";

/**
 * The create latch in `useTemplateLibrary` (#246), George round 1 on #1655: a
 * create made while one is in flight is not a failure, so it must not answer
 * `saveFailed` over the first create's own outcome. The store is mocked: the
 * name refusal itself is `template-library.test.ts`'s, against fake IndexedDB.
 */

const store = vi.hoisted(() => ({
  writes: 0,
  refuse: null as null | (() => void),
}));
vi.mock("@/lib/storage/template-book", () => ({
  createBookFromPlan: () => {
    store.writes += 1;
    return new Promise<void>((_, reject) => {
      store.refuse = () => reject(new BookNameTakenError());
    });
  },
}));
vi.mock("@/hooks/report-failure", () => ({ reportFailure: vi.fn() }));

type Library = ReturnType<typeof useTemplateLibrary>;

function Probe({ onApi }: { onApi: (api: Library) => void }) {
  const api = useTemplateLibrary(false, () => {});
  useEffect(() => {
    onApi(api);
  });
  return null;
}

let root: Root;
beforeEach(() => {
  store.writes = 0;
  store.refuse = null;
  document.body.innerHTML = "<div id='root'></div>";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("useTemplateLibrary's create latch", () => {
  it("answers an overlapping create with null, leaves the first one's refusal to the caller, and releases", async () => {
    const entry = await loadObsTemplate();
    let api: Library | null = null;
    await act(async () => {
      root.render(createElement(Probe, { onApi: (a) => (api = a) }));
    });
    const { create } = api!;
    let first: Promise<unknown> = Promise.resolve();
    let second: Promise<unknown> = Promise.resolve();
    await act(async () => {
      first = create(entry, "Open Bible Stories");
      second = create(entry, "Open Bible Stories");
    });
    expect(store.writes).toBe(1);
    expect(await second).toBeNull();
    await act(async () => store.refuse!());
    expect(await first).toEqual({ ok: false, key: "bookNameTaken" });
    // The latch is released: the next create reaches the store.
    void api!.create(entry, "Open Bible Stories 2");
    expect(store.writes).toBe(2);
    await act(async () => store.refuse!());
  });
});
