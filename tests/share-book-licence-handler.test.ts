import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { stripComments } from "./support";

/**
 * Share Book's tap 1 on the Books screen (#1455): a book whose licence is not
 * chosen asks first and shares nothing from the tap; the share runs from the
 * ask only once the pick is stored, with the stored licence in the file name;
 * a cancel runs nothing. Read from source with comments stripped, as
 * `export-project-handler.test.ts` does. The ask's hook is
 * `use-licence-ask.test.ts`.
 *
 * What a pick does is rendered, not read here: a source pattern cannot tell
 * whether the save-only branch also shares, or whether its condition is the
 * right one (#1707). `books-shelf-share-licence.test.ts` taps Share's own ask through
 * the whole screen, including a pick whose stored licence differs from the
 * row tapped; `books-licence-tile.test.ts` taps the save-only path.
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
