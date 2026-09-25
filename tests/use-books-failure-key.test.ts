import "fake-indexeddb/auto";

import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useBooks } from "@/hooks/use-books";
import { reportFailure } from "@/hooks/report-failure";
import { addChapter, createBook, listBooks } from "@/lib/storage/books";
import { closeDb, getDb } from "@/lib/storage/db";

/**
 * #172 part 1: `useBooks` must store a `strings`-mapped failure KEY, never a
 * raw `cause.message`, and a quota rejection must map to `"noRoom"` — for
 * every write, not only the take save. Mirrors `segment-rename-failure.test.ts`'s
 * harness (the hook mounted for real over fake-indexeddb, one store function
 * made to reject).
 *
 * Written red-first against the tree before this PR, where `setError`/
 * `setFailure` stored `errorMessage(cause)` — the raw, untranslatable
 * browser string the hook used to hand the screen.
 */

vi.mock("@/hooks/report-failure", () => ({ reportFailure: vi.fn() }));
vi.mock("@/lib/storage/books", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/books")>();
  return {
    ...actual,
    listBooks: vi.fn(actual.listBooks),
    createBook: vi.fn(actual.createBook),
    addChapter: vi.fn(actual.addChapter),
  };
});

/** A distinctive browser/IndexedDB-shaped message — never a plain "boom". */
const BROWSER_MESSAGE = "UnknownError: Internal error opening backing store";
const quotaError = () =>
  Object.assign(new Error("the disk is full"), { name: "QuotaExceededError" });

let dom: JSDOM;
let root: Root;
const probe: { current: ReturnType<typeof useBooks> | null } = {
  current: null,
};

function Probe() {
  const result = useBooks();
  useLayoutEffect(() => {
    probe.current = result;
  });
  return null;
}
const hook = () => probe.current!;

beforeEach(async () => {
  vi.clearAllMocks();
  await closeDb();
  const db = await getDb();
  const stores = Array.from(db.objectStoreNames);
  const tx = db.transaction(stores, "readwrite");
  await Promise.all([...stores.map((s) => tx.objectStore(s).clear()), tx.done]);
  dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>"
  );
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(dom.window.document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  vi.unstubAllGlobals();
});

async function mount(): Promise<void> {
  await act(async () => {
    root.render(createElement(Probe));
  });
  await vi.waitFor(() => expect(hook().loaded).toBe(true));
}

it('maps a shelf-load failure to "loadFailed", not the raw store message, and reports the cause (#172)', async () => {
  const cause = new Error(BROWSER_MESSAGE);
  vi.mocked(listBooks).mockRejectedValueOnce(cause);

  await act(async () => {
    root.render(createElement(Probe));
  });
  await vi.waitFor(() => expect(hook().loading).toBe(false));

  expect(hook().error).toBe("loadFailed");
  expect(hook().error).not.toContain("UnknownError");
  expect(reportFailure).toHaveBeenCalledWith(cause, "books-load");
});

it('maps a quota-exceeded shelf-load failure to "noRoom" (#172)', async () => {
  vi.mocked(listBooks).mockRejectedValueOnce(quotaError());

  await act(async () => {
    root.render(createElement(Probe));
  });
  await vi.waitFor(() => expect(hook().loading).toBe(false));

  expect(hook().error).toBe("noRoom");
});

it('returns the "saveFailed" KEY from a failed createBook, not the raw message, and reports the cause (#172)', async () => {
  await mount();
  const cause = new Error(BROWSER_MESSAGE);
  vi.mocked(createBook).mockRejectedValueOnce(cause);

  let result: { ok: boolean; key?: string; book?: unknown } | undefined;
  await act(async () => {
    result = await hook().createBook("Mark");
  });

  expect(result).toEqual({ ok: false, key: "saveFailed" });
  expect(reportFailure).toHaveBeenCalledWith(cause, "books-create");
});

it('maps a quota-exceeded createBook failure to "noRoom" (#172)', async () => {
  await mount();
  vi.mocked(createBook).mockRejectedValueOnce(quotaError());

  let result: { ok: boolean; key?: string } | undefined;
  await act(async () => {
    result = await hook().createBook("Mark");
  });

  expect(result).toEqual({ ok: false, key: "noRoom" });
});

it('maps a failed addChapter write to "saveFailed", not the raw message, and reports the cause (#172)', async () => {
  // Seed a real book — through the pass-through-by-default mock — so
  // `addChapter`'s own `reportUnlessStale` sees a genuinely live target
  // rather than treating the failure as a stale race with a deleted book.
  const book = await createBook("Mark");
  await mount();
  const cause = new Error(BROWSER_MESSAGE);
  vi.mocked(addChapter).mockRejectedValueOnce(cause);

  await act(async () => {
    await hook().addChapter(book.id, "");
  });

  expect(hook().error).toBe("saveFailed");
  expect(hook().error).not.toContain("UnknownError");
  expect(reportFailure).toHaveBeenCalledWith(cause, "books-add-chapter");
});

it('maps a quota-exceeded addChapter failure to "noRoom" (#172)', async () => {
  const book = await createBook("Mark");
  await mount();
  vi.mocked(addChapter).mockRejectedValueOnce(quotaError());

  await act(async () => {
    await hook().addChapter(book.id, "");
  });

  expect(hook().error).toBe("noRoom");
});
