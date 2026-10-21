import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { type TitleResolver, planBookFromTemplate } from "@/lib/templates/plan";
import {
  parseTemplatePackage,
  parseTemplateTitleTable,
  titleFor,
} from "@/lib/templates/validate";
import type { TemplatePackage } from "@/types/template";
import { stripComments } from "./support";

/**
 * The pure template-to-book planner (#253, part of #1450). It takes a
 * validated package, a title resolver and a time, and returns the rows of one
 * book. Nothing is written; the storage half of #253 consumes the plan.
 */

const FIXTURES = path.join(__dirname, "fixtures", "templates");
const load = (name: string): unknown =>
  JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8"));
const fixture = (name: string): TemplatePackage =>
  parseTemplatePackage(load(name));

const NOW = 1_760_000_000_000;
const noTitles: TitleResolver = () => undefined;

/** A package with only the given chapters, everything else from a fixture. */
function packageWith(chapters: unknown): TemplatePackage {
  const base = load("bible-book-min.json") as Record<string, unknown>;
  return parseTemplatePackage({ ...base, chapters });
}

const span = (
  startChapter: number,
  startVerse: number,
  endChapter: number,
  endVerse: number
) => ({ book: "MRK", startChapter, startVerse, endChapter, endVerse });

describe("planBookFromTemplate", () => {
  it("is deterministic: the same input gives a deep-equal plan", () => {
    const pkg = fixture("collection-min.json");
    const resolve: TitleResolver = (kind, key) => `${kind}:${key}`;
    const first = planBookFromTemplate(pkg, resolve, NOW);
    const second = planBookFromTemplate(pkg, resolve, NOW);
    expect(second).toEqual(first);
  });

  it("stamps the book with the package's provenance and D5's licence", () => {
    const pkg = fixture("collection-min.json");
    const plan = planBookFromTemplate(pkg, noTitles, NOW);
    expect(plan.provenance).toEqual({
      kind: "template",
      template: {
        id: "collection:psalm-songs",
        version: "0.1.0",
        kind: "collection",
      },
      attribution: "Fixture collection, CC BY-SA 4.0",
    });
    expect(plan.licence).toBe("CC-BY-SA-4.0");
    expect(plan.createdAt).toBe(NOW);
    expect(plan.updatedAt).toBe(NOW);
    expect(plan.modifiedAt).toBe(NOW);
  });

  it("carries each segment's reference, key and thumbnail, in package order", () => {
    const plan = planBookFromTemplate(
      fixture("hymnal-min.json"),
      noTitles,
      NOW
    );
    expect(plan.chapters).toHaveLength(1);
    const [chapter] = plan.chapters;
    expect(chapter?.templateKey).toBe("advent");
    expect(chapter?.createdAt).toBe(NOW);
    expect(chapter?.modifiedAt).toBe(NOW);
    expect(chapter?.segments).toEqual([
      {
        index: 1,
        templateKey: "h-0031",
        reference: {
          book: "HYM",
          startChapter: 31,
          startVerse: 1,
          endChapter: 31,
          endVerse: 4,
        },
        thumbnail: "art/h-0031.png",
        title: null,
        createdAt: NOW,
        modifiedAt: NOW,
      },
      {
        index: 2,
        templateKey: "h-0032",
        reference: {
          book: "HYM",
          startChapter: 32,
          startVerse: null,
          endChapter: 33,
          endVerse: null,
        },
        thumbnail: null,
        title: null,
        createdAt: NOW,
        modifiedAt: NOW,
      },
    ]);
  });

  it("R6: a cross-chapter segment appears once, in the chapter it starts in", () => {
    const pkg = packageWith([
      {
        key: "c1",
        number: 1,
        segments: [
          { key: "a", reference: span(1, 1, 1, 39), thumbnail: null },
          { key: "x", reference: span(1, 40, 2, 5), thumbnail: null },
        ],
      },
      {
        key: "c2",
        number: 2,
        segments: [{ key: "b", reference: span(2, 6, 2, 12), thumbnail: null }],
      },
    ]);
    const plan = planBookFromTemplate(pkg, noTitles, NOW);
    const homes = plan.chapters.flatMap((c) =>
      c.segments.filter((s) => s.templateKey === "x").map(() => c.number)
    );
    expect(homes).toEqual([1]);
    expect(
      plan.chapters.map((c) => c.segments.map((s) => s.templateKey))
    ).toEqual([["a", "x"], ["b"]]);
  });

  it("R7: chapter numbers come from the package, not from position", () => {
    const pkg = packageWith([
      {
        key: "late",
        number: 3,
        segments: [{ key: "l1", reference: null, thumbnail: null }],
      },
      {
        key: "early",
        number: 1,
        segments: [{ key: "e1", reference: null, thumbnail: null }],
      },
    ]);
    const plan = planBookFromTemplate(pkg, noTitles, NOW);
    expect(plan.chapters.map((c) => [c.templateKey, c.number])).toEqual([
      ["late", 3],
      ["early", 1],
    ]);
    // A single chapter numbered 12 is not chapter 1.
    const hymnal = planBookFromTemplate(
      fixture("hymnal-min.json"),
      noTitles,
      NOW
    );
    expect(hymnal.chapters.map((c) => c.number)).toEqual([12]);
  });

  it("plans every fixture package, the synthetic hymnal included", () => {
    const names = readdirSync(FIXTURES).filter(
      (f) => f.endsWith(".json") && !f.startsWith("titles-")
    );
    expect(names).toContain("hymnal-min.json");
    for (const name of names) {
      const pkg = fixture(name);
      const plan = planBookFromTemplate(pkg, noTitles, NOW);
      expect(plan.provenance.template.id).toBe(pkg.id);
      expect(plan.chapters.map((c) => c.templateKey)).toEqual(
        pkg.chapters.map((c) => c.key)
      );
      expect(plan.chapters.map((c) => c.number)).toEqual(
        pkg.chapters.map((c) => c.number)
      );
      const planned = plan.chapters.flatMap((c) =>
        c.segments.map((s) => s.templateKey)
      );
      const listed = pkg.chapters.flatMap((c) => c.segments.map((s) => s.key));
      expect(planned).toEqual(listed);
      for (const c of plan.chapters) {
        expect(c.segments.map((s) => s.index)).toEqual(
          c.segments.map((_, i) => i + 1)
        );
      }
    }
  });

  it("takes titles from the resolver; a missing one is null and never throws", () => {
    const pkg = fixture("collection-min.json");
    const table = parseTemplateTitleTable(
      load("titles-collection-min.es.json"),
      pkg
    );
    const resolve: TitleResolver = (kind, key) =>
      titleFor(table, kind === "chapter" ? "chapters" : "segments", key) ??
      undefined;
    const plan = planBookFromTemplate(pkg, resolve, NOW);
    expect(plan.chapters.map((c) => c.title)).toEqual(["Cantos", null]);
    expect(
      plan.chapters.flatMap((c) => c.segments.map((s) => s.title))
    ).toEqual(["Introducción", "Salmo 17 al 18", null]);

    expect(() => planBookFromTemplate(pkg, noTitles, NOW)).not.toThrow();
    const bare = planBookFromTemplate(pkg, noTitles, NOW);
    expect(bare.chapters.every((c) => c.title === null)).toBe(true);
    expect(
      bare.chapters.every((c) => c.segments.every((s) => s.title === null))
    ).toBe(true);
  });
});

describe("plan.ts is source-agnostic by construction", () => {
  const raw = readFileSync(
    path.join(__dirname, "..", "src", "lib", "templates", "plan.ts"),
    "utf8"
  );
  const code = stripComments(raw);

  it("reads non-empty code", () => {
    expect(code.length).toBeGreaterThan(300);
  });

  it("never branches on kind or a book code, and names no source", () => {
    const branch = /\.kind\b|\bbookCode\b/;
    const named =
      /\bobs\b|open bible|bible|testament|\bnt\b|\bot\b|passages|stories|scripture|psalm|gospel|hymn/i;
    expect(branch.exec(code)?.[0] ?? null).toBeNull();
    expect(named.exec(code)?.[0] ?? null).toBeNull();
  });

  it("holds no `//` inside a string, so the comment strip is sound", () => {
    expect(raw).not.toMatch(/["'`][^"'`\n]*(\/\/|\/\*)[^"'`\n]*["'`]/);
  });
});
