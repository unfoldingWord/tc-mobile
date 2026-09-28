import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { licenseTexts, licenseTextsFor } from "@/components/licenses";

/**
 * The native shells' attribution (#477). Each Capacitor build carries more
 * than the web bundle `tests/licenses.test.ts` covers: the Capacitor runtime
 * and plugins' native code, and the Android (Gradle) or iOS (Swift Package
 * Manager) libraries they declare. Each build gets its own notice under
 * `public/licenses/`, and this suite ties the notice to the native projects
 * as they are declared in the tree:
 *
 * - every dependency a native project DECLARES has exactly one section in its
 *   platform's notice, at the declared version (a new or bumped declaration
 *   with no section fails here);
 * - every section is labelled with the licence it carries; and
 * - the About screen lists the notice on that platform only.
 *
 * What it cannot see is the TRANSITIVE Gradle graph: resolving it needs Gradle
 * and the Android SDK, which a Node test does not have. The notice's
 * transitive sections were generated from a resolved graph, and
 * `docs/native/README.md` ("Native licence notices") says how to regenerate
 * them. Every declared version here is exact, so the resolved graph changes
 * only when a declaration does — and a declaration change fails this suite.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
/** Gradle or Swift source with its whole-line `//` comments removed, so a
 * commented-out declaration is not read as a live one. */
const code = (rel: string) => read(rel).replace(/^\s*\/\/.*$/gm, "");
const installedVersion = (pkg: string) =>
  (JSON.parse(read(`node_modules/${pkg}/package.json`)) as { version: string })
    .version;

interface Section {
  readonly name: string;
  readonly version: string;
  readonly spdx: string;
  readonly body: string;
}

/** A notice file's sections: `name version — SPDX` headers between `=` rules. */
function sections(href: string): Section[] {
  const text = read(path.join("public", href));
  return text
    .split(/\n=+\n/)
    .slice(1) // the preamble
    .map((s) => s.trim())
    .filter((s) => !s.startsWith("Apache License 2.0 — full text"))
    .map((body) => {
      const header = body.split("\n")[0] ?? "";
      const m = /^(\S+) (\S+) — (\S+)$/.exec(header);
      if (!m) throw new Error(`${href}: malformed section header "${header}"`);
      return { name: m[1]!, version: m[2]!, spdx: m[3]!, body };
    });
}

/** Exactly one section for `name`, at `version`. */
function expectSection(all: Section[], name: string, version: string) {
  const found = all.filter((s) => s.name === name);
  expect(found, `${name} section count`).toHaveLength(1);
  expect(found[0]?.version, `${name} version`).toBe(version);
}

// --- Android: what the Gradle projects declare ------------------------------

/** `android/variables.gradle`: the root `ext` every module reads first. */
function rootExt(): Map<string, string> {
  const src = code("android/variables.gradle");
  return new Map(
    [...src.matchAll(/^\s*(\w+)\s*=\s*'([^']+)'/gm)].map((m) => [m[1]!, m[2]!])
  );
}

/**
 * A module's `implementation` coordinates with `$var` resolved. A module's
 * own `ext` reads `project.hasProperty('x') ? rootProject.ext.x : 'default'`,
 * so the root value wins where the root sets one and the module default
 * stands otherwise. The `CAP_PLUGIN_PUBLISH` branch is the plugins' own
 * publishing path, not this app's build, so it is dropped. Test-only
 * configurations never reach the app.
 */
function declaredCoordinates(gradle: string): string[] {
  const root = rootExt();
  const defaults = new Map(
    [
      ...gradle.matchAll(
        /(\w+)\s*=\s*project\.hasProperty\(['"]\w+['"]\)\s*\?\s*rootProject\.ext\.\w+\s*:\s*['"]([^'"]+)['"]/g
      ),
    ].map((m) => [m[1]!, m[2]!])
  );
  const src = gradle.replace(
    /if \(System\.getenv\("CAP_PLUGIN_PUBLISH"\) == "true"\) \{[^}]*\}/g,
    ""
  );
  return [
    ...src.matchAll(
      /^\s*(?:implementation|api)\s*\(?\s*["']([^"':]+):([^"':]+):([^"')]+)["']/gm
    ),
  ].map((m) => {
    const version = m[3]!.replace(/\$\{?(\w+)\}?/g, (_, v: string) => {
      const value = root.get(v) ?? defaults.get(v);
      if (!value) throw new Error(`unresolved Gradle variable $${v}`);
      return value;
    });
    return `${m[1]}:${m[2]}:${version}`;
  });
}

/** The `:capacitor-*` projects `android/capacitor.settings.gradle` includes. */
function capacitorProjects(): { dir: string; pkg: string }[] {
  const src = code("android/capacitor.settings.gradle");
  return [
    ...src.matchAll(
      /projectDir = new File\('\.\.\/node_modules\/(@capacitor\/[^/']+)\/([^']+)'\)/g
    ),
  ].map((m) => ({ pkg: m[1]!, dir: `node_modules/${m[1]}/${m[2]}` }));
}

function androidDeclared(): string[] {
  return [
    ...declaredCoordinates(code("android/app/build.gradle")),
    ...capacitorProjects().flatMap((p) =>
      declaredCoordinates(code(`${p.dir}/build.gradle`))
    ),
  ];
}

// --- iOS: what the Swift packages declare -----------------------------------

interface SwiftDependency {
  readonly name: string;
  readonly url: string;
  readonly exact?: string;
  readonly from?: string;
}

/**
 * The remote packages a `Package.swift` declares, and the local path packages
 * it pulls (the Capacitor plugins in `node_modules`), followed recursively.
 */
function swiftDeclared(
  packageDir: string,
  seen = new Set<string>()
): { remote: SwiftDependency[]; local: string[] } {
  const src = code(`${packageDir}/Package.swift`);
  const remote: SwiftDependency[] = [
    ...src.matchAll(
      /\.package\(url:\s*"([^"]+)",\s*(exact|from):\s*"([^"]+)"\)/g
    ),
  ].map((m) => ({
    name: path.basename(m[1]!).replace(/\.git$/, ""),
    url: m[1]!.replace(/\.git$/, ""),
    ...(m[2] === "exact" ? { exact: m[3]! } : { from: m[3]! }),
  }));
  const local: string[] = [];
  for (const m of src.matchAll(
    /\.package\(name:\s*"[^"]+",\s*path:\s*"([^"]+)"\)/g
  )) {
    const dir = path.relative(ROOT, path.resolve(ROOT, packageDir, m[1]!));
    if (seen.has(dir)) continue;
    seen.add(dir);
    local.push(dir);
    const nested = swiftDeclared(dir, seen);
    remote.push(...nested.remote);
    local.push(...nested.local);
  }
  return { remote, local };
}

const ANDROID = licenseTextsFor("android").at(-1)!.href;
const IOS = licenseTextsFor("ios").at(-1)!.href;

describe("Android notice (#477)", () => {
  it("has a section for every dependency the Gradle projects declare", () => {
    const declared = androidDeclared();
    // A floor, so a Gradle syntax change that empties the parse fails here
    // instead of looping over nothing.
    expect(declared.length).toBeGreaterThanOrEqual(10);
    const all = sections(ANDROID);
    for (const coordinate of new Set(declared)) {
      const [group, artifact, version] = coordinate.split(":");
      expectSection(all, `${group}:${artifact}`, version!);
    }
  });

  it("has a section for every Capacitor project the build includes", () => {
    const projects = [
      "@capacitor/android",
      ...capacitorProjects().map((p) => p.pkg),
    ];
    expect(projects.length).toBeGreaterThanOrEqual(2);
    const all = sections(ANDROID);
    for (const pkg of new Set(projects)) {
      expectSection(all, pkg, installedVersion(pkg));
    }
  });
});

describe("iOS notice (#477)", () => {
  it("has a section for every remote Swift package, at its declared version", () => {
    const { remote } = swiftDeclared("ios/App/CapApp-SPM");
    expect(remote.length).toBeGreaterThanOrEqual(2);
    const all = sections(IOS);
    for (const url of new Set(remote.map((r) => r.url))) {
      const decls = remote.filter((r) => r.url === url);
      const name = decls[0]!.name;
      const exact = decls.find((d) => d.exact)?.exact;
      const section = all.find((s) => s.name === name);
      expect(section, `${name} has no section`).toBeDefined();
      expect(section?.body).toContain(url);
      if (exact) {
        // An exact pin (the Capacitor frameworks) is disclosed at that version.
        expectSection(all, name, exact);
      } else {
        // A floor within a major resolves at build time; the section names
        // the major and the floor it was declared with.
        const from = decls.map((d) => d.from!).sort()[0]!;
        expectSection(all, name, `${from.split(".")[0]}.x`);
        expect(section?.body).toContain(from);
      }
    }
  });

  it("has a section for every Capacitor package the Swift build pulls", () => {
    const { local } = swiftDeclared("ios/App/CapApp-SPM");
    const pkgs = [
      "@capacitor/ios",
      ...local.map((d) => d.replace(/^node_modules\//, "")),
    ];
    expect(pkgs.length).toBeGreaterThanOrEqual(2);
    const all = sections(IOS);
    for (const pkg of new Set(pkgs)) {
      expectSection(all, pkg, installedVersion(pkg));
    }
  });

  it("pins the prebuilt Capacitor frameworks to the installed @capacitor/ios", () => {
    // capacitor-swift-pm hosts the frameworks built from @capacitor/ios, and
    // the Capacitor CLI writes its exact version into Package.swift; a drift
    // means the notice's @capacitor/ios section no longer names the source
    // of the frameworks the app links.
    const pm = swiftDeclared("ios/App/CapApp-SPM").remote.find(
      (r) => r.name === "capacitor-swift-pm" && r.exact
    );
    expect(pm?.exact).toBe(installedVersion("@capacitor/ios"));
  });
});

describe.each([
  ["Android", ANDROID],
  ["iOS", IOS],
])("%s notice text", (_, href) => {
  it("labels every section with the licence it carries", () => {
    for (const s of sections(href)) {
      expect(["MIT", "Apache-2.0"], `${s.name}: ${s.spdx}`).toContain(s.spdx);
      if (s.spdx === "MIT") {
        expect(s.body, `${s.name} lacks the MIT text`).toContain(
          "Permission is hereby granted, free of charge"
        );
      } else {
        expect(s.body, `${s.name} lacks the Apache pointer`).toContain(
          "Apache License, Version 2.0"
        );
        expect(s.body).not.toContain(
          "Permission is hereby granted, free of charge"
        );
      }
    }
  });

  it("closes with the full Apache License 2.0 text", () => {
    const text = read(path.join("public", href));
    const tail = text.split(/\n=+\n/).at(-1) ?? "";
    expect(tail).toContain("Apache License 2.0 — full text");
    expect(tail).toContain("Version 2.0, January 2004");
    expect(tail).toContain("END OF TERMS AND CONDITIONS");
  });
});

describe("which licence texts the About screen lists", () => {
  it("lists only the web texts on the web build", () => {
    expect(licenseTextsFor("web")).toEqual(licenseTexts);
  });

  it.each(["android", "ios"] as const)(
    "adds the %s notice to the web texts on that build, and only that one",
    (platform) => {
      const texts = licenseTextsFor(platform);
      expect(texts.slice(0, licenseTexts.length)).toEqual(licenseTexts);
      const added = texts.slice(licenseTexts.length);
      expect(added).toHaveLength(1);
      expect(added[0]?.href).toBe(
        platform === "android"
          ? "/licenses/ANDROID-NOTICES.txt"
          : "/licenses/IOS-NOTICES.txt"
      );
      const file = path.join(ROOT, "public", added[0]!.href);
      expect(existsSync(file), `${added[0]?.href} is not in public/`).toBe(
        true
      );
    }
  );
});
