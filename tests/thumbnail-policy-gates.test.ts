import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

/**
 * #783: the Android lane, the iOS lane and ci.yml check emitted OBS thumbnails
 * against the reader-gated jpg policy (the iOS lane's own cases are also in
 * `ios-workflow-gates.test.ts`). Each gate is run as the workflow runs it,
 * in both states the policy allows and both it refuses.
 */

const STEP =
  "OBS thumbnails stay out of the precache (web build; ADR 0006 / #177)";
const CI_STEP = "OBS thumbnails stay out of the precache manifest";
const IOS_STEP = "OBS thumbnail precache policy (web build; #177 / ADR 0006)";

function stepScript(file: string, name: string): string {
  const workflow = readFileSync(
    new URL(`../.github/workflows/${file}`, import.meta.url),
    "utf8"
  );
  const start = workflow.indexOf(`      - name: ${name}\n`);
  if (start < 0) throw new Error(`Missing workflow step: ${name}`);
  const rest = workflow.slice(start);
  const next = rest.slice(1).search(/^      - /m);
  const block = next < 0 ? rest : rest.slice(0, next + 1);
  const run = /^        run: \|$/m.exec(block);
  if (!run) throw new Error(`Missing run block in ${name}`);
  const script: string[] = [];
  for (const line of block
    .slice(run.index + run[0].length)
    .split("\n")
    .slice(1)) {
    if (line && !line.startsWith("          ")) break;
    script.push(line.slice(10));
  }
  return script.join("\n");
}

const fixtures: string[] = [];
afterEach(() => {
  for (const f of fixtures.splice(0))
    rmSync(f, { recursive: true, force: true });
});

const current = 'globPatterns: ["**/*.{js,css,html,svg,png,woff2}"]';
const restored = 'globPatterns: ["**/*.{js,css,html,svg,png,jpg,woff2}"]';
const disagree =
  "Emitted OBS thumbnails disagree with the reader-gated jpg policy";
// George round 1 (#1655): a commented-out array above the live one must not
// be read as the policy. The gate reads the raw file, so it refuses to choose.
const decoy = `// ${current}\n${restored}`;
const ambiguous = "More than one globPatterns array in vite.config.ts";

describe.each([
  ["android-apk.yml", STEP],
  ["ci.yml", CI_STEP],
  // #1674 (the twin #783 left): the iOS lane read the first match, so a
  // commented decoy above the live array failed open there.
  ["ios-testflight.yml", IOS_STEP],
])("%s thumbnail gate", (file, name) => {
  it.each([
    {
      label: "jpg configured, thumbnails emitted",
      config: restored,
      thumbs: true,
      status: 0,
    },
    {
      label: "jpg configured, thumbnails missing",
      config: restored,
      thumbs: false,
      status: 1,
    },
    {
      label: "jpg not configured, thumbnails emitted",
      config: current,
      thumbs: true,
      status: 1,
    },
    {
      label: "jpg not configured, none emitted",
      config: current,
      thumbs: false,
      status: 0,
    },
    { label: "no globPatterns", config: "", thumbs: false, status: 1 },
    {
      label: "a commented decoy above the live array, none emitted",
      config: decoy,
      thumbs: false,
      status: 1,
      error: ambiguous,
    },
    {
      label: "a commented decoy above the live array, thumbnails emitted",
      config: decoy,
      thumbs: true,
      status: 1,
      error: ambiguous,
    },
  ])("$label exits $status", ({ config, thumbs, status, error }) => {
    const root = mkdtempSync(path.join(tmpdir(), "thumb-gate-"));
    fixtures.push(root);
    mkdirSync(path.join(root, "dist"));
    writeFileSync(path.join(root, "vite.config.ts"), config);
    writeFileSync(
      path.join(root, "dist/sw.js"),
      'precacheAndRoute([{url:"index.html",revision:"a"}' +
        (thumbs ? ',{url:"obs/thumbs/01/01.jpg",revision:"b"}' : "") +
        "],{});"
    );
    const result = spawnSync("bash", ["-c", stepScript(file, name)], {
      encoding: "utf8",
      cwd: root,
    });
    expect(result.status, result.stderr + result.stdout).toBe(status);
    if (status === 1 && config !== "") {
      expect(result.stderr).toContain(`::error::${error ?? disagree}`);
    }
  });
});
