import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * #1608: the trademark notice travels with the app's MIT text, in the repo's
 * LICENSE and in the copy shown under Menu -> About & licenses, kept outside
 * the MIT text, and it names where to ask for permission.
 */
const ROOT = path.resolve(import.meta.dirname, "..");
const MARKER = "Trademark notice (not part of the MIT license):";
const CONTACT = "https://unfoldingword.org/contact-us/";

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("trademark notice (#1608)", () => {
  const files = ["LICENSE", "public/licenses/MIT.txt"] as const;

  it.each(files)("%s carries the notice after the MIT text", (rel) => {
    const text = read(rel);
    const at = text.indexOf(MARKER);
    expect(at).toBeGreaterThan(text.indexOf("SOFTWARE.\n"));
    const notice = text.slice(at);
    expect(notice).toContain(
      "translationCore is a trademark of unfoldingWord®"
    );
    expect(notice).toContain("the unfoldingWord® name or logo");
    expect(notice).not.toContain("support@unfoldingword.org");
    expect(notice).toContain(CONTACT);
  });

  it("the MIT text and the notice are identical in both files", () => {
    expect(read("public/licenses/MIT.txt").trimEnd()).toBe(
      read("LICENSE").trimEnd()
    );
  });
});
