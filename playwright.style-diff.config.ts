import { resolve } from "node:path";

import { defineConfig } from "@playwright/test";

import base from "./playwright.config";

/**
 * The computed-style diff tool's capture run (#954): the same specs and
 * projects as `playwright.config.ts`, served from builds named in the
 * environment, with `e2e/support/test.ts`'s capture fixture switched on.
 *
 * Ports 4340/4341, not 4300/4301, which parallel lanes share, and
 * `reuseExistingServer: false`, so a run can never read another checkout's
 * build. One worker and no retries, so states arrive in one order.
 *
 * How a lane runs it, one command per step:
 *   1. Build the base and the head (`npm run build` and `npm run build:e2e`
 *      in a checkout of each), or copy each pair of builds aside.
 *   2. Capture the base twice and the head once, each into its own empty
 *      directory, from the HEAD checkout (its specs drive all three runs):
 *        STYLE_CAPTURE_DIR=<dir> STYLE_DIFF_DIST=<dist> \
 *          STYLE_DIFF_DIST_E2E=<dist-e2e> npm run style:capture
 *   3. `npm run style:diff -- <A1> <A2>` is the self-check. Its verdict must
 *      be clean. A difference, an unmatched state or a state that did not
 *      settle is named with its cause on the PR, never left out by default;
 *      `--ignore <prop>` stays explicit, and the report prints it.
 *   4. `npm run style:diff -- <A1> <B> --base <sha> --head <sha>` is the
 *      result. `--rename-prop old=new` maps a renamed custom property.
 * The output goes in a PR comment, never into a file in the tree (AGENTS.md).
 * `.style-capture/` is gitignored for capture directories kept in the
 * checkout.
 */
const NAMES = ["STYLE_CAPTURE_DIR", "STYLE_DIFF_DIST", "STYLE_DIFF_DIST_E2E"];
const missing = NAMES.filter((name) => !process.env[name]);
const at = (name: string) => resolve(process.env[name] ?? ".");
const captureDir = at("STYLE_CAPTURE_DIR");
const dist = at("STYLE_DIFF_DIST");
const distE2e = at("STYLE_DIFF_DIST_E2E");
// The fixture reads this in the worker; resolved here so a relative path
// means the same directory in both processes.
if (missing.length === 0) process.env.STYLE_CAPTURE_DIR = captureDir;

/** `playwright.config.ts`'s ports, each moved to its own here. */
const PORTS: Record<string, number> = { "4300": 4340, "4301": 4341 };
const PORT_E2E = 4340;
const PORT_DIST = 4341;

const moved = (baseURL: string | undefined): string => {
  const url = new URL(baseURL ?? "");
  const port = PORTS[url.port];
  if (port === undefined) throw new Error(`no style-diff port for ${baseURL}`);
  url.port = String(port);
  return url.origin;
};

/**
 * Loaded without its environment (a bare `playwright test -c`, or a tool that
 * reads every Playwright config, as knip does): it matches no test, so it
 * serves and captures nothing, and it says why instead of throwing.
 */
const refuse = () => {
  console.error(
    `playwright.style-diff.config.ts runs nothing without ${missing.join(", ")}`
  );
  return defineConfig({ testDir: "./e2e", testMatch: [] });
};

export default missing.length > 0
  ? refuse()
  : defineConfig({
      ...base,
      workers: 1,
      retries: 0,
      reporter: [["list"]],
      outputDir: resolve(captureDir, "test-results"),
      webServer: [
        {
          command: `npx vite preview --outDir "${distE2e}" --host 127.0.0.1 --port ${PORT_E2E} --strictPort`,
          url: `http://127.0.0.1:${PORT_E2E}`,
          reuseExistingServer: false,
          timeout: 30_000,
        },
        {
          command: `npx vite preview --outDir "${dist}" --host 127.0.0.1 --port ${PORT_DIST} --strictPort`,
          url: `http://127.0.0.1:${PORT_DIST}`,
          reuseExistingServer: false,
          timeout: 30_000,
        },
      ],
      projects: (base.projects ?? []).map((project) => ({
        ...project,
        use: { ...project.use, baseURL: moved(project.use?.baseURL) },
      })),
    });
