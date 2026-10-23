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
const getBook = vi.hoisted(() => vi.fn());
const committedSpy = vi.hoisted(() => vi.fn());
const reportFailure = vi.hoisted(() => vi.fn());
vi.mock("@/lib/storage/licence", () => ({ setBookLicence }));
vi.mock("@/lib/storage/books", () => ({ getBook }));
vi.mock("@/hooks/report-failure", () => ({ reportFailure }));

type Ask = ReturnType<typeof useLicenceAsk>;
const latest: { current: Ask | null } = { current: null };
function Probe() {
  const ask = useLicenceAsk(committedSpy);
  useEffect(() => {
    latest.current = ask;
  });
  return null;
}

let root: Root;
beforeEach(async () => {
  setBookLicence.mockReset();
  getBook.mockReset();
  committedSpy.mockReset();
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

function deferWrite() {
  const w: { release: (b: Book) => void } = { release: () => {} };
  setBookLicence.mockImplementation(
    () => new Promise<Book>((resolve) => (w.release = resolve))
  );
  return w;
}

it("ignores Cancel while the write is in flight, then hands the book back and reports the commit", async () => {
  await act(async () => latest.current!.ask(id));
  const w = deferWrite();
  let pending: Promise<Book | null> = Promise.resolve(null);
  await act(async () => {
    pending = latest.current!.choose("CC-BY-4.0");
  });
  expect(latest.current!.isSaving()).toBe(true);
  await act(async () => latest.current!.cancel());
  expect(latest.current!.askingFor).toBe(id);
  expect(latest.current!.saving).toBe(true);
  await act(async () => w.release({ id, licence: "CC-BY-4.0" } as Book));
  expect((await pending)?.licence).toBe("CC-BY-4.0");
  expect(committedSpy).toHaveBeenCalledTimes(1);
  expect(latest.current!.isSaving()).toBe(false);
});

it("does not let a newer ask clear the in-flight write, so a second pick cannot commit over the first", async () => {
  await act(async () => latest.current!.ask(id));
  const w = deferWrite();
  await act(async () => void latest.current!.choose("CC-BY-4.0"));
  await act(async () => latest.current!.ask(id));
  let second: Book | null | undefined;
  await act(async () => {
    second = await latest.current!.choose("CC0-1.0");
  });
  expect(second).toBeNull();
  await act(async () => w.release({ id, licence: "CC-BY-4.0" } as Book));
  expect(setBookLicence).toHaveBeenCalledTimes(1);
  expect(setBookLicence).toHaveBeenCalledWith(id, "CC-BY-4.0");
});

it("reports a commit even when the ask unmounted mid-write, so the shelf can reload", async () => {
  await act(async () => latest.current!.ask(id));
  const w = deferWrite();
  let pending: Promise<Book | null> = Promise.resolve(null);
  await act(async () => {
    pending = latest.current!.choose("CC0-1.0");
  });
  await act(async () => root.unmount());
  await act(async () => w.release({ id, licence: "CC0-1.0" } as Book));
  expect(await pending).toBeNull();
  expect(committedSpy).toHaveBeenCalledTimes(1);
  root = createRoot(document.getElementById("root")!);
});

it("lets a template book that reads null share untagged instead of trapping it in the ask", async () => {
  await act(async () => latest.current!.ask(id));
  const locked = Object.assign(new Error("locked"), {
    name: "TemplateLicenceLockedError",
  });
  setBookLicence.mockRejectedValue(locked);
  getBook.mockResolvedValue({ id, licence: null } as Book);
  let book: Book | null | undefined;
  await act(async () => {
    book = await latest.current!.choose("CC-BY-SA-4.0");
  });
  expect(book?.id).toBe(id);
  expect(reportFailure).not.toHaveBeenCalled();
  expect(latest.current!.askingFor).toBeNull();
});

const locked = () =>
  Object.assign(new Error("locked"), { name: "TemplateLicenceLockedError" });

it("a template-lock whose fallback read rejects shows the failure, clears busy, and can retry or dismiss", async () => {
  await act(async () => latest.current!.ask(id));
  setBookLicence.mockRejectedValue(locked());
  getBook.mockRejectedValue(new Error("read failed"));
  let book: Book | null | undefined;
  await act(async () => {
    book = await latest.current!.choose("CC-BY-SA-4.0");
  });
  expect(book).toBeNull();
  expect(latest.current!.isSaving()).toBe(false);
  expect(latest.current!.saving).toBe(false);
  expect(latest.current!.failed).not.toBeNull();
  expect(reportFailure).toHaveBeenCalledWith(expect.any(Error), "book-licence");

  // Retry works.
  setBookLicence.mockReset();
  setBookLicence.mockResolvedValue({ id, licence: "CC-BY-SA-4.0" } as Book);
  await act(async () => {
    book = await latest.current!.choose("CC-BY-SA-4.0");
  });
  expect(book?.licence).toBe("CC-BY-SA-4.0");

  // Dismiss works after a failure too.
  await act(async () => latest.current!.ask(id));
  setBookLicence.mockRejectedValue(locked());
  getBook.mockRejectedValue(new Error("read failed"));
  await act(async () => void (await latest.current!.choose("CC0-1.0")));
  await act(async () => latest.current!.cancel());
  expect(latest.current!.askingFor).toBeNull();
});

// The class guard: a throw at each await inside choose() leaves nothing busy.
const injections: [string, () => void][] = [
  ["the write rejects", () => setBookLicence.mockRejectedValue(new Error("w"))],
  [
    "the write throws before returning a promise",
    () =>
      setBookLicence.mockImplementation(() => {
        throw new Error("sync");
      }),
  ],
  [
    "the template-lock fallback read rejects",
    () => {
      setBookLicence.mockRejectedValue(locked());
      getBook.mockRejectedValue(new Error("r"));
    },
  ],
  [
    "the template-lock fallback read throws synchronously",
    () => {
      setBookLicence.mockRejectedValue(locked());
      getBook.mockImplementation(() => {
        throw new Error("sync read");
      });
    },
  ],
  [
    "the funnel report itself throws",
    () => {
      setBookLicence.mockRejectedValue(new Error("w"));
      reportFailure.mockImplementation(() => {
        throw new Error("funnel");
      });
    },
  ],
  [
    "the commit callback throws",
    () => {
      setBookLicence.mockResolvedValue({ id, licence: "CC0-1.0" } as Book);
      committedSpy.mockImplementation(() => {
        throw new Error("reload");
      });
    },
  ],
];
it.each(injections)("leaves nothing busy when %s", async (_name, inject) => {
  await act(async () => latest.current!.ask(id));
  inject();
  await act(async () => {
    await latest.current!.choose("CC0-1.0").catch(() => null);
  });
  expect(latest.current!.isSaving()).toBe(false);
  expect(latest.current!.saving).toBe(false);
  // And the ask can still be left.
  await act(async () => latest.current!.cancel());
  expect(latest.current!.askingFor).toBeNull();
});
