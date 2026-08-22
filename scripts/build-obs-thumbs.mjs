#!/usr/bin/env node
/**
 * Generate the bundled OBS thumbnail set.
 *
 * The Door43 CDN publishes frame artwork at 360px and 2160px only. The section
 * list renders tiles at 48–56px, so 360px is ~16x more image than the primary
 * path can use: the full set is 46.8 MB at source and 2.9 MB centre-cropped to
 * 128px (2x the largest tile). At that size the artwork can simply ship with
 * the app, which removes the whole per-story download dance from the list and
 * makes it work offline on first run.
 *
 * Modification for CC BY-SA purposes: images are centre-cropped to a square and
 * downscaled. Recorded in docs/decisions/0006-obs-content.md.
 *
 *   node scripts/build-obs-thumbs.mjs
 */

import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "public", "obs", "thumbs");
const SIZE = 128;
const QUALITY = 78;
const CONCURRENCY = 12;

const catalog = JSON.parse(
  await readFile(path.join(ROOT, "src/data/obs-catalog.json"), "utf8")
);

const jobs = catalog.stories.flatMap((s) =>
  s.frames.map((f) => ({ story: s.story, frame: f.frame, url: f.image }))
);

await mkdir(OUT, { recursive: true });

const name = (story, frame) =>
  `obs-${String(story).padStart(2, "0")}-${String(frame).padStart(2, "0")}.jpg`;

let done = 0;
let bytes = 0;
const failures = [];

async function run({ story, frame, url }) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const input = Buffer.from(await res.arrayBuffer());
    const out = await sharp(input)
      .resize(SIZE, SIZE, { fit: "cover", position: "centre" })
      .jpeg({ quality: QUALITY, progressive: true, mozjpeg: true })
      .toBuffer();
    await writeFile(path.join(OUT, name(story, frame)), out);
    bytes += out.byteLength;
  } catch (cause) {
    failures.push(`${name(story, frame)}: ${String(cause)}`);
  }
  done++;
  if (done % 50 === 0) process.stdout.write(`\r  ${done}/${jobs.length}   `);
}

// Simple fixed-size worker pool — 598 parallel fetches would get us throttled.
const queue = [...jobs];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (let job = queue.pop(); job; job = queue.pop()) await run(job);
  })
);

process.stdout.write(`\r  ${done}/${jobs.length}   \n`);
if (failures.length > 0) {
  console.error(`\n${failures.length} FAILED:`);
  for (const f of failures.slice(0, 10)) console.error("  " + f);
  process.exitCode = 1;
} else {
  console.log(
    `Wrote ${jobs.length} thumbnails to public/obs/thumbs — ` +
      `${(bytes / 1024 / 1024).toFixed(1)} MB total, ` +
      `${(bytes / jobs.length / 1024).toFixed(1)} KB average.`
  );
}
