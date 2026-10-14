/**
 * Where the licence disclosure gets its versions from (#1381).
 *
 * The disclosure used to carry every npm package's version as a hand-kept
 * string in three places (`src/components/licenses.ts`, the `name version —
 * SPDX` headers in `public/licenses/*-NOTICES.txt`, and the tests that pinned
 * both), so a Dependabot patch bump that changed no licence still went red and
 * needed a human to retype the number. Now the installed manifest is the one
 * source:
 *
 * - `licenses.ts` holds no version; `vite.config.ts` and `vitest.config.ts`
 *   define `__DEP_VERSIONS__` from `installedVersions()` below, so the About
 *   screen shows the version that was actually built.
 * - A notice header writes the version as `{{version:<package>}}`, and
 *   `expandNoticeVersions()` swaps in the installed one — at build time into
 *   `dist/licenses/` (the `licence-notice-versions` plugin in `vite.config.ts`)
 *   and in the tests that read the notices.
 *
 * What stays a hard gate is everything a bump CAN change that matters: the
 * licence name (`license` in the installed `package.json` against the
 * disclosed SPDX), the copyright holder lines in the installed LICENSE file,
 * the set of shipped packages, and the notice's licence text. See
 * `tests/licenses.test.ts`.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** `{{version:<package>}}`; `<package>` may be scoped (`@capacitor/app`). */
const TOKEN = /\{\{version:([^}\s]+)\}\}/g;

/** The installed `package.json` of `pkg` under `root`, or null if absent. */
export function installedManifest(root, pkg) {
  const file = path.join(root, "node_modules", pkg, "package.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

/**
 * `{ [package]: installed version }` for each name in `packages`. A package
 * that is not installed is simply absent from the result: the caller decides
 * whether that is fatal (the build) or a failing assertion (the tests).
 */
export function installedVersions(root, packages) {
  const out = {};
  for (const pkg of new Set(packages)) {
    const version = installedManifest(root, pkg)?.version;
    if (typeof version === "string" && version !== "") out[pkg] = version;
  }
  return out;
}

/** The packages a notice text asks a version for, in order of appearance. */
export function noticeVersionTokens(text) {
  return [...text.matchAll(TOKEN)].map((m) => m[1]);
}

/**
 * `text` with every `{{version:<package>}}` replaced by `versionOf(package)`.
 * Throws on a package `versionOf` cannot name, so a notice for a package that
 * is no longer installed fails the build instead of shipping a token.
 */
export function expandNoticeVersions(text, versionOf, label = "notice") {
  return text.replace(TOKEN, (_, pkg) => {
    const version = versionOf(pkg);
    if (!version) {
      throw new Error(
        `${label}: {{version:${pkg}}} names a package that is not installed`
      );
    }
    return version;
  });
}
