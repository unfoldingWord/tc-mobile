import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { thirdPartyLicenses } from "@/components/licenses";

/**
 * The lamejs source kept in this repository (#36; the DRI ruling on #144's
 * Frank round 6 escalation) must be the source of the version the app
 * actually installs. The About screen links `third_party/lamejs-<version>/` at
 * the build's full commit; that link is only worth anything if the folder at
 * that commit holds the matching release. These checks tie the folder to
 * `package-lock.json`, to the installed package, and to the upstream commit
 * its PROVENANCE.md names.
 *
 * If the lock moves to a new lamejs version, this file fails until a new
 * folder is vendored from that version's upstream commit and the constants
 * below are updated with it.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const PACKAGE = "@breezystack/lamejs";

/** npm's `gitHead` for @breezystack/lamejs 1.2.7 (`npm view … gitHead`). */
const VENDORED_GIT_HEAD = "1fb0ef5fa177413107e2e107d054a9b994e3f79c";

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function lockedVersion(): string {
  const lock = readJson<{
    packages: Record<string, { version?: string }>;
  }>(path.join(REPO_ROOT, "package-lock.json"));
  const entry = lock.packages[`node_modules/${PACKAGE}`];
  expect(entry?.version, `${PACKAGE} is not in package-lock.json`).toBeTruthy();
  return entry!.version!;
}

const lamejs = thirdPartyLicenses.find((l) => l.name === PACKAGE);
const vendoredPath = lamejs?.source?.path ?? "";
const VENDORED_DIR = path.join(REPO_ROOT, vendoredPath);
const INSTALLED_DIR = path.join(REPO_ROOT, "node_modules", PACKAGE);

describe("the vendored lamejs source matches the locked version", () => {
  it("links a third_party folder named for the locked version", () => {
    expect(vendoredPath).toBe(`third_party/lamejs-${lockedVersion()}`);
    expect(existsSync(VENDORED_DIR), `${vendoredPath} is missing`).toBe(true);
  });

  it("holds the package.json of the locked name and version", () => {
    const pkg = readJson<{ name: string; version: string }>(
      path.join(VENDORED_DIR, "package.json")
    );
    expect(pkg.name).toBe(PACKAGE);
    expect(pkg.version).toBe(lockedVersion());
  });

  it("carries the same LICENSE and type declarations as the installed package", () => {
    // Byte equality with the files npm installed: a folder vendored from some
    // other revision is unlikely to match both.
    for (const file of ["LICENSE", "type.d.ts"]) {
      expect(
        readFileSync(path.join(VENDORED_DIR, file), "utf8"),
        `${vendoredPath}/${file} differs from the installed package`
      ).toBe(readFileSync(path.join(INSTALLED_DIR, file), "utf8"));
    }
  });

  it("carries the build entry the published dist is built from", () => {
    expect(existsSync(path.join(VENDORED_DIR, "src", "js", "index.js"))).toBe(
      true
    );
    expect(existsSync(path.join(VENDORED_DIR, "vite.config.ts"))).toBe(true);
  });
});

/**
 * SHA-256 of every file in the vendored folder except our own PROVENANCE.md.
 * The checks above tie the folder to the locked version by name and by two
 * files; this pins every other byte, so an edit to one encoder file — or a
 * file added or dropped — fails here instead of shipping a source link to a
 * tree that is no longer the one recorded (George Medium, bench round 1 on
 * #1019). The digests freeze the tree as committed; they do not by themselves
 * prove it matches upstream `VENDORED_GIT_HEAD` — that rests on the diff
 * PROVENANCE.md describes. A deliberate re-vendor updates this table with it.
 */
const VENDORED_DIGESTS: Readonly<Record<string, string>> = {
  LICENSE: "cd144ca132e3842b01f5ed2d6f3a32141e24a1cc15e115aa5f19a2294ce0a379",
  "README.md":
    "17d0a13abd2be08c869ce58bd084f0d970dac868e33a9f24b63029b03dcd05ad",
  "package.json":
    "cd7e0d13df9e60b931dd7b307c2e1c06af9c44667dda281d5c77d7d226034f9e",
  "pnpm-lock.yaml":
    "e79d6c4cf64c45004bae4593c5069c2b23041216e2c6a7e5448f03045264c22e",
  "src/js/ATH.js":
    "50f6b2d2ec21e054c252741db34bd6fd2ad2260dba758a5eabbe9e777f77c84c",
  "src/js/BitStream.js":
    "1b1c52469e25530155af8d66abbd569523ff79de76e61844b2bbe9dc9af9d46a",
  "src/js/CBRNewIterationLoop.js":
    "4f0067848fdfc2c506963e89a1b8d59b9ed13b86655805bf7a8f252e3845d4dd",
  "src/js/CalcNoiseData.js":
    "31ec9be306ccb77b798b9337add6e3a465778e1bb8c233e9dd35fef829547172",
  "src/js/CalcNoiseResult.js":
    "7ba0d2dd332a396e1256ebfd9816f2c8b51ba4788eac7828d28e4d31d8f52d0b",
  "src/js/Encoder.js":
    "123f8df29607facb192d3e6c6e618a795e2c32d7ce1218dc91f48f104429ba8e",
  "src/js/FFT.js":
    "a18c0fcfa9f08965c9ea6e8a66a59e2776894479b4d918892470e39c8a9ed98e",
  "src/js/GainAnalysis.js":
    "5b9fd57bb43f96d01a8df7965db72d355c84d5be817e96fad0bd1d33ad2d4751",
  "src/js/GrInfo.js":
    "0c08e2c3c8bcc3f2fc445f36be73b956d859a730fa2fd416b68830485f56d8dc",
  "src/js/ID3TagSpec.js":
    "82280619a7e23358a21aab6eb736b7c5b204072e1c97ce95c0e59d3bd12619bb",
  "src/js/IIISideInfo.js":
    "7bc4f6778686cdcbe5e1a919091187c1a2b2809ec33f728353c121e0ee236fc5",
  "src/js/III_psy_ratio.js":
    "d8f28670572446834bbfe0ef7ac82379e34de29bba4d3e5e9076cb952e2b5cdb",
  "src/js/III_psy_xmin.js":
    "b271ac6b5bb6b11d7929c0ee860d0117936c31c287c05f488637f3e2ad09d864",
  "src/js/L3Side.js":
    "c0c9e49e1f77051735aa88de7ab9518da07b5810db7bdb5a751918f2f3d9d056",
  "src/js/Lame.js":
    "398cfb5587b7213174c8c442915123996b068b1626c0f054956bf3c3e5ea9048",
  "src/js/LameGlobalFlags.js":
    "9097dc805b61f1c0ab9bebcc980e8d99197e35dd5ec7b4cd41a5c8a00855874e",
  "src/js/LameInternalFlags.js":
    "d85208b9ea59d76b55e50493648abc88c8eaefee9f6e6ce7e434f8e6601000d8",
  "src/js/MPEGMode.js":
    "5bb9ed26943770dc5effc59a2e2e151ed7d400e192e10502cc49f770a841f85a",
  "src/js/MeanBits.js":
    "bf6489a8126feee8b86e8da023412dbad0e9010695caa4ca0757839e868ad96c",
  "src/js/NewMDCT.js":
    "a581e57af22c3f441ccfad924507abe7822f68119e1f5c916d2875126ef855a2",
  "src/js/NsPsy.js":
    "7997c3726894f0603e4dce225cacaa39da7491bdf9c59fe5234060c10ff19bf6",
  "src/js/Presets.js":
    "43fd9b2a1548b615cbe8986819b3458054ba0344cb4ebee0ec3b3a7ab93dbb48",
  "src/js/PsyModel.js":
    "79adc604878b69c634bddd0ca889ba84b32e373587e913b960f26fe4f25cc015",
  "src/js/Quantize.js":
    "f22ca4e8eb7a9634a45f47d5611b433defdf2e776a05e4feb1a2d3e0b0ad9c62",
  "src/js/QuantizePVT.js":
    "71b72328e3887d35592affa8f1f68391bd0da293989d7555df37ed2956739eed",
  "src/js/ReplayGain.js":
    "1ef546a7852d6bd26fff8c4e97c20ac61c2bebcba7d5ea23ceef39406a2d341b",
  "src/js/Reservoir.js":
    "5a7e345cfb39d58206e1aa66ace80e3d37fafe935b653458ba38b7821cbd2da1",
  "src/js/ScaleFac.js":
    "edcaed8ddc77687f5e815aeaf85ac4fb16d6464e7fa1cb5bde0d0a4a16734ebd",
  "src/js/Tables.js":
    "c8b6ec015fd5da2caa3847dcd798225e3296ea7ba9f7250e9b87469efa85c62c",
  "src/js/Takehiro.js":
    "ff094f3b59bda41c5f1ed1bda43e1ea6ad7dbf022c8bb928232bdf4e997c7f7c",
  "src/js/VBRQuantize.js":
    "14028068d442dd96a27d9e89b3acf00f37e7c40c1f131e2233db04011cf18a03",
  "src/js/VBRSeekInfo.js":
    "93e10e403e3645433d59d010c49f17851e86a535fe7c98772b5d229f9e8f0368",
  "src/js/VBRTag.js":
    "010760d03584aa20ad71773523e3d984eec0265e47b5c699e8678ce7f17acd6b",
  "src/js/Version.js":
    "e1b18eb4b142a30bb6f507d532df8c8460a2853d7dddd480866a7dc115b7376c",
  "src/js/common.js":
    "ad413546f619c1e95b0f5aa43b6f27a35fb7a3342908b81b5a5b53082c9443c5",
  "src/js/index.js":
    "7f8827c26e0ac4698f61e17b8226e90cd35a32038ff6b177d38846cc161aada9",
  "tsconfig.json":
    "09729f88bd333b430794194952be126194b53f7425d0b2ce7f2e699af595469d",
  "type.d.ts":
    "d4f8f7c4b4a83cc149f258a8b175994e96663a5816517bc72c10ee06794e7d98",
  "vite.config.ts":
    "fb861e656420344f4f500e5be133de24aace8518306bf5da3c4614b1d3c18e11",
};

function vendoredFiles(dir: string, prefix = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory()
      ? vendoredFiles(path.join(dir, entry.name), rel)
      : [rel];
  });
}

describe("the vendored tree is byte-for-byte the recorded one", () => {
  it("holds exactly the recorded files, plus PROVENANCE.md", () => {
    const onDisk = vendoredFiles(VENDORED_DIR)
      .filter((f) => f !== "PROVENANCE.md")
      .sort();
    // A floor, so an empty or unreadable folder cannot pass by matching an
    // empty table.
    expect(onDisk.length).toBeGreaterThanOrEqual(40);
    expect(onDisk).toEqual(Object.keys(VENDORED_DIGESTS).sort());
  });

  it.each(Object.entries(VENDORED_DIGESTS))(
    "%s matches its recorded SHA-256",
    (file, digest) => {
      const bytes = readFileSync(path.join(VENDORED_DIR, file));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(digest);
    }
  );
});

describe("the vendored folder records where it came from", () => {
  const provenancePath = path.join(VENDORED_DIR, "PROVENANCE.md");

  it("has a LICENSE and a PROVENANCE.md", () => {
    expect(existsSync(path.join(VENDORED_DIR, "LICENSE"))).toBe(true);
    expect(existsSync(provenancePath)).toBe(true);
  });

  it("names the full 40-hex npm gitHead as both the gitHead and the upstream commit", () => {
    const provenance = readFileSync(provenancePath, "utf8");
    const row = (field: string): string | undefined =>
      new RegExp(`^\\|\\s*${field}\\s*\\|\\s*\`([^\`]*)\``, "m").exec(
        provenance
      )?.[1];
    for (const field of ["npm `gitHead`", "Upstream commit"]) {
      const value = row(field.replace(/`/g, "`?"));
      expect(value, `PROVENANCE.md has no "${field}" row`).toBeDefined();
      expect(value).toMatch(/^[0-9a-f]{40}$/);
      expect(value).toBe(VENDORED_GIT_HEAD);
    }
    expect(row("npm version")).toBe(lockedVersion());
  });
});

describe("the lamejs source link", () => {
  // Any 40-hex value stands in for the build's commit; the build injects the
  // real one (tests/dist-source-offer.test.ts checks the built bundle).
  const BUILD_COMMIT = "0123456789abcdef0123456789abcdef01234567";

  beforeEach(() => {
    vi.stubGlobal("__BUILD_SHA_FULL__", BUILD_COMMIT);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens the vendored folder in this repository at the build's full commit", () => {
    // `href` is written out as one literal so the build folds it; this ties
    // that literal to `path`, which the checks above tie to package-lock.
    expect(lamejs?.source?.href).toBe(
      `https://github.com/unfoldingWord/tc-mobile/tree/${BUILD_COMMIT}/${vendoredPath}`
    );
  });
});
