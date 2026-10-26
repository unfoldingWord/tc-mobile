import { existsSync } from "node:fs";

import { expect, test, type ElementHandle, type Page } from "@playwright/test";

import { editRecordingButton } from "./recorder-fixtures";
import { seedToRecorder, seedToSegments } from "./support/seed";

/**
 * A locale-fit sweep at a small phone (#1458, the per-language 360 px pass),
 * against the shipped `dist/` build: for the screens a translator meets first
 * (the Books shelf with a book, the book's ⋮ menu, the Segments screen, the
 * recorder's controls, Settings, the Templates picker, the licence ask at Share
 * Book and the Export project language ask), in English and every language
 * whose table is complete (`tests/locale-fit-sweep-list.test.ts` fails when
 * `LOCALES` and the complete languages differ), no control's label spills out of its own box, no control is
 * cut off at the screen edge, and the page does not scroll sideways.
 *
 * jsdom computes no boxes, so only a browser can measure this. It is a layout
 * check in headless Chromium at 360x740. It is not a device run, it does not
 * judge whether any wording is right, and it does not cover the scripts a
 * phone may lack a font for (that is the device pass).
 *
 * The language is switched the way a phone does it, by changing
 * `navigator.languages` and firing `languagechange` while idle
 * (`hooks/phone-locale.ts`), after the walk that seeds the book has used the
 * English labels, the same way `mic-refusal-card-fit.spec.ts` does. The
 * control that opens a screen is held as a handle before the switch so the
 * click does not depend on a translated name.
 *
 * What counts as a fit failure, for every visible control in the screen (or
 * the top dialog) and for every element inside one:
 *   - its content is wider or taller than its box (`scrollWidth` or
 *     `scrollHeight` over the client size) when it clips or ellipsises it,
 *   - or the box itself leaves the viewport sideways.
 * And for the page: `scrollWidth` over the viewport width.
 *
 * Every case is a plain test that must find nothing. A broken walk turns it
 * red too, because `measure()` throws when the screen it was asked to measure
 * is not there.
 */
test.use({
  viewport: { width: 360, height: 740 },
  // The two asks sit behind a book with a recorded segment, so the walk records
  // one from Chromium's synthetic microphone (as export-language-ask.spec.ts).
  permissions: ["microphone"],
  launchOptions: {
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_PATH ??
      (existsSync("/opt/pw-browsers/chromium")
        ? "/opt/pw-browsers/chromium"
        : undefined),
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});

const LOCALES = [
  "en",
  "es",
  "fr",
  "hi",
  "id",
  "pt",
  "ru",
  "sw",
  "zh-Hans",
] as const;

const SCREENS = [
  "books",
  "book-menu",
  "segments",
  "recorder",
  "settings",
  "templates",
  "licence-ask",
  "language-ask",
] as const;
type Screen = (typeof SCREENS)[number];

/**
 * The nodes that show a name the translator typed. The design cuts these with
 * an ellipsis on purpose; they are data, not translated labels. Every selector
 * here sets `text-overflow: ellipsis` in `src/app/styles/o4/`.
 */
const NAME_NODES = [
  ".segments-title",
  ".row-title",
  ".menu-panel:has(.name-edit) .t-title",
  ".o4-crumb > span",
  ".books-name",
  ".books-chapter-title",
].join(", ");

async function switchLanguage(page: Page, tag: string) {
  await page.evaluate((t) => {
    Object.defineProperty(navigator, "languages", {
      configurable: true,
      get: () => [t],
    });
  }, tag);
  // The follower subscribes in an effect, so an event fired a moment too early
  // is missed; fire again until the root element carries the language.
  await expect
    .poll(
      async () => {
        await page.evaluate(() =>
          window.dispatchEvent(new Event("languagechange"))
        );
        return page.locator("html").getAttribute("lang");
      },
      { timeout: 10_000 }
    )
    .toBe(tag);
}

export type Finding = { what: string; detail: string };

/**
 * Measure the page and the controls of one screen. `rootSelector` limits the
 * controls to a dialog; when absent the whole document is walked.
 */
async function measure(
  page: Page,
  rootSelector: string | null
): Promise<Finding[]> {
  if (rootSelector !== null) {
    await expect(
      page.locator(rootSelector).first(),
      `${rootSelector} is not on the screen to measure`
    ).toBeVisible();
  }
  // The launch overlay covers the app for its first moments.
  await page.locator("#launch-intro").waitFor({ state: "hidden" });
  return page.evaluate(
    ({ rootSelector, nameNodes }) => {
      const viewportWidth = window.innerWidth;
      const out: { what: string; detail: string }[] = [];
      const doc = document.documentElement;
      if (doc.scrollWidth > viewportWidth) {
        out.push({
          what: "page scrolls sideways",
          detail: `scrollWidth ${doc.scrollWidth} > ${viewportWidth}`,
        });
      }
      const root: ParentNode = rootSelector
        ? (document.querySelector(rootSelector) as ParentNode)
        : document;
      if (root === null) throw new Error(`${rootSelector} is missing`);
      const controls = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button, a[href], [role="button"], [role="switch"], [role="tab"], [role="menuitem"], [role="radio"], label, summary, input, select, textarea'
        )
      );
      const seen = new Set<Element>();
      const visible = (el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        if (r.width <= 1 || r.height <= 1) return false;
        const s = getComputedStyle(el);
        return s.visibility !== "hidden" && s.display !== "none";
      };
      const name = (el: HTMLElement) =>
        (el.getAttribute("aria-label") || el.textContent || el.tagName)
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, 40);
      for (const control of controls) {
        if (!visible(control)) continue;
        const members = [
          control,
          ...Array.from(control.querySelectorAll<HTMLElement>("*")),
        ];
        for (const el of members) {
          if (seen.has(el) || !visible(el)) continue;
          seen.add(el);
          if (el instanceof SVGElement) continue;
          const label = `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} "${name(el)}"`;
          // A typed name is cut with an ellipsis by design; only those nodes
          // are exempt, so a translated label cut the same way is a finding.
          if (el.matches(nameNodes)) continue;
          // A tile's caption is deliberately wider than its 64 or 76 px
          // tile and centred under it; its fit is the caption-collision check
          // below, not this one.
          const inTile = el.closest(".o4-tile") !== null;
          if (
            !inTile &&
            el.scrollWidth > el.clientWidth + 1 &&
            el.clientWidth > 0
          ) {
            const o = getComputedStyle(el).overflowX;
            if (o !== "visible" || el === control) {
              out.push({
                what: "label wider than its box",
                detail: `${label}: ${el.scrollWidth} > ${el.clientWidth}`,
              });
            }
          }
          if (el.scrollHeight > el.clientHeight + 1 && el.clientHeight > 0) {
            const o = getComputedStyle(el).overflowY;
            if (o !== "visible") {
              out.push({
                what: "label taller than its box",
                detail: `${label}: ${el.scrollHeight} > ${el.clientHeight}`,
              });
            }
          }
        }
        const r = control.getBoundingClientRect();
        if (r.left < -0.5 || r.right > viewportWidth + 0.5) {
          out.push({
            what: "control leaves the screen sideways",
            detail: `"${name(control)}": ${Math.round(r.left)}..${Math.round(r.right)}`,
          });
        }
      }
      // Tile captions: each is drawn as wide as its words, so two long ones
      // can run into each other or off the screen. Measure the words (a
      // Range), not the caption's grid cell.
      const words = Array.from(
        root.querySelectorAll<HTMLElement>(".o4-tile > .control-caption")
      )
        .filter(visible)
        .map((el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          return {
            text: (el.textContent ?? "").trim(),
            r: range.getBoundingClientRect(),
          };
        });
      for (const w of words) {
        if (w.r.left < -0.5 || w.r.right > viewportWidth + 0.5) {
          out.push({
            what: "tile caption leaves the screen sideways",
            detail: `"${w.text}": ${Math.round(w.r.left)}..${Math.round(w.r.right)}`,
          });
        }
      }
      for (let i = 0; i < words.length; i++) {
        for (let j = i + 1; j < words.length; j++) {
          const a = words[i]!.r;
          const b = words[j]!.r;
          const sameRow = Math.abs(a.top - b.top) < a.height;
          if (sameRow && a.left < b.right - 0.5 && b.left < a.right - 0.5) {
            out.push({
              what: "tile captions run into each other",
              detail: `"${words[i]!.text}" and "${words[j]!.text}"`,
            });
          }
        }
      }
      return out;
    },
    { rootSelector, nameNodes: NAME_NODES }
  );
}

async function settled(page: Page, selector: string) {
  await page.locator(selector).first().waitFor({ state: "visible" });
  // The sheet's slide-in, so boxes are measured where they come to rest.
  await page.evaluate((s) => {
    const el = document.querySelector(s);
    return Promise.all(
      (el?.getAnimations({ subtree: true }) ?? [])
        // An infinite animation never finishes; only a bounded one comes to
        // rest. A cancelled one rejects `finished`, which is also "done".
        .filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime))
        .map((a) => a.finished.catch(() => undefined))
    ).then(() => undefined);
  }, selector);
}

async function handle(
  page: Page,
  role: "button",
  name: string | RegExp,
  exact?: boolean
): Promise<ElementHandle> {
  const h = await page.getByRole(role, { name, exact }).first().elementHandle();
  expect(h, `no ${String(name)} to hold before the switch`).not.toBeNull();
  return h!;
}

/** One chapter with one recorded segment, from the synthetic microphone. */
async function recordOneSegment(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "New book" }).click();
  await page.getByRole("button", { name: "Create book" }).click();
  await page.getByRole("button", { name: /^Add chapter to/ }).click();
  await page.getByRole("button", { name: "Create chapter" }).click();
  await page.getByRole("button", { name: "Open Chapter 1" }).click();
  await page.getByRole("button", { name: "Add segment" }).click();
  await page
    .getByRole("button", { name: "Open recorder for segment 1" })
    .click();
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Stop recording", exact: true })
  ).toBeVisible();
  await page.waitForTimeout(1200);
  await page
    .getByRole("button", { name: "Stop recording", exact: true })
    .click();
  await expect(editRecordingButton(page)).not.toHaveAttribute(
    "aria-busy",
    "true"
  );
  // Back on the shelf (a reload: the book is in IndexedDB).
  await page.goto("/");
  await expect(page.locator("#launch-intro")).toBeHidden({ timeout: 10_000 });
}

/**
 * Open the book's menu in English, hold the control that starts an ask,
 * switch the language with the menu open, then take that control.
 */
async function openAsk(page: Page, tag: string, name: string) {
  await recordOneSegment(page);
  await page.getByRole("button", { name: /^More actions for/ }).click();
  await settled(page, '[role="dialog"]');
  const start = await handle(page, "button", name, true);
  await switchLanguage(page, tag);
  await start.click();
}

/** Walk to `screen` in English, switch to `tag`, and return what overflows. */
export async function sweep(
  page: Page,
  tag: string,
  screen: Screen
): Promise<Finding[]> {
  switch (screen) {
    case "books": {
      await seedToSegments(page);
      const back = await handle(page, "button", "Back to books", true);
      await back.click();
      await expect(
        page.getByRole("button", { name: "New book" })
      ).toBeVisible();
      await switchLanguage(page, tag);
      return measure(page, null);
    }
    case "book-menu": {
      await seedToSegments(page);
      await page
        .getByRole("button", { name: "Back to books", exact: true })
        .click();
      const more = await handle(page, "button", /^More actions for/);
      await switchLanguage(page, tag);
      await more.click();
      await settled(page, '[role="dialog"]');
      return measure(page, '[role="dialog"]');
    }
    case "segments": {
      await seedToSegments(page);
      await switchLanguage(page, tag);
      return measure(page, null);
    }
    case "recorder": {
      await seedToRecorder(page);
      await switchLanguage(page, tag);
      return measure(page, null);
    }
    case "settings": {
      await page.goto("/");
      const gear = await handle(page, "button", "Settings", true);
      await switchLanguage(page, tag);
      await gear.click();
      await settled(page, '[role="dialog"]');
      return measure(page, '[role="dialog"]');
    }
    case "templates": {
      await page.goto("/");
      await expect(page.locator("#launch-intro")).toBeHidden({
        timeout: 10_000,
      });
      await page.getByRole("button", { name: /^Open menu/ }).click();
      await settled(page, '[role="dialog"]');
      const tile = await handle(page, "button", "Templates", true);
      await switchLanguage(page, tag);
      await tile.click();
      // The picker lists the bundled package and its thumbnail.
      await expect(page.locator('[role="dialog"] img').first()).toBeVisible();
      await settled(page, '[role="dialog"]');
      return measure(page, '[role="dialog"]');
    }
    case "licence-ask": {
      // A new book has no licence, so Share book asks first (#1455).
      await openAsk(page, tag, "Share book");
      await expect(page.locator('[role="radiogroup"]')).toBeVisible();
      await settled(page, '[role="dialog"]');
      return measure(page, '[role="dialog"]');
    }
    case "language-ask": {
      // A book with no language asks first on Export project (#1492).
      await openAsk(page, tag, "Export project");
      await expect(page.locator('input[type="search"]')).toBeVisible();
      await expect(
        page.getByRole("button", { name: /[,，]\s?apq$/ }).first()
      ).toBeVisible();
      await settled(page, '[role="dialog"]');
      return measure(page, '[role="dialog"]');
    }
  }
}

const byDetail = (x: Finding, y: Finding) =>
  `${x.what}|${x.detail}`.localeCompare(`${y.what}|${y.detail}`);

for (const tag of LOCALES) {
  for (const screen of SCREENS) {
    test(`${tag} ${screen}: no findings at 360px (#1458)`, async ({ page }) => {
      const findings = await sweep(page, tag, screen);
      if (process.env.LOCALE_FIT_SHOT) {
        await page.screenshot({
          path: `${process.env.LOCALE_FIT_SHOT}/${tag}-${screen}.png`,
        });
      }
      expect(
        [...findings].sort(byDetail),
        `${tag} ${screen}:\n${findings.map((f) => `${f.what}: ${f.detail}`).join("\n")}`
      ).toEqual([]);
    });
  }
}

/**
 * The sweep has to be able to die. Three guards (a 300 px viewport case is not
 * one: no guard here changes the viewport, so none needs it): a label that cannot fit its box
 * must be a finding, and so must a translated label saved only by an
 * ellipsis; if either returned nothing the sweep above would measure nothing.
 * A typed name cut by an ellipsis must stay exempt.
 */
test("the sweep reports a control that cannot fit (mutation guard)", async ({
  page,
}) => {
  await seedToSegments(page);
  await page
    .getByRole("button", { name: "Back to books", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "New book" })).toBeVisible();
  await page.addStyleTag({
    content:
      "main button { white-space: nowrap !important; overflow: hidden !important; } button { padding-inline: 90px !important; }",
  });
  const findings = await measure(page, null);
  expect(findings.map((f) => f.what)).toContain("label wider than its box");
});

test("the sweep reports tile captions that run into each other (mutation guard)", async ({
  page,
}) => {
  await seedToSegments(page);
  await page
    .getByRole("button", { name: "Back to books", exact: true })
    .click();
  await page
    .getByRole("button", { name: /^More actions for/ })
    .first()
    .click();
  await settled(page, '[role="dialog"]');
  // Undo the wrap and make the captions long enough to meet.
  await page.addStyleTag({
    content:
      ".o4-tile > .control-caption { white-space: nowrap !important; max-width: none !important; hyphens: none !important; overflow-wrap: normal !important; font-size: 22px !important; }",
  });
  const findings = await measure(page, '[role="dialog"]');
  expect(findings.map((f) => f.what)).toContain(
    "tile captions run into each other"
  );
});

test("the sweep still reports a translated label cut with an ellipsis, and exempts a typed name (mutation guard)", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(dialog).toBeVisible();
  await settled(page, '[role="dialog"]');
  const label = dialog.getByRole("button", { name: /light screen/i }).first();
  await expect(label).toBeVisible();
  await label.evaluate((el) => {
    const css = document.createElement("style");
    css.textContent =
      '[role="dialog"] button { width: 60px !important; white-space: nowrap !important; overflow: hidden !important; text-overflow: ellipsis !important; }';
    document.head.append(css);
    el.setAttribute("data-mutated", "1");
  });
  const findings = await measure(page, '[role="dialog"]');
  expect(findings.map((f) => f.what)).toContain("label wider than its box");
});
