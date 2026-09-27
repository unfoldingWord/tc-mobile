import { describe, expect, it } from "vitest";

import { type Manifest, virtualModuleOwner } from "@/lib/build-provenance";

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
  vite: { version: "8.3.0", license: "MIT" },
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
      version: "8.3.0",
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
