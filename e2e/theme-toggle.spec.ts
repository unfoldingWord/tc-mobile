import { expect, test } from "@playwright/test";

import { seedToRecorder, seedToSegments } from "./support/seed";
import { DARK_FLOOR, LIGHT_FLOOR, floorOf, resolved } from "./support/theme";

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
 * fragile UI timing around a fake microphone and simulated audio. The cases
 * here need neither: the hamburger is ungated on the Books screen (no book, no
 * chapter, no permission needed), the toggle is synchronous, and every
 * assertion is a computed style or an attribute.
 *
 * This paragraph used to end "which is why it can be driven honestly and the
 * recorder cannot". That was already untrue when written —
 * `e2e/recorder-selection.spec.ts` drives a real take against
 * `--use-fake-device-for-media-stream` — and `e2e/theme-mid-take.spec.ts` now
 * toggles the theme during one. What is true is narrower and is all this file
 * needs: none of ITS cases require a microphone, so none of them pay that
 * timing cost.
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

const themeColor = (page: import("@playwright/test").Page) =>
  page.evaluate(
    () =>
      document
        .querySelector('meta[name="theme-color"]')
        ?.getAttribute("content") ?? null
  );

/**
 * The iOS sibling of `theme-color` (George R1 P2 on #457): the standalone
 * status-bar style. What this can prove in Chromium is only that the attribute
 * is WRITTEN — whether iOS reads it after launch is a device question
 * `use-theme.ts` records as unverified, not a claim this spec makes.
 */
const statusBarStyle = (page: import("@playwright/test").Page) =>
  page.evaluate(
    () =>
      document
        .querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
        ?.getAttribute("content") ?? null
  );

/** The `≡` control, by role — its name carries the failure count (#205). */
const menuControl = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: /^Open menu/ });

/**
 * The alert badge on the `≡`, the state-in-place signal for a non-reader. By
 * class, because it is `aria-hidden` on purpose — same locator, same reason,
 * as `e2e/failure-log.spec.ts`.
 */
const failureMarker = (page: import("@playwright/test").Page) =>
  page.locator("header .control-hint");

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
    // And the iOS standalone status-bar style ships dark with it.
    expect(await statusBarStyle(page)).toBe("black-translucent");

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
    // The iOS half of the same defect: `theme-color` is not what an installed
    // iOS PWA reads for its status bar, and `black-translucent` left there
    // means light clock-and-battery glyphs over a near-white floor. `default`
    // is the dark-content style (George R1 P2 on #457).
    expect(await statusBarStyle(page)).toBe("default");

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
    expect(await statusBarStyle(page)).toBe("black-translucent");

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
    // Written before React renders (`installStoredTheme`), so a relaunch in
    // light does not ship the dark status-bar style from `index.html`.
    expect(await statusBarStyle(page)).toBe("default");
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
    // Add chapter opens a naming prompt now (#609); Confirm alone accepts the
    // pre-filled "Chapter N" and is what actually writes the chapter.
    await page
      .getByRole("dialog", { name: "Name your new chapter" })
      .getByRole("button", { name: "Create chapter" })
      .click();
    // Wait for the row itself, not a fixed delay: it appears once the write
    // lands.
    const openChapter = page.getByRole("button", { name: /^Open Chapter/ });
    await expect(openChapter).toBeVisible();

    // A quiet log before the tap — asserted, not assumed, so the count below
    // is this test's own failure and not something carried in.
    await expect(menuControl(page)).toHaveAccessibleName("Open menu");
    await expect(failureMarker(page)).toHaveCount(0);

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
    // The OS chrome too: it is repainted by the same `applyTheme` call (in the
    // store on a toggle, in `useTheme`'s mount reconcile on the way back), so
    // a reverted theme would have taken the status bar back to dark with it.
    expect(await resolved(page, (await themeColor(page)) ?? "")).toBe(
      LIGHT_FLOOR
    );

    // And the failure was REPORTED, not swallowed — the one sink (#167),
    // proved by what the report does that nothing else can: the durable log
    // now holds one row, so the ≡ carries the count in its name and the alert
    // mark beside it (#205). An earlier draft of this test inferred the report
    // from the write having thrown, which proves nothing about the report at
    // all — delete `reportFailure` from `use-theme.ts` and every assertion
    // above still passes (Frank R1 P2 on #457). This one does not.
    await expect(menuControl(page)).toHaveAccessibleName(
      "Open menu. 1 problem recorded."
    );
    await expect(failureMarker(page)).toHaveCount(1);

    // Separately: the write DID throw. Storage holds nothing for our key, so
    // the theme above came from the live value and not from a read — without
    // this, a fault injection that silently stopped injecting would let the
    // navigation assertions pass for the wrong reason.
    const stored = await page.evaluate(() =>
      window.localStorage.getItem("tc-mobile.theme")
    );
    expect(
      stored,
      "the write did not actually fail, so this proved nothing"
    ).toBeNull();
  });
});

test.describe("the theme is reachable from the screens you work on (#149)", () => {
  /**
   * #149 asked whether Books-only was acceptable for the global menu. It was,
   * while the menu's only entry was a licence notice nobody needs mid-session.
   * The theme toggle (#171, #457) is the opposite: `2-semantic.css`'s header
   * says the light theme exists because direct equatorial sun makes the dark
   * screen unreadable, and that condition arrives WHILE you are recording. On
   * a Books-only toggle the way out is back out of the recorder, back out of
   * Segments, open the hamburger, tap, and navigate back in — four screens,
   * in the one condition where the screen is hardest to read.
   *
   * So these two cases assert the toggle is reachable from the chapter's `≡`
   * and the recorder's `≡`, and that tapping it there actually repaints. They
   * fail on a Books-only toggle at the locator: the control is not in those
   * menus at all.
   *
   * WHY NOT A SECOND HAMBURGER on those screens. Both already carry their own
   * `≡` (`strings.chapterMenuOpen`, `strings.recorderMenuOpen`), and a second
   * opener beside them is the worse option on a 320px header that #370 already
   * reports wrapping — so the global entry joins the existing menu rather than
   * arriving with an opener of its own.
   *
   * WHAT THIS DOES NOT COVER, and what the Books cases above still own: the
   * `theme-color`/status-bar metas, persistence across a reload, and the
   * failed-write path. Those are properties of `use-theme.ts`, which is one
   * store for every caller — proving them once is the point of that store.
   * What is new here is only REACHABILITY plus a real repaint at each site.
   */
  test("the chapter ≡ carries the toggle, and it repaints from there", async ({
    page,
  }) => {
    await seedToSegments(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page
      .getByRole("button", {
        name: "More actions for this chapter",
        exact: true,
      })
      .click();
    const menu = page.getByRole("dialog", { name: "Chapter", exact: true });
    await expect(menu).toBeVisible();

    const toLight = menu.getByRole("button", { name: /light screen/i });
    await expect(toLight).toBeVisible();
    await toLight.click();

    // The repaint, not just the attribute: the shipped cascade is what the
    // person in the sun actually gets.
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await resolved(page, await floorOf(page))).toBe(LIGHT_FLOOR);

    // Same affordance as on Books: the menu stays open, so the control is its
    // own undo and a wrong guess costs one more tap in the same spot.
    await expect(menu).toBeVisible();
    await menu.getByRole("button", { name: /dark screen/i }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await resolved(page, await floorOf(page))).toBe(DARK_FLOOR);
  });

  test("the recorder ≡ carries the toggle, and it repaints from inside the sheet", async ({
    page,
  }) => {
    // The case the reframing of #149 turns on: the sheet is where a translator
    // spends the session, and it is `aria-modal` over an `inert` Segments —
    // so a toggle that lives anywhere else is unreachable without leaving the
    // recording behind.
    await seedToRecorder(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // `exact`, because the Segments `≡` behind the sheet ("More actions for
    // this chapter") is still in the DOM and a substring match would find two.
    await page
      .getByRole("button", { name: "More actions", exact: true })
      .click();
    const menu = page.getByRole("dialog", { name: "More", exact: true });
    await expect(menu).toBeVisible();

    const toLight = menu.getByRole("button", { name: /light screen/i });
    await expect(toLight).toBeVisible();

    // The AT consequence this PR asks a reviewer to ACCEPT, pinned rather than
    // left in prose. `Menu` lands open-edge focus on the first ACTIONABLE child,
    // skipping `aria-disabled` hinted rows (#135); on a segment with nothing
    // recorded and an empty clipboard every pre-existing row is hinted, so the
    // toggle is that child. Before this control existed, focus fell back to Edit
    // and its reason.
    //
    // It is asserted BEFORE the click, because clicking moves focus itself and
    // would make this pass for the wrong reason.
    //
    // WHAT THIS DOES AND DOES NOT CATCH. It catches one of the GATES changing:
    // if a pre-existing row becomes actionable in this state, it takes the
    // first actionable position and this fails. It does NOT catch a reorder,
    // and an earlier version of this comment wrongly said it did (George).
    // In this state every other row is hinted, so the toggle is the only
    // actionable child WHEREVER it sits — which also means a reorder does not
    // change what an AT user hears first here, so there is nothing for an
    // order-sensitive assertion to protect. The mount ORDER is held by
    // `tests/theme.test.ts` and by the comments in `recorder-menu.tsx`.
    await expect(toLight).toBeFocused();

    await toLight.click();

    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await resolved(page, await floorOf(page))).toBe(LIGHT_FLOOR);

    await expect(menu).toBeVisible();
    await menu.getByRole("button", { name: /dark screen/i }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await resolved(page, await floorOf(page))).toBe(DARK_FLOOR);
  });
});
