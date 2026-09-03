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

/** A bundled component and the licence it is offered under. */
interface ThirdPartyLicense {
  readonly name: string;
  readonly version: string;
  readonly spdx: string;
  readonly copyright: string;
  /** What it does here, in plain terms. Only the ones worth naming carry it. */
  readonly role?: string;
  /**
   * The installed package the version is pinned to, when it differs from
   * `name` — Workbox is shown by its family name but resolves to `workbox-build`
   * in `node_modules`. Defaults to `name`.
   */
  readonly pinPackage?: string;
  /** A note the licence makes worth surfacing — the LGPL relink right. */
  readonly note?: string;
  /** An upstream the licence asks be acknowledged (LAME, for lamejs). */
  readonly acknowledges?: { readonly label: string; readonly href: string };
  /**
   * A distinctive substring that must appear in this package's section of
   * THIRD-PARTY-NOTICES.txt — the copyright holder as the bundled LICENSE
   * writes it (lamejs's LAME notice carries no copyright line, so "LAME").
   * `tests/licenses.test.ts` asserts it per section, so dropping one package's
   * copyright from the notices file fails that package alone (Frank F1, r2).
   */
  readonly noticeMarker: string;
}

/**
 * Everything bundled into the app: the `package.json` runtime dependencies plus
 * Workbox, which vite-plugin-pwa injects into the service worker at build time
 * (it emits `dist/workbox-*.js`, whose header varies by build, so its notice is
 * disclosed here to travel regardless). lamejs is first and carries the copyleft
 * note; the rest are
 * permissive (MIT/ISC) and their verbatim notices ride in
 * `THIRD-PARTY-NOTICES.txt`. Versions are the installed ones — the test pins
 * every entry and keeps the dependency set complete.
 */
export const thirdPartyLicenses: readonly ThirdPartyLicense[] = [
  {
    name: "@breezystack/lamejs",
    version: "1.2.7",
    spdx: "LGPL-3.0",
    role: "MP3 encoder",
    copyright: "© Alex Zhukov — a fork of lamejs, based on LAME",
    note: "The only copyleft component, isolated in a single Web Worker chunk (encodeMp3) — the one unit its LGPL licence concerns. Its source is available from unfoldingWord.",
    acknowledges: { label: "LAME", href: "https://lame.sourceforge.net" },
    noticeMarker: "LAME",
  },
  {
    name: "react",
    version: "19.2.8",
    spdx: "MIT",
    copyright: "© Meta Platforms, Inc. and affiliates",
    noticeMarker: "Meta Platforms",
  },
  {
    name: "react-dom",
    version: "19.2.8",
    spdx: "MIT",
    copyright: "© Meta Platforms, Inc. and affiliates",
    noticeMarker: "Meta Platforms",
  },
  {
    name: "idb",
    version: "8.0.3",
    spdx: "ISC",
    copyright: "© 2016 Jake Archibald",
    noticeMarker: "Jake Archibald",
  },
  {
    name: "clsx",
    version: "2.1.1",
    spdx: "MIT",
    copyright: "© Luke Edwards",
    noticeMarker: "Luke Edwards",
  },
  {
    name: "tailwind-merge",
    version: "3.6.0",
    spdx: "MIT",
    copyright: "© 2021 Dany Castillo",
    noticeMarker: "Dany Castillo",
  },
  {
    name: "fflate",
    version: "0.8.3",
    spdx: "MIT",
    copyright: "© 2026 Arjun Barrett",
    noticeMarker: "Arjun Barrett",
  },
  {
    name: "workbox",
    version: "7.4.1",
    spdx: "MIT",
    role: "service worker, built by vite-plugin-pwa",
    copyright: "© Google LLC",
    pinPackage: "workbox-build",
    noticeMarker: "Google",
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
