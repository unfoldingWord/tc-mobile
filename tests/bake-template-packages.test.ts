import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The build step that bakes published template packages into the app (#1450
 * plan tasks 5–6, R6; a child of #1451). Every case runs the script the way a
 * build does, as `node scripts/bake-template-packages.mjs`, through its entry
 * path and its defaults, never through an exported function alone (AGENTS.md
 * "A gate is tested in both states"). Each refusal has a passing twin, so the
 * gate is shown to stay green on the states it must allow.
 *
 * The environment is built from nothing but PATH, so an opt-in flag or a CI
 * branch variable in the shell running the suite cannot leak into a case.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "bake-template-packages.mjs");
const FLAG = "TC_BAKE_PROVISIONAL_TEMPLATES";
const TITUS_FIXTURE = path.join(
  ROOT,
  "tests",
  "fixtures",
  "templates",
  "bible-passages-TIT.json"
);
const TITUS_SHA =
  "4509c28951531b41e16b7c9ae08e523b050ab26e2570cc0e952eabc3d78feeb6";
const TITUS_COMMIT = "ce92d4a1ffd6377cb5636c28c6b92328da5ed2b4";

function bake(args: string[] = [], env: Record<string, string> = {}) {
  if (!existsSync(SCRIPT)) {
    throw new Error(`the bake step does not exist yet: ${SCRIPT}`);
  }
  const run = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    env: { PATH: process.env.PATH ?? "", ...env },
    encoding: "utf8",
  });
  return { status: run.status, out: run.stdout, err: run.stderr };
}

const sha256 = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

const titus = () =>
  JSON.parse(readFileSync(TITUS_FIXTURE, "utf8")) as Record<string, unknown> & {
    source: { url: string; revision: string };
  };

interface Entry {
  id: string;
  source: string;
  revision: string;
  path: string;
  file: string;
  sha256: string;
  provisional: boolean;
  titles?: { path: string; file: string; sha256: string }[];
}

/** A manifest in a fresh directory, with each file written beside it. */
function workspace(
  entries: Entry[],
  files: Record<string, string>
): { manifest: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "bake-templates-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
  const manifest = path.join(dir, "manifest.json");
  writeFileSync(manifest, JSON.stringify({ packages: entries }, null, 2));
  return { manifest };
}

/** Titus as a package entry, with the bytes it is given and their real hash. */
function titusEntry(text: string, over: Partial<Entry> = {}): Entry {
  return {
    id: "bible-passages:TIT",
    source: "https://github.com/unfoldingWord/bible-passages",
    revision: TITUS_COMMIT,
    path: "dist/tc-mobile/TIT.json",
    file: "TIT.json",
    sha256: sha256(text),
    provisional: true,
    ...over,
  };
}

/** Titus as if released at `tag`: its revision and version both set. */
function releasedTitus(tag: string, revision = tag, version = tag.slice(1)) {
  const pkg = titus();
  return JSON.stringify({
    ...pkg,
    version,
    source: { ...pkg.source, revision },
  });
}

describe("the pinned manifest, at the script's default path", () => {
  it("passes with nothing set and leaves the provisional Titus out", () => {
    const run = bake();
    expect(run.err).toBe("");
    expect(run.status).toBe(0);
    expect(run.out).toMatch(/left out bible-passages:TIT \(provisional/);
    expect(run.out).not.toMatch(/^baked /m);
  });

  it("bakes Titus when the build opts in to provisional packages", () => {
    const run = bake([], { [FLAG]: "1" });
    expect(run.err).toBe("");
    expect(run.status).toBe(0);
    expect(run.out).toMatch(/^baked bible-passages:TIT \(provisional\)/m);
  });

  it("pins the same bytes as the #1791 fixture", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(ROOT, "templates", "manifest.json"), "utf8")
    ) as { packages: Entry[] };
    const entry = manifest.packages.find((p) => p.id === "bible-passages:TIT");
    expect(entry).toMatchObject({
      revision: TITUS_COMMIT,
      sha256: TITUS_SHA,
      provisional: true,
    });
    const vendored = readFileSync(path.join(ROOT, "templates", entry!.file));
    expect(sha256(vendored)).toBe(TITUS_SHA);
    expect(vendored.equals(readFileSync(TITUS_FIXTURE))).toBe(true);
  });
});

describe("the production guard: provisional packages never reach main", () => {
  for (const branchVar of ["WORKERS_CI_BRANCH", "GITHUB_REF_NAME"]) {
    it(`refuses an opted-in build whose ${branchVar} is main`, () => {
      const run = bake([], { [FLAG]: "1", [branchVar]: "main" });
      expect(run.status).toBe(1);
      expect(run.err).toMatch(/bible-passages:TIT/);
      expect(run.err).toMatch(/provisional/);
      expect(run.out).not.toMatch(/^baked /m);
    });

    it(`leaves Titus out, and passes, on main with nothing opted in (${branchVar})`, () => {
      const run = bake([], { [branchVar]: "main" });
      expect(run.status).toBe(0);
      expect(run.out).toMatch(/left out bible-passages:TIT/);
    });

    it(`bakes Titus on a branch other than main when opted in (${branchVar})`, () => {
      const run = bake([], { [FLAG]: "1", [branchVar]: "staging" });
      expect(run.status).toBe(0);
      expect(run.out).toMatch(/^baked bible-passages:TIT/m);
    });
  }

  it("refuses a flag value other than 1, rather than reading it as off", () => {
    const run = bake([], { [FLAG]: "true" });
    expect(run.status).toBe(1);
    expect(run.err).toMatch(new RegExp(FLAG));
  });
});

describe("refusals (R6), each beside the state it must allow", () => {
  it("refuses bytes that do not match the pinned SHA-256, naming the file", () => {
    const text = readFileSync(TITUS_FIXTURE, "utf8");
    const { manifest } = workspace(
      [{ ...titusEntry(text), sha256: TITUS_SHA }],
      { "TIT.json": text.replace("TIT.1.1-3", "TIT.1.1-4") }
    );
    const run = bake(["--manifest", manifest], { [FLAG]: "1" });
    expect(run.status).toBe(1);
    expect(run.err).toMatch(/TIT\.json/);
    expect(run.err).toMatch(/sha256/);
  });

  it("refuses a tampered file even when provisional packages are left out", () => {
    const text = readFileSync(TITUS_FIXTURE, "utf8");
    const { manifest } = workspace(
      [{ ...titusEntry(text), sha256: TITUS_SHA }],
      { "TIT.json": `${text} ` }
    );
    expect(bake(["--manifest", manifest]).status).toBe(1);
  });

  it("refuses a non-provisional entry pinned to a commit rather than a tag", () => {
    const text = releasedTitus("v0.1.0");
    const { manifest } = workspace([titusEntry(text, { provisional: false })], {
      "TIT.json": text,
    });
    const run = bake(["--manifest", manifest]);
    expect(run.status).toBe(1);
    expect(run.err).toMatch(/revision/);
  });

  it('refuses a non-provisional package whose source.revision is "unreleased"', () => {
    const text = releasedTitus("v0.1.0", "unreleased");
    const { manifest } = workspace(
      [titusEntry(text, { provisional: false, revision: "v0.1.0" })],
      { "TIT.json": text }
    );
    const run = bake(["--manifest", manifest]);
    expect(run.status).toBe(1);
    expect(run.err).toMatch(/source\.revision/);
  });

  it("refuses a non-provisional package whose version is not the tag without its v", () => {
    const text = releasedTitus("v0.1.0", "v0.1.0", "0.0.0");
    const { manifest } = workspace(
      [titusEntry(text, { provisional: false, revision: "v0.1.0" })],
      { "TIT.json": text }
    );
    const run = bake(["--manifest", manifest]);
    expect(run.status).toBe(1);
    expect(run.err).toMatch(/version/);
  });

  it("bakes a released package pinned to its tag, with nothing opted in", () => {
    const text = releasedTitus("v0.1.0");
    const { manifest } = workspace(
      [titusEntry(text, { provisional: false, revision: "v0.1.0" })],
      { "TIT.json": text }
    );
    const run = bake(["--manifest", manifest], { WORKERS_CI_BRANCH: "main" });
    expect(run.err).toBe("");
    expect(run.status).toBe(0);
    expect(run.out).toMatch(/^baked bible-passages:TIT 0\.1\.0$/m);
  });

  it('allows "unreleased" and 0.0.0 only on a provisional entry', () => {
    const text = readFileSync(TITUS_FIXTURE, "utf8");
    const { manifest } = workspace([titusEntry(text)], { "TIT.json": text });
    expect(bake(["--manifest", manifest], { [FLAG]: "1" }).status).toBe(0);
    const { manifest: hardened } = workspace(
      [titusEntry(text, { provisional: false, revision: "v0.1.0" })],
      { "TIT.json": text }
    );
    expect(bake(["--manifest", hardened], { [FLAG]: "1" }).status).toBe(1);
  });

  const table = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      packageId: "bible-passages:TIT",
      version: "0.0.0",
      language: "en",
      chapters: {},
      segments: { "TIT.1.1-3": "Greeting" },
      ...over,
    });

  function withTable(tableText: string) {
    const text = readFileSync(TITUS_FIXTURE, "utf8");
    return workspace(
      [
        titusEntry(text, {
          titles: [
            {
              path: "dist/tc-mobile/titles/en/TIT.json",
              file: "titles/en/TIT.json",
              sha256: sha256(tableText),
            },
          ],
        }),
      ],
      { "TIT.json": text, "titles/en/TIT.json": tableText }
    ).manifest;
  }

  it("refuses a title table that fails parseTemplateTitleTable, naming the table", () => {
    const run = bake(
      ["--manifest", withTable(table({ segments: { "TIT.P.1": "Greeting" } }))],
      { [FLAG]: "1" }
    );
    expect(run.status).toBe(1);
    expect(run.err).toMatch(/titles\/en\/TIT\.json/);
  });

  it("bakes a title table that fits its package", () => {
    const run = bake(["--manifest", withTable(table())], { [FLAG]: "1" });
    expect(run.err).toBe("");
    expect(run.status).toBe(0);
    expect(run.out).toMatch(
      /^baked bible-passages:TIT \(provisional\), 1 title table$/m
    );
  });

  it("refuses a table whose bytes do not match its pin", () => {
    const text = readFileSync(TITUS_FIXTURE, "utf8");
    const { manifest } = workspace(
      [
        titusEntry(text, {
          titles: [{ path: "t", file: "t.json", sha256: sha256("other") }],
        }),
      ],
      { "TIT.json": text, "t.json": table() }
    );
    const run = bake(["--manifest", manifest], { [FLAG]: "1" });
    expect(run.status).toBe(1);
    expect(run.err).toMatch(/t\.json/);
  });

  it("refuses an entry whose id is not the package's own", () => {
    const text = readFileSync(TITUS_FIXTURE, "utf8");
    const { manifest } = workspace([titusEntry(text, { id: "other:TIT" })], {
      "TIT.json": text,
    });
    const run = bake(["--manifest", manifest], { [FLAG]: "1" });
    expect(run.status).toBe(1);
    expect(run.err).toMatch(/other:TIT/);
  });

  it("refuses a package id listed twice", () => {
    const text = readFileSync(TITUS_FIXTURE, "utf8");
    const { manifest } = workspace([titusEntry(text), titusEntry(text)], {
      "TIT.json": text,
    });
    const run = bake(["--manifest", manifest], { [FLAG]: "1" });
    expect(run.status).toBe(1);
    expect(run.err).toMatch(/twice/);
  });

  it("refuses a manifest it cannot read, naming it", () => {
    const run = bake([
      "--manifest",
      path.join(tmpdir(), "no-such-manifest.json"),
    ]);
    expect(run.status).toBe(1);
    expect(run.err).toMatch(/no-such-manifest\.json/);
  });
});
