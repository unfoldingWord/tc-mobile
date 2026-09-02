/**
 * Every open-source component the app bundles, and every licence it must
 * disclose.
 *
 * The app is MIT, with one copyleft dependency — the `@breezystack/lamejs` MP3
 * encoder (LGPL-3.0, ADR 0003). The LGPL and the MIT/ISC clauses of the other
 * bundled runtime dependencies all require their licence text and copyright to
 * travel with the distribution; #36 makes that reachable by someone holding the
 * phone rather than only in `node_modules`. `AboutPanel` renders this table and
 * reads the linked texts in-drawer; the verbatim texts ship under
 * `public/licenses/` (served and precached, so they resolve offline).
 *
 * One table so the notice cannot silently drift from what is installed:
 * `tests/licenses.test.ts` asserts every `dependencies` entry is disclosed
 * here, pins the copyleft lamejs entry to the resolved dependency, and asserts
 * the linked texts actually ship.
 */

/** A bundled runtime dependency and the licence it is offered under. */
export interface ThirdPartyLicense {
  readonly name: string;
  readonly version: string;
  readonly spdx: string;
  readonly copyright: string;
  readonly homepage: string;
  /** What it does here, in plain terms. Only the ones worth naming carry it. */
  readonly role?: string;
  /** A note the licence makes worth surfacing — the LGPL relink right. */
  readonly note?: string;
  /** An upstream the licence asks be acknowledged (LAME, for lamejs). */
  readonly acknowledges?: { readonly label: string; readonly href: string };
}

/**
 * The bundled runtime dependencies (`package.json` `dependencies`). lamejs is
 * first and carries the copyleft note; the rest are permissive (MIT/ISC) and
 * their verbatim notices ride in `THIRD-PARTY-NOTICES.txt`. Versions are the
 * installed ones — the test keeps the set complete and pins lamejs.
 */
export const thirdPartyLicenses: readonly ThirdPartyLicense[] = [
  {
    name: "@breezystack/lamejs",
    version: "1.2.7",
    spdx: "LGPL-3.0",
    role: "MP3 encoder",
    copyright: "© Alex Zhukov — a fork of lamejs, based on LAME",
    homepage: "https://github.com/shijinyu/lamejs",
    note: "The only copyleft component. It sits behind one module (encodeMp3, run in a Web Worker), so you may replace it with your own build of lamejs under the LGPL.",
    acknowledges: { label: "LAME", href: "https://lame.sourceforge.net" },
  },
  {
    name: "react",
    version: "19.2.8",
    spdx: "MIT",
    copyright: "© Meta Platforms, Inc. and affiliates",
    homepage: "https://react.dev",
  },
  {
    name: "react-dom",
    version: "19.2.8",
    spdx: "MIT",
    copyright: "© Meta Platforms, Inc. and affiliates",
    homepage: "https://react.dev",
  },
  {
    name: "idb",
    version: "8.0.3",
    spdx: "ISC",
    copyright: "© 2016 Jake Archibald",
    homepage: "https://github.com/jakearchibald/idb",
  },
  {
    name: "clsx",
    version: "2.1.1",
    spdx: "MIT",
    copyright: "© Luke Edwards",
    homepage: "https://github.com/lukeed/clsx",
  },
  {
    name: "tailwind-merge",
    version: "3.6.0",
    spdx: "MIT",
    copyright: "© 2021 Dany Castillo",
    homepage: "https://github.com/dcastil/tailwind-merge",
  },
  {
    name: "fflate",
    version: "0.8.3",
    spdx: "MIT",
    copyright: "© 2026 Arjun Barrett",
    homepage: "https://github.com/101arrowz/fflate",
  },
];

/** A verbatim licence text shipped under `public/licenses/`, read in-drawer. */
export interface LicenseText {
  readonly label: string;
  readonly href: string;
}

/**
 * The licence texts that ship with the app, in reading order: the app's own
 * MIT, the collected third-party notices (every permissive dependency's
 * verbatim licence and copyright), and the two GNU texts lamejs's LGPL-3.0
 * requires (LGPL v3 incorporates the GPL by reference, so both ship).
 */
export const licenseTexts: readonly LicenseText[] = [
  { label: "This app — MIT licence", href: "/licenses/MIT.txt" },
  { label: "Third-party notices", href: "/licenses/THIRD-PARTY-NOTICES.txt" },
  { label: "GNU LGPL v3 — lamejs", href: "/licenses/GNU-LGPL-3.0.txt" },
  { label: "GNU GPL v3 — lamejs", href: "/licenses/GNU-GPL-3.0.txt" },
];

/** A piece of bundled content and the terms it is offered under. */
interface ContentAttribution {
  readonly what: string;
  readonly holder: string;
  readonly license: string;
  readonly href: string;
}

/**
 * Bundled Open Bible Stories content (ADR 0006) — separate works in mere
 * aggregation with this MIT code, but their CC BY-SA terms want attribution
 * reachable too, so they are credited on the same screen.
 */
export const contentAttribution: readonly ContentAttribution[] = [
  {
    what: "Open Bible Stories text",
    holder: "© unfoldingWord",
    license: "CC BY-SA 4.0",
    href: "https://creativecommons.org/licenses/by-sa/4.0/",
  },
  {
    what: "Open Bible Stories artwork",
    holder: "© Sweet Publishing",
    license: "CC BY-SA 3.0",
    href: "https://creativecommons.org/licenses/by-sa/3.0/",
  },
];
