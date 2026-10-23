// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTemplateLibrary } from "@/hooks/use-template-library";
import { loadObsTemplate } from "@/lib/templates/obs";

/**
 * A Template Library create whose outcome was unknown (#1450, deferred from
 * #1655): the write throws, the translator taps Create again, and the second
 * call must hand the store the SAME plan and ids so the store's idempotency
 * can recognise the first write. A fresh intent per tap would mint new ids
 * and a retry could create a second book. The store is mocked here; its own
 * idempotency on these ids is `template-book-write.test.ts`'s.
 */

const store = vi.hoisted(() => ({
  calls: [] as { plan: unknown; ids: unknown; name: string }[],
  failNext: false,
}));
vi.mock("@/lib/storage/template-book", () => ({
  createBookFromPlan: (plan: unknown, ids: unknown, name: string) => {
    store.calls.push({ plan, ids, name });
    if (store.failNext) {
      store.failNext = false;
      return Promise.reject(new Error("write outcome unknown"));
    }
    return Promise.resolve();
  },
}));
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

let root: Root;
beforeEach(() => {
  store.calls = [];
  store.failNext = false;
  document.body.innerHTML = "<div id='root'></div>";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("useTemplateLibrary's create retry", () => {
  it("replays a failed create on the same plan and ids, then forgets the intent once it lands", async () => {
    const entry = await loadObsTemplate();
    const onCreated = vi.fn();
    let api: Library | null = null;
    await act(async () => {
      root.render(createElement(Probe, { onApi: (a) => (api = a), onCreated }));
    });

    store.failNext = true;
    let first: Outcome = null;
    await act(async () => {
      first = await api!.create(entry, "Open Bible Stories");
    });
    expect(first).toEqual({ ok: false, key: "saveFailed" });
    expect(onCreated).not.toHaveBeenCalled();

    let second: Outcome = null;
    await act(async () => {
      second = await api!.create(entry, "Open Bible Stories");
    });
    expect(second).toEqual({ ok: true });
    expect(onCreated).toHaveBeenCalledTimes(1);

    // The retry is the same create: identical objects, so identical ids.
    expect(store.calls).toHaveLength(2);
    expect(store.calls[1]!.plan).toBe(store.calls[0]!.plan);
    expect(store.calls[1]!.ids).toBe(store.calls[0]!.ids);

    // A landed create ends the intent: the next one is a new book.
    await act(async () => {
      await api!.create(entry, "Open Bible Stories 2");
    });
    expect(store.calls).toHaveLength(3);
    expect(store.calls[2]!.ids).not.toBe(store.calls[0]!.ids);
  });
});
