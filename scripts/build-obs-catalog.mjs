#!/usr/bin/env node
/**
 * Build the bundled Open Bible Stories catalogue.
 *
 * Fetches unfoldingWord/en_obs from Door43 and flattens it into one JSON file
 * the app can load without a network. Story text is small enough to bundle
 * outright (~190 KB for all fifty); the artwork is not (46.8 MB at 360px), so
 * only image URLs are recorded here. B0 (#26) removed the on-demand IndexedDB
 * image cache; the pre-pivot recording view now loads those URLs straight from
 * the Door43 CDN with an `<img>` until B2/B3 replace it.
 *
 * OBS is CC BY-SA 4.0 and the artwork is © Sweet Publishing — see
 * docs/decisions/0006-obs-content.md. Attribution travels in the catalogue
 * itself so it cannot be separated from the content by accident.
 *
 *   node scripts/build-obs-catalog.mjs
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const RAW = "https://git.door43.org/api/v1/repos/unfoldingWord/en_obs/raw";
const OUT = path.resolve(import.meta.dirname, "../src/data/obs-catalog.json");

const IMAGE_RE = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
const REFERENCE_RE = /^_(.+)_\s*$/;

/** `.../obs-en-01-07.jpg` → { story: 1, frame: 7 } */
function parseImageName(url) {
  const m = /obs-en-(\d+)-(\d+)\.\w+$/.exec(url);
  if (!m) return null;
  return { story: Number(m[1]), frame: Number(m[2]) };
}

function parseStory(markdown, storyNumber) {
  const lines = markdown.split("\n");
  const title = (lines.find((l) => l.startsWith("# ")) ?? "")
    .replace(/^#\s*/, "")
    .replace(/^\d+\.\s*/, "")
    .trim();

  // The closing italic line is the scripture reference ("_A Bible story from:
  // Genesis 1-2_"). It is the last italic line, not merely any italic line.
  let reference = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = REFERENCE_RE.exec(lines[i].trim());
    if (m) {
      reference = m[1].replace(/^A Bible story from:\s*/i, "").trim();
      break;
    }
  }

  // Frames are image/paragraph pairs: each image opens a frame and the prose
  // until the next image is that frame's text.
  const frames = [];
  const parts = markdown.split(IMAGE_RE);
  // split() with one capture group yields [pre, url, text, url, text, ...]
  for (let i = 1; i < parts.length; i += 2) {
    const url = parts[i].trim();
    const text = parts[i + 1]
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !REFERENCE_RE.test(l) && !l.startsWith("#"))
      .join(" ")
      .trim();
    const named = parseImageName(url);
    frames.push({
      frame: named?.frame ?? (i + 1) / 2,
      image: url,
      text,
    });
  }

  return { story: storyNumber, title, reference, frames };
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

const stories = [];
for (let n = 1; n <= 50; n++) {
  const id = String(n).padStart(2, "0");
  const md = await fetchText(`${RAW}/content/${id}.md`);
  const story = parseStory(md, n);
  if (story.frames.length === 0) {
    throw new Error(`Story ${id} parsed to zero frames — parser is wrong`);
  }
  stories.push(story);
  process.stdout.write(`\r  story ${id}: ${story.frames.length} frames   `);
}
process.stdout.write("\n");

const catalogue = {
  source: "https://git.door43.org/unfoldingWord/en_obs",
  license: "CC BY-SA 4.0",
  attribution:
    "unfoldingWord® Open Bible Stories, CC BY-SA 4.0. Artwork © Sweet Publishing, CC BY-SA 3.0.",
  imageBase: "https://cdn.door43.org/obs/jpg/360px/",
  generatedFrom: "en_obs master",
  stories,
};

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(catalogue, null, 2) + "\n", "utf8");

const frames = stories.reduce((n, s) => n + s.frames.length, 0);
console.log(`Wrote ${OUT}`);
console.log(`  ${stories.length} stories, ${frames} frames`);
