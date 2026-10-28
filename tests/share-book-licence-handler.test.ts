import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { stripComments } from "./support";

/**
 * Share Book's tap 1 on the Books screen (#1455): a book whose licence is not
 * chosen asks first and shares nothing from the tap; the share runs from the
 * ask only once the pick is stored, with the stored licence in the file name;
 * a cancel runs nothing. Read from source with comments stripped, as
 * `export-project-handler.test.ts` does: the screen is too large to render
 * here. The ask's hook is `use-licence-ask.test.ts`.
 */
const source = stripComments(
  readFileSync(path.join("src", "components", "books-screen.tsx"), "utf8")
);

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

describe("Share Book's licence ask", () => {
  it("asks and returns, before any share, when the licence is not chosen", () => {
    const body = callbackBody("onPrepareBookShare");
    expect(body).toMatch(
      /if \(needsLicenceAsk\(shareMenuBook\)\) \{\s*askLicence\(shareMenuBook\.bookId\);\s*return;\s*\}/
    );
    expect(body.indexOf("askLicence(")).toBeLessThan(
      body.indexOf("runBookShare(")
    );
  });

  it("shares after the ask only once the pick is stored, with the stored licence", () => {
    // The Licence tile's save-only branch (#1455) returns before the share;
    // `books-licence-tile.test.ts` renders that path.
    expect(callbackBody("onPickLicence")).toMatch(
      /chooseLicence\(licence\)\.then\(\(book\) => \{\s*if \(!book\) return;[\s\S]*?return;\s*\}\s*runBookShare\(book\.licence\);/
    );
  });

  it("reloads on any commit, even one whose share was dropped", () => {
    expect(source).toContain("useLicenceAsk(onLicenceCommitted)");
    const body = callbackBody("onLicenceCommitted");
    expect(body).toContain("setChosenLicences(");
    expect(body).toContain("reload();");
  });

  it("refuses to close the sheet while the licence write is in flight", () => {
    expect(callbackBody("closeBookMenuState")).toMatch(
      /if \(licenceSaving\(\)\) return false;/
    );
  });

  it("runs nothing on cancel", () => {
    const body = callbackBody("onCancelLicence");
    expect(body).toContain("cancelLicenceAsk()");
    expect(body).not.toContain("runBookShare");
  });

  it("builds the file names from the licence it is handed, not the render's", () => {
    const body = callbackBody("runBookShare");
    expect(body).toContain(
      "strings.shareBookFilename(shareMenuBookName, licence)"
    );
    expect(body).not.toContain("shareMenuLicence");
  });
});
