import { describe, expect, it } from "vitest";

import { strings } from "@/lib/strings";

/**
 * A book name is free text, and `filenameSafe` can reduce one to nothing
 * ("///", control characters). Share Book then named its file ".zip" and Share
 * your work gave a book an empty folder (#1421 T4).
 */
describe("a book name that sanitises to nothing (#1421 T4)", () => {
  const empties = ["///", "\\:*?", "   ", "\u0000\u0007", ""];

  it.each(empties)("shareBookFilename(%j) still names a file", (name) => {
    const file = strings.shareBookFilename(name);
    expect(file).not.toBe(".zip");
    expect(file.endsWith(".zip")).toBe(true);
    expect(file.length).toBeGreaterThan(".zip".length);
  });

  it.each(empties)("shareAllFolder(%j) is not empty", (name) => {
    expect(strings.shareAllFolder(name)).not.toBe("");
  });

  it("leaves a name that survives sanitising alone", () => {
    expect(strings.shareBookFilename("Mark/Luke")).toBe("Mark Luke.zip");
    expect(strings.shareAllFolder("Mark/Luke")).toBe("Mark Luke");
  });
});
