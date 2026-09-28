/**
 * Who owns a virtual module the bundler writes into `dist/` (#36). Pure and
 * DOM-free so a Node test drives it; `vite.config.ts`'s build-provenance
 * plugin supplies the one side effect, reading a package's installed
 * `package.json`, through `readManifest`.
 */

/** What an installed package's `package.json` says about itself. */
export interface Manifest {
  version?: string;
  license?: string;
}

/** A shipped piece's owner. All three are null when it cannot be attributed. */
export interface Owner {
  package: string | null;
  version: string | null;
  license: string | null;
}

const UNATTRIBUTED: Owner = { package: null, version: null, license: null };

/** The package a bare specifier or `node_modules/`-relative path names. */
export function packageOf(spec: string): string {
  return spec
    .split("/")
    .slice(0, spec.startsWith("@") ? 2 : 1)
    .join("/");
}

/**
 * Attributes a virtual module id (`\0…`, with or without the NUL) from the id
 * itself. Rolldown names an injected helper `<pkg>@<version>/…`, spelling a
 * scoped name's `/` as `+` (`@oxc-project+runtime@0.150.0/helpers/esm/…`);
 * a plain `vite/…` or `rolldown/…` id carries no version, so its owner is the
 * first path segment's package at whatever version is installed.
 *
 * Fails closed — every field null, which tests/dist-source-offer.test.ts
 * rejects — when the package is not installed, when the installed version is
 * not the one the id names (the disclosure would pin the wrong release), or
 * when its `package.json` names no licence.
 */
export function virtualModuleOwner(
  id: string,
  readManifest: (pkg: string) => Manifest | null
): Owner {
  const spec = id.replace(/^\0/, "");
  const versioned = /^(@[^/+@]+\+)?([^/@]+)@([^/@]+)(?:\/|$)/.exec(spec);
  const pkg = versioned
    ? `${versioned[1] ? versioned[1].replace("+", "/") : ""}${versioned[2]}`
    : packageOf(spec);
  const manifest = readManifest(pkg);
  if (!manifest?.version || !manifest.license) return UNATTRIBUTED;
  if (versioned && manifest.version !== versioned[3]) return UNATTRIBUTED;
  return { package: pkg, version: manifest.version, license: manifest.license };
}

/**
 * Normalizes a path-shaped identifier — a `node_modules/`-relative module
 * path, an emitted file's path from a directory walk — to the one
 * convention every such value is compared or looked up under, here and in
 * `vite.config.ts`'s build-provenance plugin: forward slashes. Rollup's own
 * chunk `fileName`s and `package-lock.json`'s own keys are always
 * POSIX-style, even in a build run on Windows; `node:path`'s OS-native
 * `relative`/`join` are not (#1083, a follow-up from #1019: the plugin's
 * `node_modules/` search and its emitted-file-vs-known-chunk comparison each
 * compared a POSIX literal, or a `Set` of POSIX chunk names, against a
 * native-separator path, so every known chunk silently lost its attribution
 * — `package: null` — on a Windows build, and the artifact gate rejected an
 * otherwise-valid bundle).
 *
 * A bare backslash replace rather than a `path.sep`-driven split: it is a
 * no-op on an already-POSIX string, so it is safe to call unconditionally on
 * any host, and it is what lets a test on a POSIX host exercise the Windows
 * path shape directly — `path.win32.join`/`.relative` build a
 * backslash-separated string on any OS; only the OS-native
 * `path.relative`/`path.join` this function's callers use actually vary by
 * host.
 */
export function toPosixPath(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Where a `node_modules/`-relative module path names its owning package,
 * after normalizing to the convention `toPosixPath` states above — or
 * `null` when `rel` names no `node_modules` segment at all (an in-repo
 * source file, which must keep failing attribution regardless of host path
 * convention). `dir` is the exact `package-lock.json` key for that install
 * (that file's own keys are always POSIX, per npm's own convention); `pkg`
 * is what a manifest lookup needs; `rel` is the normalized identifier to
 * record the entry under. Handles a nested (non-root) `node_modules` the
 * same as a root one, by keeping whatever prefix `rel` carries before the
 * matched segment.
 */
export function nodeModulesEntry(
  rel: string
): { pkg: string; dir: string; rel: string } | null {
  const posixRel = toPosixPath(rel);
  const at = posixRel.lastIndexOf("node_modules/");
  if (at === -1) return null;
  const pkg = packageOf(posixRel.slice(at + "node_modules/".length));
  return {
    pkg,
    dir: posixRel.slice(0, at) + `node_modules/${pkg}`,
    rel: posixRel,
  };
}
