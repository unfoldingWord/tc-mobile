import { describe, expect, it } from "vitest";

import { loadObsTemplate } from "@/lib/templates/obs";
import {
  parseTemplatePackage,
  parseTemplateTitleTable,
  titleFor,
} from "@/lib/templates/validate";

// #1466: the bundled stories described as a template package, the same shape
// every other source is published in (#1465).
const { pkg, titles } = await loadObsTemplate();

describe("the bundled stories as a template package", () => {
  it("passes the package validator", () => {
    // The loader validates already; parsing its output again proves the
    // returned value, not just an intermediate, is a valid package.
    expect(parseTemplatePackage(pkg)).toEqual(pkg);
  });

  it("has 50 chapters keyed 01 to 50, numbered by story", () => {
    expect(pkg.chapters).toHaveLength(50);
    expect(pkg.chapters.map((c) => c.key)).toEqual(
      Array.from({ length: 50 }, (_, i) => String(i + 1).padStart(2, "0"))
    );
    expect(pkg.chapters.map((c) => c.number)).toEqual(
      Array.from({ length: 50 }, (_, i) => i + 1)
    );
  });

  it("has 598 segments with unique keys", () => {
    const keys = pkg.chapters.flatMap((c) => c.segments.map((s) => s.key));
    expect(keys).toHaveLength(598);
    expect(new Set(keys).size).toBe(598);
  });

  it("gives story 1 frame 7 its one-verse span and bundled thumbnail", () => {
    const seg = pkg.chapters[0]?.segments[6];
    expect(seg).toEqual({
      key: "01-07",
      reference: {
        book: "OBS",
        startChapter: 1,
        startVerse: 7,
        endChapter: 1,
        endVerse: 7,
      },
      thumbnail: "obs/thumbs/obs-01-07.jpg",
    });
  });

  it("gives the last frame of the last story its span", () => {
    const last = pkg.chapters[49]?.segments.at(-1);
    expect(last?.key).toBe("50-17");
    expect(last?.reference).toEqual({
      book: "OBS",
      startChapter: 50,
      startVerse: 17,
      endChapter: 50,
      endVerse: 17,
    });
  });

  it("carries the pinned source revision, the licences and the attribution", () => {
    expect(pkg.id).toBe("obs");
    expect(pkg.kind).toBe("obs");
    expect(pkg.bookCode).toBe("OBS");
    expect(pkg.source.revision).toBe(
      "75236873a3ac8203117df9e9f781614e62a0a3ec"
    );
    expect(pkg.source.revision).not.toBe("master");
    expect(pkg.dataLicence).toBe("CC-BY-SA-4.0");
    expect(pkg.recordingLicence).toBe("CC-BY-SA-4.0");
    expect(pkg.attribution).toMatch(/Sweet Publishing/);
  });
});

describe("the English title table", () => {
  it("is one table, in English, valid against the package", () => {
    expect(titles.map((t) => t.language)).toEqual(["en"]);
    const [en] = titles;
    expect(parseTemplateTitleTable(en, pkg)).toEqual(en);
  });

  it("has 50 chapter titles and no segment titles", () => {
    const [en] = titles;
    expect(Object.keys(en?.chapters ?? {})).toHaveLength(50);
    expect(en?.segments).toEqual({});
    expect(titleFor(en ?? null, "chapters", "01")).toBe("The Creation");
    expect(titleFor(en ?? null, "segments", "01-07")).toBeNull();
  });
});
