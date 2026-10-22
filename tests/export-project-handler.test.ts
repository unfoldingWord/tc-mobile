import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { stripComments } from "./support";

/**
 * The Books screen's Export project handler (#1457) keeps the same tap-1
 * discipline as Share Book's: the focus capture first, then the chapter stop,
 * the rename-session bump, and a close of the menu when the native route
 * chains straight through to a sent or dismissed outcome. The handler is
 * wired to the row, and the row sits directly after Share book.
 *
 * Read from source with comments stripped, because a screen this size cannot
 * be rendered in one pass here; `books-menus-tiles-o4.test.ts` renders the
 * tile row, and `use-book-share-project.test.ts` runs the flow itself.
 */
const source = stripComments(
  readFileSync(path.join("src", "components", "books-screen.tsx"), "utf8")
);

function handlerBody(): string {
  const at = source.indexOf("const onPrepareBookExport = useCallback(");
  expect(at).toBeGreaterThan(-1);
  expect(source.indexOf("const onPrepareBookExport", at + 1)).toBe(-1);
  const end = source.indexOf("]);", at);
  expect(end).toBeGreaterThan(at);
  return source.slice(at, end);
}

describe("onPrepareBookExport", () => {
  it("captures focus before any other work, then stops the chapter and bumps the rename session", () => {
    const body = handlerBody();
    const capture = body.indexOf("focusRestore.capture();");
    const stop = body.indexOf("stopChapter();");
    const session = body.indexOf("bookMenuSession.current += 1;");
    expect(capture).toBeGreaterThan(-1);
    expect(stop).toBeGreaterThan(capture);
    expect(session).toBeGreaterThan(stop);
    expect(body.indexOf("prepareProject(")).toBeGreaterThan(session);
  });

  it("closes the menu on a chained sent or dismissed outcome, as Share book does", () => {
    expect(handlerBody()).toMatch(
      /\.prepareProject\([\s\S]*?\)\s*\.then\(\(outcome\) => \{\s*if \(outcome === "sent" \|\| outcome === "dismissed"\) onCloseShareMenu\(\);/
    );
  });

  it("names the file with the export's own filename and the book's own name", () => {
    const body = handlerBody();
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
