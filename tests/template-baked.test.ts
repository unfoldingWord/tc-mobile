import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { loadTemplateEntries } from "@/lib/templates/packages";

/**
 * The baked packages reach the library through the default package list
 * (#1450 plan task 6). A test run has no bake, so the committed module is an
 * empty list; here it is replaced with what a build that baked the pinned
 * Titus package would hand the app, and the default list must carry it after
 * Open Bible Stories, with nothing else changed.
 */

vi.mock("@/data/baked-template-packages.json", async () => {
  const { readFileSync: read } = await import("node:fs");
  const file = new URL("../templates/bible-passages/TIT.json", import.meta.url);
  return { default: [{ pkg: JSON.parse(read(file, "utf8")), titles: [] }] };
});

const ROOT = path.resolve(import.meta.dirname, "..");

describe("the default package list reads the baked packages", () => {
  it("lists a baked package after Open Bible Stories", async () => {
    const { entries, failures } = await loadTemplateEntries();
    expect(failures).toEqual([]);
    expect(entries.map((e) => e.pkg.id)).toEqual(["obs", "bible-passages:TIT"]);
  });

  it("is the vendored package, unchanged by the seam's validation", async () => {
    const { entries } = await loadTemplateEntries();
    const vendored = JSON.parse(
      readFileSync(
        path.join(ROOT, "templates", "bible-passages", "TIT.json"),
        "utf8"
      )
    ) as unknown;
    expect(entries[1]?.pkg).toStrictEqual(vendored);
  });
});
