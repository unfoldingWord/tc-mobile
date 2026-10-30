import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AREA_DIR, readAreaCss } from "./o4-area-css";
import { stripCssComments } from "./support";

/**
 * The ten per-area O4 stylesheets, pre-created ahead of batch 1 so its five
 * parallel lanes (#941-#945, #946-#950) never collide on this one index —
 * two lanes editing `3-components/index.css` in the same batch is the exact defect
 * this pre-creation exists to avoid.
 *
 * A SOURCE-text check, deliberately not gated behind `REQUIRE_DIST_BUILD`:
 * unlike the cascade position, which `tests/component-cascade.test.ts` reads
 * from the build (#954), "does the file exist and is it imported" needs no
 * build to answer, so `npm run test` alone catches a lane deleting one of
 * these on purpose or by accident.
 */
// Read without its comments (#822): a commented-out `@import` still holds the
// exact text the assertion below looks for, so a raw read passed with an area
// file no longer wired in.
const INDEX_SOURCE = stripCssComments(readAreaCss("index"));

const AREA_FILES = [
  "books.css",
  "sheets.css",
  "segments.css",
  "recorder.css",
  "menus.css",
  "controls.css",
  "dialogs.css",
  "share.css",
  "errors.css",
  "motion.css",
];

describe("the ten pre-created O4 area stylesheets exist and are wired in", () => {
  it.each(AREA_FILES)("%s exists on disk", (name) => {
    expect(existsSync(path.join(AREA_DIR, name)), name).toBe(true);
  });

  it.each(AREA_FILES)("%s is imported from 3-components/index.css", (name) => {
    expect(INDEX_SOURCE, name).toContain(`@import "./${name}";`);
  });
});
