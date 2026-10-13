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
 * Why `pkg` has no entry in `installedVersions()`, in words for an error
 * message: no manifest at all, or a manifest that names no usable `version`
 * (absent, empty or not a string). Two different repairs, so two sentences
 * (#1415). Returns null when the package does have a usable version.
 */
export function missingVersionReason(root, pkg) {
  const manifest = installedManifest(root, pkg);
  if (manifest === null) return "is not installed";
  const version = manifest.version;
  if (typeof version === "string" && version !== "") return null;
  return "is installed but its package.json has no usable version";
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

/**
 * The packages of `packages` with no usable installed version, each with the
 * reason, in order. Membership is `Object.hasOwn`, not `in`: a package named
 * like an `Object.prototype` member (`constructor`) must not look versioned
 * (#1415).
 */
export function unversionedPackages(root, packages) {
  const versions = installedVersions(root, packages);
  return [...new Set(packages)]
    .filter((pkg) => !Object.hasOwn(versions, pkg))
    .map((pkg) => ({
      pkg,
      reason: missingVersionReason(root, pkg) ?? "has no usable version",
    }));
}

/**
 * The notice file name a dev-server request URL asks for, or null. A plugin
 * middleware runs BEFORE Vite strips `base`, so under `--base /x/` the real
 * URL is `/x/licenses/NAME.txt`; the base is removed here (#1415).
 */
export function noticeNameForUrl(url, base = "/") {
  const prefix = base.endsWith("/") ? base : `${base}/`;
  const rest = url.startsWith(prefix) ? url.slice(prefix.length) : null;
  const m =
    rest === null ? null : /^licenses\/([\w-]+\.txt)(?:\?.*)?$/.exec(rest);
  return m ? m[1] : null;
}

/** The packages a notice text asks a version for, in order of appearance. */
export function noticeVersionTokens(text) {
  return [...text.matchAll(TOKEN)].map((m) => m[1]);
}

/**
 * `text` with every `{{version:<package>}}` replaced by `versionOf(package)`.
 * Throws on a package `versionOf` cannot name, so a notice for a package that
 * is no longer installed fails the build instead of shipping a token.
 * `reasonOf(package)` words WHY it cannot (default: "is not installed").
 */
export function expandNoticeVersions(
  text,
  versionOf,
  label = "notice",
  reasonOf = () => "is not installed"
) {
  return text.replace(TOKEN, (_, pkg) => {
    const version = versionOf(pkg);
    if (!version) {
      throw new Error(
        `${label}: {{version:${pkg}}} names a package that ${reasonOf(pkg) ?? "is not installed"}`
      );
    }
    return version;
  });
}
