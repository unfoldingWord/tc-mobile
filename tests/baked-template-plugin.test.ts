import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { bakedTemplatePackagesPlugin } from "../vite.config.ts";

/**
 * The build plugin that swaps the baked packages in (#1450 plan task 6;
 * Frank round 2 P2 on #1798). Vite hands every hook a module id with forward
 * slashes, on Windows too (its "path normalization" contract), so the
 * plugin's own path for the baked module must be compared in that form. A
 * Windows build cannot run here, so the module path is built with
 * `path.win32` and the hooks get the id Vite would give them for it.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const titus = JSON.parse(
  readFileSync(
    path.join(ROOT, "templates", "bible-passages", "TIT.json"),
    "utf8"
  )
) as unknown;

/** An opted-in bake: Titus, provisional. */
const bake = () => ({
  baked: [
    {
      id: "bible-passages:TIT",
      version: "0.0.0",
      provisional: true,
      pkg: titus,
      titles: [],
    },
  ],
  leftOut: [],
});

type Hook = (this: unknown, ...args: unknown[]) => unknown;

/** Runs the plugin's three hooks the way a build would, for one module id. */
function runPlugin(bakedModule: string, viteId: string) {
  const plugin = bakedTemplatePackagesPlugin(bakedModule, bake);
  (plugin.buildStart as Hook).call({ info: () => undefined });
  const loaded = (plugin.load as Hook).call({}, viteId) as string | null;
  const emitted: { source: string }[] = [];
  (plugin.generateBundle as Hook).call(
    { emitFile: (file: { source: string }) => emitted.push(file) },
    {},
    {
      "assets/index-x.js": {
        type: "chunk",
        fileName: "assets/index-x.js",
        moduleIds: ["C:/repo/src/main.tsx"],
      },
      "assets/baked-template-packages-x.js": {
        type: "chunk",
        fileName: "assets/baked-template-packages-x.js",
        moduleIds: [viteId],
      },
    }
  );
  const report = JSON.parse(emitted[0]!.source) as {
    chunk: string | null;
    packages: string[];
  };
  return { loaded, report };
}

describe("the baked-template plugin matches Vite's module id", () => {
  it("replaces the module, and finds its chunk, from a Windows-built path", () => {
    const bakedModule = path.win32.join(
      "C:\\repo",
      "src",
      "data",
      "baked-template-packages.json"
    );
    const { loaded, report } = runPlugin(
      bakedModule,
      "C:/repo/src/data/baked-template-packages.json"
    );
    expect(loaded).not.toBeNull();
    expect(JSON.parse(loaded!)).toEqual([{ pkg: titus, titles: [] }]);
    expect(report).toEqual({
      chunk: "assets/baked-template-packages-x.js",
      packages: ["bible-passages:TIT"],
    });
  });

  it("does the same from a POSIX path", () => {
    const { loaded, report } = runPlugin(
      "/repo/src/data/baked-template-packages.json",
      "/repo/src/data/baked-template-packages.json"
    );
    expect(JSON.parse(loaded!)).toEqual([{ pkg: titus, titles: [] }]);
    expect(report.chunk).toBe("assets/baked-template-packages-x.js");
  });

  it("leaves every other module alone", () => {
    const plugin = bakedTemplatePackagesPlugin(
      "/repo/src/data/baked-template-packages.json",
      bake
    );
    (plugin.buildStart as Hook).call({ info: () => undefined });
    expect(
      (plugin.load as Hook).call({}, "/repo/src/data/obs-catalog.json")
    ).toBeNull();
  });
});
