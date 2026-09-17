import { expect, test } from "@playwright/test";

/**
 * The light theme, actually reached — in a real browser (#171).
 *
 * WHY THIS EXISTS AND `tests/theme.test.ts` IS NOT ENOUGH. The defect in #171
 * was never a wrong value: the light block in `2-semantic.css` was complete and
 * correct. The defect was that nothing could SELECT it. A Node table over
 * `readStoredTheme`/`nextTheme` passes in full with the hook deleted and the
 * toggle never mounted, and the source-shape half of that file proves only that
 * the right strings appear in the right files. Neither can tell you that a tap
 * repaints the screen, which is the entire claim. AGENTS.md: "the rigor landed
 * on the pure core and skipped the boundary."
 *
 * WHY IT IS ALLOWED TO DRIVE THE UI, when `browser-boundary-smoke.spec.ts`'s
 * header says that file deliberately does not. The reason given there is
 * fragile UI timing around a fake microphone and simulated audio. This has
 * neither: the hamburger is ungated on the Books screen (no book, no chapter,
 * no permission needed), the toggle is synchronous, and every assertion is a
 * computed style or an attribute. It is the one interaction in this app with no
 * audio dependency at all, which is why it can be driven honestly and the
 * recorder cannot.
 *
 * It runs against the real shipped `dist/` build, so what it proves is the
 * cascade users actually get — including that Tailwind's `@layer` ordering and
 * the minifier have not dropped the light block.
 *
 * WHAT IT STILL DOES NOT PROVE. That the light theme is READABLE in direct
 * equatorial sun, which is the condition it was written for. That is a device
 * check on a phone outdoors, and it is still owed (#245 for Android at all,
 * #249 for whether the glyph is recognised). Headless Chromium on a container
 * is not a screen in Nairobi.
 */

/** `--p-cool-950`, the dark floor. */
const DARK_FLOOR = "rgb(11, 16, 22)";
/** `--p-cool-050`, the light floor. */
const LIGHT_FLOOR = "rgb(246, 248, 250)";

const floorOf = (page: import("@playwright/test").Page) =>
  page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--s-floor")
      .trim()
  );

const themeColor = (page: import("@playwright/test").Page) =>
  page.evaluate(
    () =>
      document
        .querySelector('meta[name="theme-color"]')
        ?.getAttribute("content") ?? null
  );

/** The resolved rgb() of a CSS colour, so a hex token and a computed value compare. */
const resolved = (page: import("@playwright/test").Page, value: string) =>
  page.evaluate((v) => {
    const probe = document.createElement("div");
    probe.style.color = v;
    document.body.append(probe);
    const out = getComputedStyle(probe).color;
    probe.remove();
    return out;
  }, value);

test.describe("the light theme is reachable and sticks (#171)", () => {
  test("a tap flips the theme, repaints the chrome, and survives a reload", async ({
    page,
  }) => {
    await page.goto("/");

    // --- 1. dark by default ------------------------------------------------
    // `2-semantic.css`'s header: the app ships dark. Asserted as the starting
    // point, so a later default flip fails here rather than making the toggle
    // assertions below pass vacuously in the wrong direction.
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await resolved(page, await floorOf(page))).toBe(DARK_FLOOR);

    // The `theme-color` meta must already track the token rather than
    // `index.html`'s old hard-coded `#0b0f14` — which had itself drifted from
    // `--s-floor` (#0b1016), so the status bar was never quite the app's floor.
    expect(await resolved(page, (await themeColor(page)) ?? "")).toBe(
      DARK_FLOOR
    );

    // --- 2. the toggle is where a translator can find it -------------------
    await page.getByRole("button", { name: "Open menu" }).click();
    const menu = page.getByRole("dialog", { name: "Menu" });
    await expect(menu).toBeVisible();
    // Named by DESTINATION, not state — a control reading "Dark theme" while
    // the screen is already dark tells an AT user nothing.
    const toLight = menu.getByRole("button", {
      name: /light screen/i,
    });
    await expect(toLight).toBeVisible();

    // --- 3. the tap actually repaints --------------------------------------
    await toLight.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await resolved(page, await floorOf(page))).toBe(LIGHT_FLOOR);
    // The OS chrome follows the body. This is the half that was broken by
    // construction before: a hard-coded meta meant a dark status bar over a
    // white screen.
    expect(await resolved(page, (await themeColor(page)) ?? "")).toBe(
      LIGHT_FLOOR
    );

    // The menu stays open across the tap, which is the affordance doing the
    // explaining for a non-reader: the screen changes behind the scrim, and
    // the control has already become its own undo.
    await expect(menu).toBeVisible();
    const toDark = menu.getByRole("button", { name: /dark screen/i });
    await expect(toDark).toBeVisible();

    // --- 4. two taps return you exactly where you were ---------------------
    // The involution `lib/theme.ts` promises, checked through the DOM rather
    // than only over the function — this is the only guarantee a glyph with no
    // text can offer.
    await toDark.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await resolved(page, await floorOf(page))).toBe(DARK_FLOOR);

    // --- 5. it is remembered ----------------------------------------------
    // The reason #171 chose a persisted toggle over `prefers-color-scheme`:
    // these are shared phones, and the translator standing in the sun cannot
    // change the OS setting. A preference that did not survive a reload would
    // have to be re-made every launch.
    await menu.getByRole("button", { name: /light screen/i }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await resolved(page, await floorOf(page))).toBe(LIGHT_FLOOR);
    expect(await resolved(page, (await themeColor(page)) ?? "")).toBe(
      LIGHT_FLOOR
    );
  });

  test("the light theme's own ink is painted, not left at the dark value", async ({
    page,
  }) => {
    // The token indirection is where a light theme silently half-applies: a
    // role that resolves through `var()` to a primitive the light block does
    // not override keeps its dark value, and the result is dark-on-white. So
    // this reads INK as well as the floor, in the shipped cascade, rather than
    // trusting that one attribute selected the whole block.
    await page.goto("/");
    await page.getByRole("button", { name: "Open menu" }).click();
    await page
      .getByRole("dialog", { name: "Menu" })
      .getByRole("button", { name: /light screen/i })
      .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    const inks = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      return {
        ink: s.getPropertyValue("--s-ink").trim(),
        faint: s.getPropertyValue("--s-ink-faint").trim(),
        voiceText: s.getPropertyValue("--s-voice-text").trim(),
      };
    });
    // The light block's values (2-semantic.css), not the dark ones.
    expect(inks.ink).toBe("#101821");
    // The AA fix from this same lane (#164 R-9) must be what the browser
    // resolves, not the pre-fix #7d8896 — so the contrast gate's Node numbers
    // describe the shipped cascade and not just the source file.
    expect(inks.faint).toBe("#626d7b");
    expect(inks.voiceText).toBe("#8a5a12");
  });
});

test.describe("the theme survives navigation when persistence fails (#457 QA P2)", () => {
  test("a failed write still keeps the theme across Books → chapter → Books", async ({
    page,
  }) => {
    // The reviewer's reproduction, kept as the regression. `localStorage` does
    // not merely go absent in the field — the write THROWS (Safari with cookies
    // blocked, a WebView with storage disabled, a full quota), which is why
    // `use-theme.ts` catches it and keeps going. This proves what "keeps going"
    // has to mean: `App` renders BooksScreen XOR SegmentsScreen, so opening a
    // chapter unmounts the only component that calls `useTheme`, and a theme
    // re-derived from storage on remount came back as the default.
    //
    // Scoped to this app's own key so nothing else in the page is perturbed.
    await page.addInitScript(() => {
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key === "tc-mobile.theme") {
          const error = new Error("QuotaExceededError");
          error.name = "QuotaExceededError";
          throw error;
        }
        return setItem.call(this, key, value);
      };
    });
    await page.goto("/");

    // A book and a chapter, so there is somewhere to navigate TO.
    await page.getByRole("button", { name: "New book" }).click();
    await page
      .getByRole("dialog", { name: "Name your new book" })
      .getByRole("button", { name: "Create book" })
      .click();
    const addChapter = page.getByRole("button", { name: /^Add chapter to / });
    await expect(addChapter).toBeVisible();
    await addChapter.click();
    // Wait for the row itself, not a fixed delay: it appears once the write
    // lands.
    const openChapter = page.getByRole("button", { name: /^Open Chapter/ });
    await expect(openChapter).toBeVisible();

    // Switch to light, with the write failing underneath.
    await page.getByRole("button", { name: "Open menu" }).click();
    await page
      .getByRole("dialog", { name: "Menu" })
      .getByRole("button", { name: /light screen/i })
      .click();
    await page.keyboard.press("Escape");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    // Into the chapter — this is the unmount. `/^Open Chapter/`, deliberately,
    // not `/^Open /`: the latter also matches the hamburger's "Open menu", and
    // a `.first()` on it silently reopened the menu instead of navigating.
    await openChapter.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    // And back to Books, which is where it used to revert to dark.
    await page.getByRole("button", { name: "Back to books" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await resolved(page, await floorOf(page))).toBe(LIGHT_FLOOR);
    // The OS chrome too: it is repainted by the same effect, so a reverted
    // theme would have taken the status bar back to dark with it.
    expect(await resolved(page, (await themeColor(page)) ?? "")).toBe(
      LIGHT_FLOOR
    );

    // And the failure was REPORTED, not swallowed — the one sink (#167). Proved
    // by the write having actually thrown: storage holds nothing for our key,
    // so the theme above came from the live value and not from a read.
    const stored = await page.evaluate(() =>
      window.localStorage.getItem("tc-mobile.theme")
    );
    expect(
      stored,
      "the write did not actually fail, so this proved nothing"
    ).toBeNull();
  });
});
