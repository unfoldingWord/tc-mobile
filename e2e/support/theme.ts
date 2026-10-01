import type { Page } from "@playwright/test";

/**
 * The floor colours and the two readers the theme specs share.
 *
 * Extracted when the mid-take case (#149) needed its own spec file — a
 * `test.use({ launchOptions })` for the fake microphone forces a new worker and
 * so cannot sit in a describe — rather than copying four helpers into it.
 */

/** `--p-cool-950`, the dark floor. */
export const DARK_FLOOR = "rgb(11, 16, 22)";
/** `--p-cool-050`, the light floor. */
export const LIGHT_FLOOR = "rgb(246, 248, 250)";

/** The computed `--s-floor`, as authored (a token value, not yet resolved). */
export const floorOf = (page: Page) =>
  page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--s-floor")
      .trim()
  );

/** The resolved `rgb()` of a CSS colour, so a hex token and a computed value compare. */
export const resolved = (page: Page, value: string) =>
  page.evaluate((v) => {
    const probe = document.createElement("div");
    probe.style.color = v;
    document.body.append(probe);
    const out = getComputedStyle(probe).color;
    probe.remove();
    return out;
  }, value);
