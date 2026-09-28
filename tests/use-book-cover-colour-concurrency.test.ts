import "fake-indexeddb/auto";

import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  useBookCoverColour,
  type UseBookCoverColour,
} from "@/hooks/use-book-cover-colour";
import { createBook, getBook } from "@/lib/storage/books";
import { closeDb, getDb } from "@/lib/storage/db";
import type { BookId } from "@/types/domain";

type SetCoverColourResult = Awaited<
  ReturnType<UseBookCoverColour["setCoverColour"]>
>;

/**
 * #1046 item 4 (George Low, #1038): a second cover-colour write tapped
 * mid-write. Originally this hook refused the second write (`"busy"`); DRI
 * 2026-09-28: **"Last tap wins"** — "The second tap queues behind the first,
 * and the cover ends on the colour they tapped last." This file covers both
 * halves of that: same-book coalescing (this file's main subject) and the
 * per-book independence a prior commit on this same PR already fixed (kept
 * here as the cross-book case, unaffected by the queue).
 *
 * `tests/use-book-cover-colour.test.ts` says testing the guard itself needs
 * a jsdom mount it doesn't provide (it exercises only `performSetCoverColour`,
 * minus the React guard/queue). This file mounts the real hook (a
 * `useLayoutEffect` probe, the pattern `tests/use-books-cover-colour.test.ts`
 * already uses) over the real store (fake-indexeddb), with
 * `setBookCoverColour` deferred so calls can genuinely overlap, and records
 * which keys actually reach the store (`seams.calls`) so a coalesced,
 * never-written intermediate tap can be proven absent structurally rather
 * than by racing a poll against it.
 */

const seams = vi.hoisted(() => ({
  hold: null as { promise: Promise<void>; release: () => void } | null,
  // Keys that should make the underlying store write THROW, to test that an
  // earlier failure in a coalesced chain doesn't stop a later queued write.
  failKeys: new Set<string | null>(),
  // Keys that actually reached (and completed) the real store write, in
  // order — the structural proof of what did and didn't get persisted.
  calls: [] as (string | null)[],
}));
vi.mock("@/lib/storage/books", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/books")>();
  return {
    ...actual,
    setBookCoverColour: async (
      id: BookId,
      key: string | null,
      now?: number
    ) => {
      if (seams.hold) await seams.hold.promise;
      if (seams.failKeys.has(key)) {
        throw new Error(`simulated store failure for ${String(key)}`);
      }
      const result = await actual.setBookCoverColour(id, key, now);
      seams.calls.push(key);
      return result;
    },
  };
});

let dom: JSDOM;
let root: Root;
const probe: { current: ReturnType<typeof useBookCoverColour> | null } = {
  current: null,
};
function Probe() {
  const result = useBookCoverColour();
  useLayoutEffect(() => {
    probe.current = result;
  });
  return null;
}
const hook = () => probe.current!;

function deferred(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

beforeEach(async () => {
  // Clear every store rather than deleting the database (AGENTS.md).
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
  seams.failKeys = new Set();
  seams.calls = [];
});
afterEach(async () => {
  seams.hold = null;
  await act(async () => root.unmount());
  dom.window.close();
  vi.unstubAllGlobals();
});

async function mount(): Promise<void> {
  await act(async () => {
    root.render(createElement(Probe));
  });
}

it("queues (never refuses) a second write for the SAME book while its first write is in flight, and ends with the second colour stored", async () => {
  await mount();
  const bookA = await createBook("Mark");
  seams.hold = deferred();

  let firstResult: SetCoverColourResult;
  let secondResult: SetCoverColourResult;
  await act(async () => {
    const first = hook()
      .setCoverColour(bookA.id, "forest")
      .then((r) => (firstResult = r));
    const second = hook()
      .setCoverColour(bookA.id, "teal")
      .then((r) => (secondResult = r));
    seams.hold!.release();
    await Promise.all([first, second]);
  });

  // The queued (second) call never gets its own answer.
  expect(secondResult!).toBe("queued");
  // The ORIGINAL caller's promise carries the real, FINAL outcome — "teal",
  // not "forest" — once the coalesced chain settles.
  expect(firstResult!).toMatchObject({ book: { coverColourKey: "teal" } });
  expect((await getBook(bookA.id))?.coverColourKey).toBe("teal");
  // Structural proof, not a timing-dependent poll: "forest" WAS attempted
  // (it's the write that was in flight), then "teal" followed — no write
  // was skipped, and nothing wrote "forest" a second time.
  expect(seams.calls).toEqual(["forest", "teal"]);
});

it("coalesces a same-book A -> B -> C burst down to just C: B is never written", async () => {
  await mount();
  const bookA = await createBook("Mark");
  seams.hold = deferred();

  let firstResult: SetCoverColourResult;
  let secondResult: SetCoverColourResult;
  let thirdResult: SetCoverColourResult;
  await act(async () => {
    const first = hook()
      .setCoverColour(bookA.id, "forest")
      .then((r) => (firstResult = r));
    const second = hook()
      .setCoverColour(bookA.id, "teal")
      .then((r) => (secondResult = r));
    const third = hook()
      .setCoverColour(bookA.id, "plum")
      .then((r) => (thirdResult = r));
    seams.hold!.release();
    await Promise.all([first, second, third]);
  });

  expect(secondResult!).toBe("queued");
  expect(thirdResult!).toBe("queued");
  expect(firstResult!).toMatchObject({ book: { coverColourKey: "plum" } });
  expect((await getBook(bookA.id))?.coverColourKey).toBe("plum");
  // "teal" (B) is coalesced away by "plum" (C) overwriting the same pending
  // slot before the in-flight write for "forest" ever settles — it never
  // reaches the store. Exactly two writes land: "forest" (already running
  // when B and C arrived) and "plum" (the last of the two queued taps).
  expect(seams.calls).toEqual(["forest", "plum"]);
});

it("an earlier write's failure does not stop the queued write from running", async () => {
  await mount();
  const bookA = await createBook("Mark");
  seams.hold = deferred();
  seams.failKeys.add("forest");
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

  let firstResult: SetCoverColourResult;
  let secondResult: SetCoverColourResult;
  await act(async () => {
    const first = hook()
      .setCoverColour(bookA.id, "forest")
      .then((r) => (firstResult = r));
    const second = hook()
      .setCoverColour(bookA.id, "teal")
      .then((r) => (secondResult = r));
    seams.hold!.release();
    await Promise.all([first, second]);
  });
  consoleError.mockRestore();

  expect(secondResult!).toBe("queued");
  // The chain's LAST write ("teal") succeeded, so that — not the earlier
  // failure — is what the original caller's promise resolves with.
  expect(firstResult!).toMatchObject({ book: { coverColourKey: "teal" } });
  expect((await getBook(bookA.id))?.coverColourKey).toBe("teal");
  // "forest" never actually reached the store (it threw before persisting);
  // only "teal" is recorded as an actual write.
  expect(seams.calls).toEqual(["teal"]);
});

it("a failed LAST write after a committed earlier one says so: the stored colour changed", async () => {
  await mount();
  const bookA = await createBook("Mark");
  seams.hold = deferred();
  seams.failKeys.add("plum");
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

  let firstResult: SetCoverColourResult;
  await act(async () => {
    const first = hook()
      .setCoverColour(bookA.id, "forest")
      .then((r) => (firstResult = r));
    const second = hook().setCoverColour(bookA.id, "plum");
    seams.hold!.release();
    await Promise.all([first, second]);
  });
  consoleError.mockRestore();

  // "forest" committed, then the queued "plum" failed: the caller gets the
  // failure AND `committed: true`, so it can re-read the shelf rather than
  // keep showing the colour from before the chain.
  expect(firstResult!).toEqual({ failed: "saveFailed", committed: true });
  expect((await getBook(bookA.id))?.coverColourKey).toBe("forest");
  expect(seams.calls).toEqual(["forest"]);
});

it("does NOT refuse a write for a DIFFERENT book while another book's write is in flight (#1046 item 4)", async () => {
  await mount();
  const bookA = await createBook("Mark");
  const bookB = await createBook("Ruth");
  seams.hold = deferred();

  let firstResult: SetCoverColourResult;
  let secondResult: SetCoverColourResult;
  await act(async () => {
    const first = hook()
      .setCoverColour(bookA.id, "forest")
      .then((r) => (firstResult = r));
    const second = hook()
      .setCoverColour(bookB.id, "teal")
      .then((r) => (secondResult = r));
    seams.hold!.release();
    await Promise.all([first, second]);
  });

  expect(secondResult!).toMatchObject({ ok: true });
  expect(firstResult!).toMatchObject({ ok: true });
});

it("allows a second write for the SAME book once the first has settled (not stuck queued)", async () => {
  await mount();
  const bookA = await createBook("Mark");

  const first = await act(async () =>
    hook().setCoverColour(bookA.id, "forest")
  );
  expect(first).toMatchObject({ ok: true });

  const second = await act(async () => hook().setCoverColour(bookA.id, "teal"));
  expect(second).toMatchObject({ ok: true });
});
