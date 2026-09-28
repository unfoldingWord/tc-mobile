import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// #577: package.json's declared `engines.node` must not admit a Node line
// that a render-test dependency (jsdom, and its transitives @exodus/bytes
// and html-encoding-sniffer) declares itself incompatible with — concretely,
// the Node 23.x line, which sits between the ^22.x and >=24.0.0 halves of
// their shared three-part range.
//
// 2026-09-26: the floor itself moved, from 22.12.0 to 22.22.2 — DRI decision
// (verbatim): "Raise to ^22.22.2 (Recommended)". The binding reason is
// lint-staged 17.5.1's own declared `engines.node` (`>=22.22.1`, already
// installed via #503): 22.12.0 never satisfied it, so `engines.node` admitting
// 22.12.0 was already wrong. eslint 10 (`^22.13`, dependabot #989) and jsdom 30
// (`^22.22.2`, dependabot #990) are cited as the same class of reason in the
// PR that raised this, but neither is installed yet, so only lint-staged's
// range is checked here mechanically.
//
// 2026-09-26 (later same day, #990 unblock): jsdom 30.1.1 (Dependabot PR
// #990, not merged yet — package-lock.json still locks jsdom 27.4.0) and its
// transitive dependencies (@asamuzakjp/css-color, dom-selector,
// w3c-xmlserializer, undici) require Node `^22.22.2 || ^24.15.0 || >=26.0.0`.
// DRI decision (verbatim): "Drop 24.0–24.14 and 25 (Recommended)". This
// range is adopted here ahead of #990 landing, so the range no longer agrees
// with jsdom 27's own currently-locked, wider range (`^20.19.0 || ^22.12.0 ||
// >=24.0.0`) at every version — only a subset holds now (see the "agrees
// with jsdom" test below, rewritten to a one-directional check).
const ROOT = path.join(import.meta.dirname, "..");

const packageJson: { engines?: { node?: string } } = JSON.parse(
  readFileSync(path.join(ROOT, "package.json"), "utf8")
);

const ENGINE_RANGE = packageJson.engines?.node;

const packageLock: {
  packages: Record<string, { engines?: { node?: string } }>;
} = JSON.parse(readFileSync(path.join(ROOT, "package-lock.json"), "utf8"));

const JSDOM_RANGE = packageLock.packages["node_modules/jsdom"]?.engines?.node;
const LINT_STAGED_RANGE =
  packageLock.packages["node_modules/lint-staged"]?.engines?.node;

// The installed `semver` CLI (a transitive dev dependency already in the
// lockfile — see `node_modules/semver`) is an independent oracle for "does
// this Node version satisfy this range", the same check `npm`'s own
// engine-strict gate performs internally. This needs no network fetch and
// no second Node install: `-r <range> <version>` prints the version and
// exits 0 when it matches, and prints nothing and exits non-zero when it
// does not.
const SEMVER_BIN = path.join(ROOT, "node_modules", ".bin", "semver");

function satisfiesRange(range: string, version: string): boolean {
  try {
    const out = execFileSync(SEMVER_BIN, ["-r", range, version], {
      encoding: "utf8",
    }).trim();
    return out === version;
  } catch {
    return false;
  }
}

describe("declared engines.node range (#577, floor raise 2026-09-26)", () => {
  it("is declared", () => {
    expect(ENGINE_RANGE).toBeTruthy();
  });

  it("excludes Node 23.x, the line jsdom's own engine range excludes", () => {
    expect(satisfiesRange(ENGINE_RANGE!, "23.0.0")).toBe(false);
    expect(satisfiesRange(ENGINE_RANGE!, "23.6.0")).toBe(false);
  });

  it("admits the stated floor, 22.22.2", () => {
    expect(satisfiesRange(ENGINE_RANGE!, "22.22.2")).toBe(true);
  });

  it("no longer admits the pre-raise floor, 22.12.0 — it fails lint-staged's own declared floor", () => {
    expect(LINT_STAGED_RANGE).toBeTruthy();
    // lint-staged 17.5.1 declares `>=22.22.1`; 22.12.0 never satisfied that,
    // so it is the binding reason 22.12.0 must not be admitted here either.
    // Reverting `engines.node` to `^22.12.0 || >=24.0.0` makes ENGINE_RANGE
    // admit 22.12.0 again while lint-staged still does not — this assertion
    // is what dies on that mutation.
    expect(satisfiesRange(LINT_STAGED_RANGE!, "22.12.0")).toBe(false);
    expect(satisfiesRange(ENGINE_RANGE!, "22.12.0")).toBe(
      satisfiesRange(LINT_STAGED_RANGE!, "22.12.0")
    );
  });

  it('admits the rest of the 22.x line, including what CI\'s node-version: "22" resolves to', () => {
    expect(satisfiesRange(ENGINE_RANGE!, "22.99.99")).toBe(true);
  });

  it("excludes Node 24.0.0-24.14.x, dropped per the DRI decision (jsdom 30 / #990)", () => {
    expect(satisfiesRange(ENGINE_RANGE!, "24.0.0")).toBe(false);
    expect(satisfiesRange(ENGINE_RANGE!, "24.5.0")).toBe(false);
    expect(satisfiesRange(ENGINE_RANGE!, "24.14.0")).toBe(false);
  });

  it("admits Node 24.15.0 and the rest of the 24.x line", () => {
    expect(satisfiesRange(ENGINE_RANGE!, "24.15.0")).toBe(true);
    expect(satisfiesRange(ENGINE_RANGE!, "24.99.99")).toBe(true);
  });

  it("excludes Node 25.x, dropped per the DRI decision", () => {
    expect(satisfiesRange(ENGINE_RANGE!, "25.0.0")).toBe(false);
    expect(satisfiesRange(ENGINE_RANGE!, "25.9.9")).toBe(false);
  });

  it("admits Node 26, the next supported line", () => {
    expect(satisfiesRange(ENGINE_RANGE!, "26.0.0")).toBe(true);
    expect(satisfiesRange(ENGINE_RANGE!, "26.5.0")).toBe(true);
  });

  it("this environment's own Node satisfies the declared range", () => {
    expect(satisfiesRange(ENGINE_RANGE!, process.versions.node)).toBe(true);
  });

  it("is at least as strict as jsdom's own currently-locked engine range (jsdom 27, pre-#990)", () => {
    // #990 (jsdom 30.1.1) is not merged yet, so package-lock.json still locks
    // jsdom 27.4.0, whose own range (`^20.19.0 || ^22.12.0 || >=24.0.0`) is
    // wider than ours: it still admits plain 24.0.0-24.14.x, which our range
    // now excludes. This is deliberate — ENGINE_RANGE pre-adopts the range
    // jsdom 30 and its transitives (@asamuzakjp/css-color, dom-selector,
    // w3c-xmlserializer, undici) will require, so #990 can rebase and merge
    // without a second engines change. So the relationship is one-directional
    // now, not equality: every version ENGINE_RANGE admits must also satisfy
    // jsdom 27's currently-locked range.
    expect(JSDOM_RANGE).toBeTruthy();
    for (const version of [
      "22.22.2",
      "22.99.99",
      "23.0.0",
      "23.6.0",
      "24.0.0",
      "24.14.0",
      "24.15.0",
      "24.99.99",
      "25.0.0",
      "26.0.0",
    ]) {
      if (satisfiesRange(ENGINE_RANGE!, version)) {
        expect(satisfiesRange(JSDOM_RANGE!, version)).toBe(true);
      }
    }
  });

  it("every version admitted by the declared range also satisfies lint-staged's own floor", () => {
    expect(LINT_STAGED_RANGE).toBeTruthy();
    for (const version of ["22.12.0", "22.22.1", "22.22.2", "22.99.99"]) {
      if (satisfiesRange(ENGINE_RANGE!, version)) {
        expect(satisfiesRange(LINT_STAGED_RANGE!, version)).toBe(true);
      }
    }
  });
});
