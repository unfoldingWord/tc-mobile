import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  PROD_DOMAIN_ORIGIN,
  PROD_ORIGIN,
  remoteRefForOrigin,
} from "../scripts/check-deploy.mjs";
import {
  PROD_ORIGINS,
  prodCheckArgv,
  runProdChecks,
} from "../scripts/check-deploy-prod.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "check-deploy-prod.mjs");

// #1299 round-1 George P2: `npm run <script> -- <args>` appends `<args>` to
// the END of the script text, so in a `a && b` npm script only `b` sees
// them. `check:deploy:prod` used to be exactly that chain, which made
// `-- --sha=<prev> --version=<prev>` (the rollback confirmation form) bind
// only to the custom-domain run while the workers.dev run compared against
// `origin/main` and PASSed on the rolled-away build. The wrapper exists so
// one argv reaches every production origin; these tests pin that.
describe("check-deploy-prod: one argv reaches every production origin", () => {
  const FIRST_EXTRA = "--sha=aaaaaaa";
  const EXTRA = [FIRST_EXTRA, "--version=1.0.0"];

  it("checks exactly the two production origins, workers.dev first", () => {
    expect(PROD_ORIGINS).toEqual([PROD_ORIGIN, PROD_DOMAIN_ORIGIN]);
  });

  it("every production origin resolves its expectation from origin/main", () => {
    for (const origin of PROD_ORIGINS) {
      expect(remoteRefForOrigin(origin)).toBe("origin/main");
    }
  });

  it("prodCheckArgv fixes the origin, requires it, and forwards the promoter's arguments", () => {
    for (const origin of PROD_ORIGINS) {
      const argv = prodCheckArgv(origin, EXTRA);
      expect(argv[0]).toBe(path.join(ROOT, "scripts", "check-deploy.mjs"));
      expect(argv).toContain("--require-origin");
      expect(argv).toContain(`--origin=${origin}`);
      for (const flag of EXTRA) expect(argv).toContain(flag);
      // The fixed origin precedes the promoter's arguments, so a promoter
      // who also passes one hits parseArgs' "given more than once" error
      // instead of silently overriding the production origin.
      expect(argv.indexOf(`--origin=${origin}`)).toBeLessThan(
        argv.indexOf(FIRST_EXTRA)
      );
    }
  });

  it("runProdChecks spawns every origin with the same forwarded arguments and returns 0 when all pass", () => {
    const seen: string[][] = [];
    const status = runProdChecks(EXTRA, {
      spawn: (argv) => {
        seen.push(argv);
        return 0;
      },
      log: () => {},
    });
    expect(status).toBe(0);
    expect(
      seen.map((argv) => argv.find((a) => a.startsWith("--origin=")))
    ).toEqual(PROD_ORIGINS.map((origin) => `--origin=${origin}`));
    for (const argv of seen) {
      for (const flag of EXTRA) expect(argv).toContain(flag);
    }
  });

  it("runProdChecks stops at the first failing origin and returns its status", () => {
    const seen: string[][] = [];
    const status = runProdChecks([], {
      spawn: (argv) => {
        seen.push(argv);
        return 1;
      },
      log: () => {},
    });
    expect(status).toBe(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain(`--origin=${PROD_ORIGIN}`);
  });

  it("runProdChecks treats a run with no numeric status (signal-killed) as a failure", () => {
    const status = runProdChecks([], { spawn: () => null, log: () => {} });
    expect(status).toBe(1);
  });

  it("runProdChecks names each origin as it starts it", () => {
    const lines: string[] = [];
    runProdChecks([], { spawn: () => 0, log: (m) => lines.push(m) });
    expect(lines).toHaveLength(PROD_ORIGINS.length);
    for (const [i, origin] of PROD_ORIGINS.entries()) {
      expect(lines[i]).toContain(origin);
    }
  });
});

describe("check-deploy-prod: entry path", () => {
  // The duplicate `--sha` makes the child's `parseArgs` throw before it
  // touches git or the network, so this proves the wrapper runs as a CLI
  // and that the promoter's arguments actually reach the child — with no
  // network and no remote.
  it("runs the checker as a child and forwards argv to it", () => {
    let status = 0;
    let stderr = "";
    try {
      execFileSync("node", [SCRIPT, "--sha=aaaaaaa", "--sha=bbbbbbb"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 10_000,
      });
    } catch (err) {
      const e = err as { status: number | null; stderr: string };
      status = e.status ?? -1;
      stderr = e.stderr;
    }
    expect(status).toBe(1);
    expect(stderr).toContain("FAIL:");
    expect(stderr).toContain("--sha was given more than once");
  });
});

describe("package.json's check:deploy:prod runs the wrapper, not a shell chain", () => {
  it("is exactly `node scripts/check-deploy-prod.mjs`, so `npm run -- <args>` reaches every origin", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(ROOT, "package.json"), "utf8")
    ) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["check:deploy:prod"]).toBe(
      "node scripts/check-deploy-prod.mjs"
    );
  });
});
