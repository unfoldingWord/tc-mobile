import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  type Manifest,
  nodeModulesEntry,
  toPosixPath,
  virtualModuleOwner,
} from "@/lib/build-provenance";
import { stripComments } from "./support";

/**
 * The attribution rule behind `dist/build-provenance.json` (#36). Rolldown
 * names the helpers it injects `\0<pkg>@<version>/…`, with a scoped name's
 * `/` written as `+` (`\0@oxc-project+runtime@0.150.0/helpers/esm/…`); the
 * rule reads package and version from the id itself, so a fifth injected
 * runtime needs no new exception (Frank round 5 on #1019). The real build is
 * pinned by tests/dist-source-offer.test.ts under `npm run test:dist`.
 */

const installed: Record<string, Manifest> = {
  "@scope/pkg": { version: "1.2.3", license: "MIT" },
  plain: { version: "4.5.6", license: "ISC" },
  vite: { version: "8.3.1", license: "MIT" },
  unlicensed: { version: "1.0.0" },
};
const read = (pkg: string) => installed[pkg] ?? null;

describe("virtualModuleOwner", () => {
  it("reads a scoped package and its version from an encoded id", () => {
    expect(virtualModuleOwner("\0@scope+pkg@1.2.3/x.js", read)).toEqual({
      package: "@scope/pkg",
      version: "1.2.3",
      license: "MIT",
    });
  });

  it("reads an unscoped package and its version from the id", () => {
    expect(virtualModuleOwner("\0plain@4.5.6/a/b.js", read)).toEqual({
      package: "plain",
      version: "4.5.6",
      license: "ISC",
    });
  });

  it("keeps attributing an unversioned id by its first segment", () => {
    expect(virtualModuleOwner("\0vite/preload-helper.js", read)).toEqual({
      package: "vite",
      version: "8.3.1",
      license: "MIT",
    });
  });

  it("fails closed on a package that is not installed", () => {
    expect(virtualModuleOwner("\0@nobody+here@1.0.0/x.js", read)).toEqual({
      package: null,
      version: null,
      license: null,
    });
    expect(virtualModuleOwner("\0nobody/x.js", read).package).toBeNull();
  });

  it("fails closed when the installed version is not the one the id names", () => {
    // The build shipped 1.2.4; disclosing the installed 1.2.3 would be wrong.
    expect(virtualModuleOwner("\0@scope+pkg@1.2.4/x.js", read).package).toBe(
      null
    );
  });

  it("fails closed when the installed package names no licence", () => {
    expect(virtualModuleOwner("\0unlicensed@1.0.0/x.js", read).package).toBe(
      null
    );
  });
});

/**
 * #1083, a follow-up from #1019: `vite.config.ts`'s build-provenance plugin
 * compares bundler chunk names (always POSIX, per Rollup) and
 * `package-lock.json` keys (always POSIX, per npm) against paths built with
 * `node:path`'s OS-native `relative`/`join` — backslash-separated on
 * Windows. `path.win32.join`/`.relative` build that same backslash shape on
 * any host, which is what lets these run on a POSIX CI machine and still
 * exercise the Windows path convention directly.
 */
describe("toPosixPath", () => {
  it("is a no-op on an already-POSIX path", () => {
    const rel = path.posix.join("assets", "index-abc123.js");
    expect(toPosixPath(rel)).toBe("assets/index-abc123.js");
  });

  it("converts a native Windows relative path to forward slashes", () => {
    const rel = path.win32.join("assets", "index-abc123.js");
    expect(rel).toBe("assets\\index-abc123.js"); // sanity: fixture is really backslash-separated
    expect(toPosixPath(rel)).toBe("assets/index-abc123.js");
  });

  it("lets a POSIX-normalized Windows chunk path match a rollup-style chunk Set", () => {
    // Rollup's own out.fileName is always POSIX, even for a Windows build.
    const chunks = new Set(["assets/index-abc123.js"]);
    const walkedOnWindows = path.win32.join("assets", "index-abc123.js");

    // Pre-fix, this comparison missed on Windows (#1083's exact defect):
    // every known chunk got recorded with package: null and the artifact
    // gate rejected the bundle.
    expect(chunks.has(toPosixPath(walkedOnWindows))).toBe(true);
  });

  it("still fails to match an unrelated (unknown) emitted file", () => {
    const chunks = new Set(["assets/index-abc123.js"]);
    const walkedOnWindows = path.win32.join("assets", "mystery-xyz.js");
    // Normalizing separators must not make an unrelated path match — an
    // emitted JS file the bundle doesn't actually own still fails
    // attribution (package: null downstream), under either convention.
    expect(chunks.has(toPosixPath(walkedOnWindows))).toBe(false);
  });
});

describe("nodeModulesEntry", () => {
  it("finds a root-level package under a POSIX-relative path", () => {
    const rel = path.posix.join("node_modules", "lodash", "index.js");
    expect(nodeModulesEntry(rel)).toEqual({
      pkg: "lodash",
      dir: "node_modules/lodash",
      rel: "node_modules/lodash/index.js",
    });
  });

  it("finds a root-level package under a native Windows-relative path", () => {
    const rel = path.win32.join("node_modules", "lodash", "index.js");
    expect(rel).toBe("node_modules\\lodash\\index.js"); // sanity
    expect(nodeModulesEntry(rel)).toEqual({
      pkg: "lodash",
      dir: "node_modules/lodash",
      rel: "node_modules/lodash/index.js",
    });
  });

  it("finds a scoped package under a Windows-relative path", () => {
    const rel = path.win32.join(
      "node_modules",
      "@scope",
      "pkg",
      "dist",
      "index.js"
    );
    expect(nodeModulesEntry(rel)).toEqual({
      pkg: "@scope/pkg",
      dir: "node_modules/@scope/pkg",
      rel: "node_modules/@scope/pkg/dist/index.js",
    });
  });

  it("keeps a non-root node_modules prefix (a nested install) on a Windows-relative path", () => {
    const rel = path.win32.join(
      "packages",
      "app",
      "node_modules",
      "foo",
      "index.js"
    );
    expect(nodeModulesEntry(rel)).toEqual({
      pkg: "foo",
      dir: "packages/app/node_modules/foo",
      rel: "packages/app/node_modules/foo/index.js",
    });
  });

  it("returns null for an in-repo path with no node_modules segment, under either convention — unknown JS still fails attribution", () => {
    expect(
      nodeModulesEntry(path.posix.join("src", "components", "app.tsx"))
    ).toBeNull();
    expect(
      nodeModulesEntry(path.win32.join("src", "components", "app.tsx"))
    ).toBeNull();
  });
});

/**
 * The unit tests above cover `toPosixPath`/`nodeModulesEntry` in isolation;
 * this pins that `vite.config.ts`'s build-provenance plugin actually routes
 * both of its native-path comparisons through them, rather than the
 * `node:path` OS-native `relative`/`join` result directly (the #1083
 * defect). Source-text check, not an import: this repo's house style
 * (`tests/build-target-floor.test.ts`, `tests/locale.test.ts`,
 * `tests/check-deploy.test.ts`) reads `vite.config.ts` as text rather than
 * importing it, since the module runs `execSync`/real `readFileSync` calls
 * at import time.
 */
describe("vite.config.ts routes its native-path comparisons through the POSIX helpers (#1083)", () => {
  // stripComments (tests/support.ts) so a comment naming the old shape (as
  // this file's own docblocks above do) cannot false-match either
  // assertion — the exact trap AGENTS.md names for a whole-file source read.
  const CONFIG = stripComments(
    readFileSync(path.join(import.meta.dirname, "..", "vite.config.ts"), "utf8")
  );

  it("the walked-file vs. known-chunk comparison uses toPosixPath", () => {
    // The exact line that missed on Windows: `chunks` holds Rollup's
    // always-POSIX fileNames, so the walked path compared against it must
    // be normalized first.
    expect(CONFIG).toMatch(
      /:\s*\[toPosixPath\(path\.relative\(outDir,\s*path\.join\(dir,\s*e\.name\)\)\)\]/
    );
  });

  it("the node_modules search uses nodeModulesEntry rather than a raw path.relative", () => {
    expect(CONFIG).toMatch(/const entry = nodeModulesEntry\(rel\);/);
    // Guards against reintroducing the literal string-search this replaced.
    expect(CONFIG).not.toMatch(/rel\.lastIndexOf\("node_modules\/"\)/);
  });
});
