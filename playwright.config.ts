import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

/**
 * Headless-Chromium smoke config (#251). `e2e/browser-boundary-smoke.spec.ts`
 * is the one spec file this stands up — what it proves, and deliberately does
 * not, is documented in its header.
 *
 * `npm run test:e2e` runs `build:e2e` first (`vite build --mode e2e`, the
 * ONLY build that ships `src/app/e2e-harness.ts` — see `vite.config.ts`) into
 * `dist-e2e/`, then this config's `webServer` serves that build with
 * `vite preview` and points every test at it. Nothing here touches `dist/`,
 * the real production build CI's `Build` job produces and checks.
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

const PORT = 4300;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  // "list" for the terminal; "html" (never auto-opened) is what CI's
  // failure-only upload step in ci.yml archives as `playwright-report/`.
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run preview:e2e -- --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: PINNED_CHROMIUM
          ? { executablePath: PINNED_CHROMIUM }
          : {},
      },
    },
  ],
});
