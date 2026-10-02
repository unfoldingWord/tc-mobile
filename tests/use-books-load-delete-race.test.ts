import "fake-indexeddb/auto";

import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useBooks } from "@/hooks/use-books";
import {
  createBook,
  deleteBook,
  getBook,
  listBooks,
} from "@/lib/storage/books";
import { closeDb, getDb } from "@/lib/storage/db";
import type { Book, BookId } from "@/types/domain";

/**
 * #361's first three rows: the `useBooks` load/delete wiring, driven through
 * the mounted hook rather than read off its source.
 *
 * When #361 was filed these could not be driven in Node; the jsdom mount that
 * `use-books-failure-key.test.ts` uses now can. Each case makes a `listBooks`
 * call wait on a promise the test holds, so a load is in flight exactly
 * where the race needs it.
 *
 * The resurrection case resolves its stale load INSIDE the same `act` as
 * the delete. React defers the commit, and so the load effect's cleanup
 * (`cancelled = true`), until that `act` ends, so the stale continuation runs
 * in the window the `loadGen` docblock names: after the write, before the
 * cleanup. Only the generation check stands between it and `setBooks`.
 */

vi.mock("@/hooks/report-failure", () => ({ reportFailure: vi.fn() }));
vi.mock("@/lib/storage/books", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/books")>();
  return {
    ...actual,
    listBooks: vi.fn(actual.listBooks),
    deleteBook: vi.fn(actual.deleteBook),
  };
});

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
const shelfIds = () => hook().books.map((card) => card.bookId);

/** A `listBooks` result the test resolves by hand. */
function heldListBooks(): (books: Book[]) => void {
  let resolve!: (books: Book[]) => void;
  vi.mocked(listBooks).mockImplementationOnce(
    () => new Promise<Book[]>((r) => (resolve = r))
  );
  return (books) => resolve(books);
}

/** A `listBooks` call that never settles, so no later read can repair the shelf. */
function neverListBooks(): void {
  vi.mocked(listBooks).mockImplementationOnce(
    () => new Promise<Book[]>(() => {})
  );
}

/** Let the stale load's continuation run to its `setBooks`, still inside `act`. */
const settle = () => new Promise((r) => setTimeout(r, 0));

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
  // Drop any one-shot `listBooks` a failed case left queued, back to the real
  // store function, so it cannot answer the next case's mount.
  vi.mocked(listBooks).mockReset();
  vi.mocked(deleteBook).mockReset();
  await act(async () => root.unmount());
  dom.window.close();
  vi.unstubAllGlobals();
});

/** Two books on a loaded shelf; returns their ids. */
async function mountTwoBooks(): Promise<{ mark: BookId; luke: BookId }> {
  const mark = await createBook("Mark");
  const luke = await createBook("Luke");
  await act(async () => {
    root.render(createElement(Probe));
  });
  await vi.waitFor(() => expect(hook().loaded).toBe(true));
  expect(shelfIds()).toHaveLength(2);
  return { mark: mark.id, luke: luke.id };
}

it("control: a held load that nothing supersedes does land its snapshot", async () => {
  const { mark, luke } = await mountTwoBooks();
  const snapshot = (await listBooks()).filter((b) => b.id === luke);
  const release = heldListBooks();
  await act(async () => hook().reload());

  await act(async () => {
    release(snapshot);
    await settle();
  });

  // The harness reaches `setBooks` from a held load; the case below differs
  // only in the delete that supersedes it.
  expect(shelfIds()).toEqual([luke]);
  expect(shelfIds()).not.toContain(mark);
});

it("a load started before a delete cannot put the deleted book back when it resolves after it (#361 row 1)", async () => {
  const { mark, luke } = await mountTwoBooks();
  const preDelete = await listBooks();
  const releaseStale = heldListBooks();
  await act(async () => hook().reload()); // the stale load is now in flight
  neverListBooks(); // the delete's own reconciling read never lands

  await act(async () => {
    expect(await hook().deleteBook(mark)).toBe("ok");
    releaseStale(preDelete);
    await settle();
  });

  expect(await getBook(mark)).toBeUndefined();
  expect(shelfIds()).toEqual([luke]);
});

it("a deleted book leaves the shelf in the same turn, not when the reload lands (#361 row 3)", async () => {
  const { mark, luke } = await mountTwoBooks();
  neverListBooks();

  await act(async () => {
    expect(await hook().deleteBook(mark)).toBe("ok");
  });

  expect(shelfIds()).toEqual([luke]);
});

it("a delete failure survives the load it re-arms, and a later successful delete clears it (#361 row 2)", async () => {
  const { mark, luke } = await mountTwoBooks();
  vi.mocked(deleteBook).mockRejectedValueOnce(new Error("blocked"));

  await act(async () => {
    expect(await hook().deleteBook(mark)).toBe("failed");
  });
  // The failed delete re-armed a real load; wait for it to land, then check
  // it drew the shelf without clearing the delete's failure.
  await vi.waitFor(() =>
    expect(vi.mocked(listBooks).mock.calls.length).toBe(2)
  );
  await act(settle);
  expect(shelfIds().sort()).toEqual([mark, luke].sort());
  expect(hook().deleteFailed).toBe(true);
  expect(hook().error).toBe("saveFailed");

  neverListBooks();
  await act(async () => {
    expect(await hook().deleteBook(mark)).toBe("ok");
  });

  expect(hook().deleteFailed).toBe(false);
  expect(hook().error).toBeNull();
  expect(shelfIds()).toEqual([luke]);
});

it("a retried delete takes the previous attempt's failure down when it starts, not when it settles (#361 row 2)", async () => {
  const { mark, luke } = await mountTwoBooks();
  vi.mocked(deleteBook).mockRejectedValueOnce(new Error("blocked"));
  await act(async () => {
    expect(await hook().deleteBook(mark)).toBe("failed");
  });
  expect(hook().deleteFailed).toBe(true);

  // Hold the retry's store write open, so the attempt is running and has not
  // reached a settle path. The success path clears the slot on its own, so a
  // case that only checks after success cannot see the clear at the start.
  let finish!: () => void;
  vi.mocked(deleteBook).mockImplementationOnce(
    () => new Promise<void>((r) => (finish = r))
  );
  neverListBooks();
  let retry!: Promise<unknown>;
  await act(async () => {
    retry = hook().deleteBook(mark);
    await settle();
  });

  expect(hook().deleting).toBe(true);
  expect(hook().deleteFailed).toBe(false);
  expect(hook().error).toBeNull();

  await act(async () => {
    finish();
    expect(await retry).toBe("ok");
  });
  expect(hook().deleting).toBe(false);
  expect(shelfIds()).toEqual([luke]);
});
