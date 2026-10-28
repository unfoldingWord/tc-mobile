import { test as base } from "@playwright/test";

import { startCapture } from "../style-diff/capture";

/**
 * The `test` every e2e spec imports (#954), in place of `@playwright/test`'s.
 *
 * It adds one automatic fixture, `styleCapture`, which does nothing unless
 * `STYLE_CAPTURE_DIR` is set. Set, it records the page's computed style after
 * every action (`e2e/style-diff/capture.ts`), for the computed-style diff
 * tool that `playwright.style-diff.config.ts` runs. Unset — CI and every
 * normal run — the fixture only yields, so a spec behaves as it did on
 * `@playwright/test`'s own `test`.
 *
 * It depends on `context` rather than `page` so that a spec that opens its
 * own pages is not handed an extra one, and so that it tears down before the
 * context closes, while the pages can still be read for the "end" state.
 *
 * `tests/e2e-test-import.test.ts` fails a spec that imports `test` from
 * `@playwright/test` directly, which would skip the capture without anyone
 * seeing it.
 */
export const test = base.extend<{ styleCapture: void }>({
  styleCapture: [
    // `provide` is Playwright's `use`: renamed only because the React hooks
    // lint reads any call named `use` as React's hook.
    async ({ context }, provide, testInfo) => {
      const dir = process.env.STYLE_CAPTURE_DIR;
      if (!dir) {
        await provide();
        return;
      }
      const finish = await startCapture(dir, context, testInfo);
      // A failing test still returns from `provide`, so `finish` runs for it.
      await provide();
      await finish();
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
export type { ElementHandle, Locator, Page } from "@playwright/test";
