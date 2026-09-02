/**
 * The app's own licence and every third-party licence it must disclose.
 *
 * lamejs is LGPL-3.0 in an otherwise-MIT app (ADR 0003). The LGPL obligations
 * (#36) require the licence text and attribution to be reachable by someone
 * holding the phone — not only in `node_modules`. `AboutPanel` renders this
 * table; the verbatim licence texts ship under `public/licenses/` (served by
 * the deploy and precached by the service worker, so they resolve offline in
 * the field) and are linked by `files`.
 *
 * One table so the notice cannot silently drift from what is installed:
 * `tests/licenses.test.ts` pins the lamejs entry to the resolved dependency's
 * version and asserts every `href` under `/licenses/` maps to a file that
 * actually ships in `public/`.
 */

/** A licence document that ships under `public/licenses/`, reachable at `href`. */
interface LicenseFile {
  readonly label: string;
  readonly href: string;
}

/** A bundled open-source dependency and the licence it is offered under. */
export interface ThirdPartyLicense {
  readonly name: string;
  readonly version: string;
  /** What it does here, in plain terms. */
  readonly role: string;
  readonly spdx: string;
  readonly copyright: string;
  readonly homepage: string;
  /** The one thing the LGPL relink right needs the reader to know. */
  readonly note: string;
  readonly files: readonly LicenseFile[];
}

/** The project's own licence. */
export const appLicense = {
  name: "translationCore Mobile",
  holder: "unfoldingWord",
  spdx: "MIT",
  file: { label: "MIT licence", href: "/licenses/MIT.txt" },
} as const;

/**
 * Third-party code shipped in the bundle. Only `@breezystack/lamejs` carries a
 * copyleft licence; it is the whole reason this surface exists. Its `version`
 * is pinned here and checked against the installed package by the test, so an
 * upgrade that changes the attribution can't pass silently.
 */
export const thirdPartyLicenses: readonly ThirdPartyLicense[] = [
  {
    name: "@breezystack/lamejs",
    version: "1.2.7",
    role: "MP3 encoder",
    spdx: "LGPL-3.0",
    copyright: "© Alex Zhukov — a fork of lamejs, based on LAME",
    homepage: "https://github.com/shijinyu/lamejs",
    note: "The only copyleft component. It sits behind one module (encodeMp3, run in a Web Worker), so you may replace it with your own build of lamejs under the LGPL.",
    files: [
      { label: "GNU LGPL v3", href: "/licenses/GNU-LGPL-3.0.txt" },
      { label: "GNU GPL v3", href: "/licenses/GNU-GPL-3.0.txt" },
    ],
  },
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
