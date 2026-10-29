import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { stripComments } from "./support";

/**
 * The Books screen's Export project handler (#1457) keeps the same tap-1
 * discipline as Share Book's: the focus capture first, then the chapter stop,
 * the rename-session bump, and a close of the menu when the native route
 * chains straight through to a sent or dismissed outcome. The handler is
 * wired to the row, and the row sits directly after Share book. A book with
 * no language asks it first (#1492): the export runs from the tap only when
 * the card has a language, and from the ask only once the pick is stored.
 *
 * Read from source with comments stripped, because a screen this size cannot
 * be rendered in one pass here; `books-menus-tiles-o4.test.ts` renders the
 * tile row, and `use-book-share-project.test.ts` runs the flow itself.
 */
const source = stripComments(
  readFileSync(path.join("src", "components", "books-screen.tsx"), "utf8")
);

/** One `useCallback`'s source, from its name to its closing `);`. */
function callbackBody(name: string): string {
  const at = source.indexOf(`const ${name} = useCallback(`);
  expect(at).toBeGreaterThan(-1);
  expect(source.indexOf(`const ${name} =`, at + 1)).toBe(-1);
  const ends = ["\n  );", "\n  ]);"]
    .map((close) => source.indexOf(close, at))
    .filter((i) => i > at);
  expect(ends.length).toBeGreaterThan(0);
  const body = source.slice(at, Math.min(...ends));
  expect(body.length).toBeGreaterThan(0);
  return body;
}

const handlerBody = () => callbackBody("onPrepareBookExport");
const exportBody = () => callbackBody("runBookExport");

describe("onPrepareBookExport", () => {
  it("captures focus before any other work, then stops the chapter and bumps the rename session", () => {
    const body = handlerBody();
    const capture = body.indexOf("focusRestore.capture();");
    const stop = body.indexOf("stopChapter();");
    const session = body.indexOf("bookMenuSession.current += 1;");
    expect(capture).toBeGreaterThan(-1);
    expect(stop).toBeGreaterThan(capture);
    expect(session).toBeGreaterThan(stop);
    expect(body.indexOf("runBookExport(shareMenuBook.bookId)")).toBeGreaterThan(
      session
    );
  });

  it("asks the language, and returns, when the book has none (#1492)", () => {
    expect(handlerBody()).toMatch(
      /if \(!shareMenuBook\.languageCode\) \{\s*askLanguage\(shareMenuBook\.bookId\);\s*return;\s*\}\s*runBookExport\(shareMenuBook\.bookId\);/
    );
  });

  it("exports after the ask only once the pick is stored (#1492)", () => {
    expect(callbackBody("onPickLanguage")).toMatch(
      /chooseLanguage\(tag\)\.then\(\(book\) => \{\s*if \(!book\) return;\s*reload\(\);\s*runBookExport\(book\.id\);/
    );
    expect(callbackBody("onCancelLanguage")).not.toContain("runBookExport");
  });

  it("closes the menu on a chained sent or dismissed outcome, as Share book does", () => {
    expect(exportBody()).toMatch(
      /\.prepareProject\([\s\S]*?\)\s*\.then\(\(outcome\) => \{\s*if \(outcome === "sent" \|\| outcome === "dismissed"\) onCloseShareMenu\(\);/
    );
  });

  it("names the file with the export's own filename and the book's own name", () => {
    const body = exportBody();
    expect(body).toContain("strings.exportProjectFilename(shareMenuBookName)");
    expect(body).toContain("bookName: shareMenuBookName");
  });
});

describe("the Export project tile", () => {
  it("is the first tile after Share book, calls the handler, and goes busy with the flow", () => {
    expect(source).toMatch(
      /<Tile[^>]*icon="file-zip"[^>]*label=\{strings\.exportProject\}[^>]*busy=\{bookShare\.status === "preparing"\}[^>]*onClick=\{onPrepareBookExport\}/
    );
    const exportAt = source.indexOf("label={strings.exportProject}");
    const coverAt = source.indexOf("<CoverTile", exportAt);
    expect(exportAt).toBeGreaterThan(-1);
    expect(coverAt).toBeGreaterThan(exportAt);
  });
});
