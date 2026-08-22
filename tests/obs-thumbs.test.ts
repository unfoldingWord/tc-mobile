import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import catalog from "@/data/obs-catalog.json";
import { thumbUrl } from "@/lib/obs/catalog";
import type { ObsCatalog } from "@/types/obs";

const obs = catalog as unknown as ObsCatalog;
const PUBLIC = path.resolve(import.meta.dirname, "../public");

const localPath = (story: number, frame: number) =>
  path.join(PUBLIC, thumbUrl(story, frame));

describe("bundled thumbnail files", () => {
  it("exists on disk for every frame in the catalogue", () => {
    const missing: string[] = [];
    for (const story of obs.stories) {
      for (const frame of story.frames) {
        if (!existsSync(localPath(story.story, frame.frame))) {
          missing.push(thumbUrl(story.story, frame.frame));
        }
      }
    }
    expect(
      missing,
      `missing thumbnails: ${missing.slice(0, 5).join(", ")}`
    ).toHaveLength(0);
  });

  it("is never a zero-byte or truncated file", () => {
    // A failed fetch that still wrote a file would pass the existence check
    // and render as a broken tile on every device.
    const tiny: string[] = [];
    for (const story of obs.stories) {
      for (const frame of story.frames) {
        if (statSync(localPath(story.story, frame.frame)).size < 512) {
          tiny.push(thumbUrl(story.story, frame.frame));
        }
      }
    }
    expect(
      tiny,
      `suspiciously small: ${tiny.slice(0, 5).join(", ")}`
    ).toHaveLength(0);
  });

  it("keeps the whole set small enough to bundle", () => {
    // Guards the decision in ADR 0006: if this set ever grows toward the
    // source 46.8 MB, bundling stops being the right call and the download
    // path has to come back.
    let bytes = 0;
    for (const story of obs.stories) {
      for (const frame of story.frames) {
        bytes += statSync(localPath(story.story, frame.frame)).size;
      }
    }
    const mb = bytes / 1024 / 1024;
    expect(mb).toBeLessThan(6);
    expect(mb).toBeGreaterThan(0.5);
  });
});
