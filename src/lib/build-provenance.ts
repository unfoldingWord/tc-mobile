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
