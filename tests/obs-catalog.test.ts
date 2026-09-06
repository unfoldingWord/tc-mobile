import { describe, expect, it } from "vitest";

import catalog from "@/data/obs-catalog.json";
import {
  listStories,
  obsFrameScope,
  obsTemplate,
  OBS_BOOK_CODE,
  thumbUrl,
} from "@/lib/obs/catalog";
import { isValidScope, parseScope } from "@/lib/scripture/scope";
import type { ObsCatalog } from "@/types/obs";

const obs = catalog as unknown as ObsCatalog;

describe("bundled OBS catalogue", () => {
  it("has all fifty stories in order", () => {
    expect(obs.stories).toHaveLength(50);
    expect(obs.stories.map((s) => s.story)).toEqual(
      Array.from({ length: 50 }, (_, i) => i + 1)
    );
  });

  it("has 598 frames, numbered sequentially within each story", () => {
    let total = 0;
    for (const story of obs.stories) {
      total += story.frames.length;
      expect(
        story.frames.map((f) => f.frame),
        `story ${story.story}`
      ).toEqual(Array.from({ length: story.frames.length }, (_, i) => i + 1));
    }
    expect(total).toBe(598);
  });

  it("gives every frame artwork and text", () => {
    for (const story of obs.stories) {
      for (const frame of story.frames) {
        expect(
          frame.image,
          `story ${story.story} frame ${frame.frame}`
        ).toMatch(
          /^https:\/\/cdn\.door43\.org\/obs\/jpg\/360px\/obs-en-\d{2}-\d{2}\.jpg$/
        );
        expect(frame.text.length).toBeGreaterThan(0);
      }
    }
  });

  it("never leaks the trailing scripture reference into frame text", () => {
    // The reference is a separate field; if the parser regresses it shows up
    // appended to the final frame of every story.
    for (const story of obs.stories) {
      for (const frame of story.frames) {
        expect(frame.text).not.toMatch(/A Bible story from/i);
      }
    }
  });

  it("gives every story a title and a reference", () => {
    for (const story of obs.stories) {
      expect(story.title.length, `story ${story.story}`).toBeGreaterThan(0);
      expect(story.reference, `story ${story.story}`).toBeTruthy();
    }
  });

  it("carries the attribution the licence requires", () => {
    expect(obs.license).toBe("CC BY-SA 4.0");
    expect(obs.attribution).toMatch(/unfoldingWord/);
    expect(obs.attribution).toMatch(/Sweet Publishing/);
  });

  it("names the image URL in a frame consistent with its story number", () => {
    for (const story of obs.stories.slice(0, 5)) {
      for (const frame of story.frames) {
        const m = /obs-en-(\d{2})-(\d{2})\.jpg$/.exec(frame.image)!;
        expect(Number(m[1])).toBe(story.story);
        expect(Number(m[2])).toBe(frame.frame);
      }
    }
  });
});

describe("obsFrameScope", () => {
  it("produces a scope string the burrito grammar accepts", () => {
    expect(obsFrameScope(1, 7)).toBe("1:7");
    expect(isValidScope(obsFrameScope(1, 7))).toBe(true);
    expect(parseScope(obsFrameScope(50, 17))).toEqual({
      startChapter: 50,
      startVerse: 17,
      endChapter: 50,
      endVerse: 17,
    });
  });

  it("produces a valid scope for every frame in the catalogue", () => {
    for (const story of obs.stories) {
      for (const frame of story.frames) {
        expect(isValidScope(obsFrameScope(story.story, frame.frame))).toBe(
          true
        );
      }
    }
  });

  it("uses OBS as the book code", () => {
    expect(OBS_BOOK_CODE).toBe("OBS");
  });
});

describe("bundled thumbnails", () => {
  it("maps a frame to its zero-padded local path", () => {
    expect(thumbUrl(1, 7)).toBe("/obs/thumbs/obs-01-07.jpg");
    expect(thumbUrl(50, 17)).toBe("/obs/thumbs/obs-50-17.jpg");
  });

  it("is a same-origin path, never the CDN", () => {
    // The list must work offline on first run; a CDN URL here would silently
    // reintroduce a network dependency on the primary path.
    for (const story of obs.stories.slice(0, 3)) {
      for (const frame of story.frames) {
        const url = thumbUrl(story.story, frame.frame);
        expect(url.startsWith("/obs/thumbs/")).toBe(true);
        expect(url).not.toMatch(/^https?:/);
      }
    }
  });

  it("generates a unique path for every frame in the catalogue", () => {
    const seen = new Set<string>();
    for (const story of obs.stories) {
      for (const frame of story.frames) {
        seen.add(thumbUrl(story.story, frame.frame));
      }
    }
    expect(seen.size).toBe(598);
  });
});

describe("listStories", () => {
  it("lists all 50 stories with title and frame count, no frame text or artwork", async () => {
    const stories = await listStories();
    expect(stories).toHaveLength(50);
    expect(stories.map((s) => s.story)).toEqual(
      Array.from({ length: 50 }, (_, i) => i + 1)
    );
    for (const s of stories) {
      const full = obs.stories.find((story) => story.story === s.story)!;
      expect(s.title).toBe(full.title);
      expect(s.frameCount).toBe(full.frames.length);
      expect(s).not.toHaveProperty("frames");
    }
  });
});

describe("obsTemplate (#253)", () => {
  it("builds one chapter per story and one segment per frame, all 50 stories, 598 segments total", async () => {
    const template = await obsTemplate();
    expect(template.id).toBe("obs");
    expect(template.title).toBe("Open Bible Stories");

    const chapters = template.chapters();
    expect(chapters).toHaveLength(50);
    expect(chapters.map((c) => c.number)).toEqual(
      Array.from({ length: 50 }, (_, i) => i + 1)
    );

    let totalSegments = 0;
    for (const chapter of chapters) {
      const story = obs.stories.find((s) => s.story === chapter.number)!;
      expect(chapter.segments).toHaveLength(story.frames.length);
      totalSegments += chapter.segments.length;
    }
    expect(totalSegments).toBe(598);
  });

  it("references every segment via obsFrameScope, addressed to OBS_BOOK_CODE", async () => {
    const template = await obsTemplate();
    for (const chapter of template.chapters()) {
      chapter.segments.forEach((segment, i) => {
        const frame = i + 1;
        expect(segment.reference).toEqual({
          book: OBS_BOOK_CODE,
          scope: obsFrameScope(chapter.number, frame),
        });
      });
    }
  });

  it("stamps provenance to the vendored catalogue's source ref", async () => {
    const template = await obsTemplate();
    expect(template.source).toEqual({
      kind: "obs",
      catalogVersion: obs.generatedFrom,
    });
  });

  it("is pure: calling chapters() twice gives equal, independent structures", async () => {
    const template = await obsTemplate();
    expect(template.chapters()).toEqual(template.chapters());
    expect(template.chapters()).not.toBe(template.chapters());
  });
});
