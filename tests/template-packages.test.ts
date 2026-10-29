import "fake-indexeddb/auto";

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFromEntry, newIntent } from "@/hooks/use-template-library";
import { listBooks } from "@/lib/storage/books";
import { loadObsTemplate } from "@/lib/templates/obs";
import { loadTemplateEntries } from "@/lib/templates/packages";
import { TemplateValidationError } from "@/lib/templates/validate";
import { stripCodeComments } from "./strip-code-comments";
import { clearAllStores } from "./support";

/**
 * The build's template package list (#1451's done-when addition, part of
 * #1450): which packages a build ships is a list in
 * `lib/templates/packages.ts`, and the library reads whatever the list holds.
 * A package from a new source is added to a build by adding a loader to the
 * list, with no change to the hook or the picker. The second source here is
 * synthetic (`fixtures/templates/hymnal-min.json`, an invented package that
 * shares nothing with Open Bible Stories); the shipped list stays OBS only.
 */

vi.mock("@/hooks/report-failure", () => ({ reportFailure: vi.fn() }));

const ROOT = path.resolve(import.meta.dirname, "..");
const source = (rel: string) =>
  stripCodeComments(readFileSync(path.join(ROOT, rel), "utf8"), rel);

const hymnal = JSON.parse(
  readFileSync(
    path.join(ROOT, "tests", "fixtures", "templates", "hymnal-min.json"),
    "utf8"
  )
) as Record<string, unknown>;

const hymnalSource = () => Promise.resolve({ pkg: hymnal, titles: [] });

describe("loadTemplateEntries: the package list", () => {
  it("ships Open Bible Stories alone by default", async () => {
    const { entries, failures } = await loadTemplateEntries();
    expect(entries.map((e) => e.pkg.id)).toEqual(["obs"]);
    expect(failures).toEqual([]);
  });

  it("lists a second, synthetic source added to the list, in list order", async () => {
    const { entries, failures } = await loadTemplateEntries([
      loadObsTemplate,
      hymnalSource,
    ]);
    expect(failures).toEqual([]);
    expect(entries.map((e) => e.pkg.id)).toEqual(["obs", "hymnal:fixture"]);
    expect(entries[1]?.pkg.kind).toBe("hymnal");
    expect(entries[0]?.titles).toHaveLength(1);
    expect(entries[1]?.titles).toEqual([]);
  });

  it("skips a loader that rejects and keeps the others, handing back the cause", async () => {
    const cause = new Error("chunk failed to load");
    const { entries, failures } = await loadTemplateEntries([
      () => Promise.reject(cause),
      hymnalSource,
    ]);
    expect(entries.map((e) => e.pkg.id)).toEqual(["hymnal:fixture"]);
    expect(failures).toEqual([cause]);
  });

  it("skips a loader that throws before it returns a promise", async () => {
    const cause = new Error("thrown synchronously");
    const { entries, failures } = await loadTemplateEntries([
      hymnalSource,
      () => {
        throw cause;
      },
    ]);
    expect(entries.map((e) => e.pkg.id)).toEqual(["hymnal:fixture"]);
    expect(failures).toEqual([cause]);
  });

  it("validates every source at the seam: a package the contract refuses is a failure, not an entry", async () => {
    const { entries, failures } = await loadTemplateEntries([
      () =>
        Promise.resolve({ pkg: { ...hymnal, formatVersion: 9 }, titles: [] }),
      loadObsTemplate,
    ]);
    expect(entries.map((e) => e.pkg.id)).toEqual(["obs"]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toBeInstanceOf(TemplateValidationError);
  });

  it("validates a source's title tables against its own package", async () => {
    const { entries, failures } = await loadTemplateEntries([
      () =>
        Promise.resolve({
          pkg: hymnal,
          titles: [
            {
              packageId: "obs",
              version: "0.1.0",
              language: "fr",
              chapters: {},
              segments: {},
            },
          ],
        }),
    ]);
    expect(entries).toEqual([]);
    expect(failures[0]).toBeInstanceOf(TemplateValidationError);
  });

  it("refuses a second package under an id already listed, keeping the first", async () => {
    const { entries, failures } = await loadTemplateEntries([
      hymnalSource,
      () =>
        Promise.resolve({
          pkg: { ...hymnal, kind: "songbook" },
          titles: [],
        }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.pkg.kind).toBe("hymnal");
    expect(failures).toHaveLength(1);
    expect(String(failures[0])).toContain("hymnal:fixture");
  });

  it("lists every package a source hands back, and skips only the bad one", async () => {
    const { entries, failures } = await loadTemplateEntries([
      () =>
        Promise.resolve([
          { pkg: { ...hymnal, formatVersion: 9 }, titles: [] },
          { pkg: hymnal, titles: [] },
          { pkg: hymnal, titles: [] },
        ]),
      loadObsTemplate,
    ]);
    expect(entries.map((e) => e.pkg.id)).toEqual(["hymnal:fixture", "obs"]);
    expect(failures).toHaveLength(2);
    expect(failures[0]).toBeInstanceOf(TemplateValidationError);
    expect(String(failures[1])).toContain("listed twice");
  });

  it("answers an empty list with no entries and no failures", async () => {
    expect(await loadTemplateEntries([])).toEqual({
      entries: [],
      failures: [],
    });
  });
});

describe("the create path writes a book from the second source unchanged", () => {
  beforeEach(async () => {
    await clearAllStores();
  });

  it("creates the synthetic package's book through the hook's own create", async () => {
    const { entries } = await loadTemplateEntries([
      loadObsTemplate,
      hymnalSource,
    ]);
    const second = entries[1];
    if (second === undefined) throw new Error("the second entry is missing");
    const outcome = await createFromEntry(newIntent(second), "Cantiques");
    expect(outcome).toEqual({ ok: true });
    const books = await listBooks();
    expect(books).toHaveLength(1);
    expect(books[0]?.name).toBe("Cantiques");
    expect(books[0]?.chapterIds).toHaveLength(1);
  });
});

describe("no app module names a dataset source (#1450 R9)", () => {
  // What a source-specific branch would have to spell: the dataset repo and
  // the Bible-book kind (the scope's own words), plus every id and source
  // repo the bake manifest pins, so a package added there is covered too.
  // `bible-books` (#1606's chapter-count table) is not a dataset name.
  const manifest = JSON.parse(
    readFileSync(path.join(ROOT, "templates", "manifest.json"), "utf8")
  ) as { packages: { id: string; source: string }[] };
  const names = [
    "bible-passages",
    ...manifest.packages.flatMap((p) => [p.id, p.source.split("/").pop()!]),
  ];
  const named = (text: string) =>
    names.some((n) => text.includes(n)) || /bible-book(?!s)/.test(text);

  it("holds for every module under src/, comments aside", () => {
    const files = readdirSync(path.join(ROOT, "src"), {
      recursive: true,
      encoding: "utf8",
    }).filter((f) => /\.tsx?$/.test(f));
    expect(files.length).toBeGreaterThan(20);
    expect(manifest.packages.length).toBeGreaterThan(0);
    expect(files.filter((f) => named(source(path.join("src", f))))).toEqual([]);
  });

  it("reads a name in code and ignores one in a comment", () => {
    expect(named(stripCodeComments('const k = "bible-book";', "x.ts"))).toBe(
      true
    );
    expect(
      named(stripCodeComments("// bible-passages\nconst a = 1;", "x.ts"))
    ).toBe(false);
  });
});

describe("no package is named outside the list", () => {
  it("the library hook names no package and reads the list", () => {
    const hook = source("src/hooks/use-template-library.ts");
    expect(hook).not.toMatch(/loadObsTemplate/);
    expect(hook).not.toMatch(/\bobs\b/i);
    expect(hook).toMatch(/\bloadTemplateEntries\(\)/);
  });

  it("the picker names no package", () => {
    const picker = source("src/components/template-picker.tsx");
    expect(picker).not.toMatch(/loadObsTemplate/);
    expect(picker).not.toMatch(/\bobs\b/i);
  });

  it("packages.ts is the one src module that names loadObsTemplate, comments aside", () => {
    const files = readdirSync(path.join(ROOT, "src"), {
      recursive: true,
      encoding: "utf8",
    }).filter((f) => /\.tsx?$/.test(f));
    expect(files.length).toBeGreaterThan(20);
    const importers = files
      .filter((f) => f !== path.join("lib", "templates", "obs.ts"))
      .filter((f) => /\bloadObsTemplate\b/.test(source(path.join("src", f))));
    expect(importers).toEqual([path.join("lib", "templates", "packages.ts")]);
  });
});
