import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

/**
 * Headless-Chromium smoke config (#251). `e2e/browser-boundary-smoke.spec.ts`
 * is the one spec file this stands up — what it proves, and deliberately does
 * not, is documented in its header.
 *
 * TWO builds, two previews, two projects — because the two specs need
 * different builds (round-1 George G3):
 *
 *   - `dist-e2e/` (`vite build --mode e2e`) is the ONLY build that ships
 *     `src/app/e2e-harness.ts` (see `vite.config.ts`), so the harness-driven
 *     assertions 2-4 in `browser-boundary-smoke.spec.ts` need it. Its module
 *     graph carries that extra chunk, so it is NOT the graph anyone installs.
 *   - `dist/` (`npm run build`) is the real shipped build. The service-worker
 *     precache assertion touches no harness, so it runs against `dist/` and
 *     asserts the manifest users actually get.
 *
 * `npm run test:e2e` produces both before Playwright starts. Separate ports
 * are separate origins, so each build's service worker, Cache Storage and
 * IndexedDB stay isolated from the other's.
 *
 * Chromium resolution is two-path, on purpose:
 *   - This repo's sandboxed dev container pre-installs Chromium OUTSIDE the
 *     npm-managed browser cache, at `/opt/pw-browsers/chromium` — a version
 *     that may not match whatever `@playwright/test` expects, so it must be
 *     launched by explicit path rather than through Playwright's own resolver.
 *   - A GitHub Actions runner has neither: its CI job runs
 *     `npx playwright install --with-deps chromium` first (a version-matched
 *     download, the standard approach on a fresh Ubuntu runner), so there
 *     `PINNED_CHROMIUM` is undefined and Playwright resolves its own browser.
 */
const PINNED_CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_PATH ??
  (existsSync("/opt/pw-browsers/chromium")
    ? "/opt/pw-browsers/chromium"
    : undefined);

/** `dist-e2e/`: the harness build, for the assertions that need `window.__e2e`. */
const PORT_E2E = 4300;
/** `dist/`: the real shipped build, for the service-worker precache assertion. */
const PORT_DIST = 4301;

const chromium = {
  ...devices["Desktop Chrome"],
  launchOptions: PINNED_CHROMIUM ? { executablePath: PINNED_CHROMIUM } : {},
};

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  // "list" for the terminal; "html" (never auto-opened) is what CI's
  // failure-only upload step in ci.yml archives as `playwright-report/`.
  reporter: [["list"], ["html", { open: "never" }]],
  use: { trace: "retain-on-failure" },
  webServer: [
    {
      command: `npm run preview:e2e -- --port ${PORT_E2E} --strictPort`,
      url: `http://127.0.0.1:${PORT_E2E}`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: `npm run preview -- --port ${PORT_DIST} --strictPort`,
      url: `http://127.0.0.1:${PORT_DIST}`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
  projects: [
    {
      // The harness build. `testMatch` is explicit rather than "everything
      // except the other file": a new spec added here without a project of
      // its own should fail to run visibly, not silently join whichever
      // project's baseURL happened to be the catch-all.
      name: "chromium-harness",
      testMatch: /browser-boundary-smoke\.spec\.ts$/,
      use: { ...chromium, baseURL: `http://127.0.0.1:${PORT_E2E}` },
    },
    {
      name: "chromium-shipped-build",
      testMatch: /service-worker-precache\.spec\.ts$/,
      use: { ...chromium, baseURL: `http://127.0.0.1:${PORT_DIST}` },
    },
    {
      // The durable failure log (#205). Drives the real UI and touches no
      // harness, so it runs against `dist/` for the same reason the
      // service-worker spec does — the bundle that ships is the one whose
      // reload behaviour matters.
      name: "chromium-failure-log",
      testMatch: /failure-log\.spec\.ts$/,
      use: { ...chromium, baseURL: `http://127.0.0.1:${PORT_DIST}` },
    },
  ],
});
