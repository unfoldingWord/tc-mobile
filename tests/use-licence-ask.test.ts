// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useLicenceAsk } from "@/hooks/use-licence-ask";
import type { Book, BookId } from "@/types/domain";

/**
 * The licence ask's hook (#1455): a choice writes through `setBookLicence`
 * and only then hands the book back for the share to continue; a cancel, a
 * newer ask or a double tap hands back nothing and writes at most once; a
 * failed write reports under "book-licence" and keeps the ask open.
 */

const setBookLicence = vi.hoisted(() => vi.fn());
const reportFailure = vi.hoisted(() => vi.fn());
vi.mock("@/lib/storage/licence", () => ({ setBookLicence }));
vi.mock("@/hooks/report-failure", () => ({ reportFailure }));

type Ask = ReturnType<typeof useLicenceAsk>;
const latest: { current: Ask | null } = { current: null };
function Probe() {
  const ask = useLicenceAsk();
  useEffect(() => {
    latest.current = ask;
  });
  return null;
}

let root: Root;
beforeEach(async () => {
  setBookLicence.mockReset();
  reportFailure.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.innerHTML = "<div id='root'></div>";
  root = createRoot(document.getElementById("root")!);
  await act(async () => root.render(createElement(Probe)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const id = "b1" as BookId;

it("writes the choice, and hands the book back only after the write settled", async () => {
  await act(async () => latest.current!.ask(id));
  const order: string[] = [];
  setBookLicence.mockImplementation(async () => {
    await Promise.resolve();
    order.push("written");
    return { id, licence: "CC-BY-4.0" } as Book;
  });
  let book: Book | null = null;
  await act(async () => {
    book = await latest.current!.choose("CC-BY-4.0");
    order.push("share-may-start");
  });
  expect(setBookLicence).toHaveBeenCalledWith(id, "CC-BY-4.0");
  expect(order).toEqual(["written", "share-may-start"]);
  expect((book as Book | null)?.licence).toBe("CC-BY-4.0");
  expect(latest.current!.askingFor).toBeNull();
});

it("writes nothing and hands nothing back when the ask is cancelled", async () => {
  await act(async () => latest.current!.ask(id));
  await act(async () => latest.current!.cancel());
  let book: Book | null | undefined;
  await act(async () => {
    book = await latest.current!.choose("CC0-1.0");
  });
  expect(setBookLicence).not.toHaveBeenCalled();
  expect(book).toBeNull();
  expect(latest.current!.askingFor).toBeNull();
});

it("drops a write's result when the ask was cancelled while it ran", async () => {
  await act(async () => latest.current!.ask(id));
  let release: (b: Book) => void = () => {};
  setBookLicence.mockImplementation(
    () => new Promise<Book>((resolve) => (release = resolve))
  );
  let pending: Promise<Book | null> = Promise.resolve(null);
  await act(async () => {
    pending = latest.current!.choose("CC0-1.0");
    latest.current!.cancel();
    release({ id, licence: "CC0-1.0" } as Book);
  });
  expect(await pending).toBeNull();
});

it("writes once for two taps in one render", async () => {
  await act(async () => latest.current!.ask(id));
  let release: (b: Book) => void = () => {};
  setBookLicence.mockImplementation(
    () => new Promise<Book>((resolve) => (release = resolve))
  );
  const { choose } = latest.current!;
  let results: (Book | null)[] = [];
  await act(async () => {
    const first = choose("CC-BY-SA-4.0");
    const second = choose("CC0-1.0");
    release({ id, licence: "CC-BY-SA-4.0" } as Book);
    results = await Promise.all([first, second]);
  });
  expect(setBookLicence).toHaveBeenCalledTimes(1);
  expect(results.filter((r) => r !== null)).toHaveLength(1);
});

it("reports a failed write as book-licence, keeps the ask open and continues nothing", async () => {
  await act(async () => latest.current!.ask(id));
  setBookLicence.mockRejectedValue(new Error("boom"));
  let book: Book | null | undefined;
  await act(async () => {
    book = await latest.current!.choose("CC-BY-SA-4.0");
  });
  expect(book).toBeNull();
  expect(reportFailure).toHaveBeenCalledWith(expect.any(Error), "book-licence");
  expect(latest.current!.askingFor).toBe(id);
  expect(latest.current!.failed).not.toBeNull();
  expect(latest.current!.saving).toBe(false);
});
