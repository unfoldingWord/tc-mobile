import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import config from "../vitest.config";
import { stripYamlComments } from "./support";

/**
 * The src/lib coverage floor (#159 Q-16) is a config object plus two wirings
 * (an npm script and a CI step). This pins the three, so deleting any one is a
 * red test rather than a quiet loss of the gate. What the numbers themselves
 * catch is shown by running `npm run test:coverage` against a subset of the
 * suite, which is a run, not something a unit test can assert.
 */
const root = path.resolve(import.meta.dirname, "..");
const coverage = config.test?.coverage;
const thresholds = (coverage?.thresholds ?? {}) as Record<string, unknown>;

describe("src/lib coverage gate (#159 Q-16)", () => {
  it("uses the v8 provider, scoped to src/lib", () => {
    expect(coverage?.provider).toBe("v8");
    expect(coverage?.include).toEqual(["src/lib/**/*.ts"]);
  });

  it("holds a global floor on all four metrics", () => {
    for (const metric of ["lines", "statements", "functions", "branches"]) {
      expect(thresholds[metric], metric).toBeGreaterThanOrEqual(90);
    }
  });

  it.each(["audio", "storage", "takes"])(
    "holds a per-directory floor for src/lib/%s",
    (dir) => {
      const floor = thresholds[`src/lib/${dir}/**`] as Record<string, number>;
      expect(floor, dir).toBeDefined();
      for (const metric of ["lines", "statements", "functions", "branches"]) {
        expect(floor[metric], `${dir} ${metric}`).toBeGreaterThanOrEqual(85);
      }
    }
  );

  it("does not report on a failed run", () => {
    expect(coverage?.reportOnFailure).toBe(false);
  });

  it("is reachable: an npm script runs it and CI calls that script", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf8")
    ) as { scripts: Record<string, string> };
    expect(pkg.scripts["test:coverage"]).toMatch(/^vitest run --coverage\b/);
    // The plain `npm test` must stay uninstrumented.
    expect(pkg.scripts.test).toBe("vitest run");

    const ci = stripYamlComments(
      readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8")
    );
    expect(ci).toMatch(/^\s*run: npm run test:coverage\s*$/m);
  });
});
