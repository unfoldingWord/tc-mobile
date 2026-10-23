import { expect, test, type ElementHandle, type Page } from "@playwright/test";

import { seedToRecorder, seedToSegments } from "./support/seed";

/**
 * A locale-fit sweep at a small phone (#1458, the per-language 360 px pass),
 * against the shipped `dist/` build: for the screens a translator meets first
 * (the Books shelf with a book, the book's ⋮ menu, the Segments screen, the
 * recorder's controls and Settings), in English and every language whose table
 * is complete, no control's label spills out of its own box, no control is
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
 * A locale that really overflows today is a `test.fail` entry in `KNOWN`, with
 * the overflow named, so the sweep stays green and goes red the day it is
 * fixed.
 */
test.use({ viewport: { width: 360, height: 740 } });

const LOCALES = ["en", "es", "fr", "hi", "id", "pt", "ru", "sw"] as const;
type Tag = (typeof LOCALES)[number];

const SCREENS = [
  "books",
  "book-menu",
  "segments",
  "recorder",
  "settings",
] as const;
type Screen = (typeof SCREENS)[number];

/** Locale/screen pairs that overflow today. Empty means every pair fits. */
const KNOWN: Partial<Record<`${Tag}/${Screen}`, string>> = {
  "es/book-menu": '"Color de la portada" runs into "Eliminar"',
  "fr/book-menu": '"Couleur de la couverture" runs into "Supprimer"',
  "pt/book-menu": '"Compartilhar" runs into "Exportar"',
  "ru/book-menu": '"Поделиться" runs into "Экспорт"',
};

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
  // The launch overlay covers the app for its first moments.
  await page.locator("#launch-intro").waitFor({ state: "hidden" });
  return page.evaluate(
    ({ rootSelector }) => {
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
        ? (document.querySelector(rootSelector) ?? document)
        : document;
      const controls = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button, a[href], [role="button"], [role="switch"], [role="tab"], [role="menuitem"], label, summary, input, select, textarea'
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
          // A name is cut with an ellipsis by design (crumbs, book, chapter
          // and segment names); that is data, not a translated label.
          if (getComputedStyle(el).textOverflow === "ellipsis") continue;
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
    { rootSelector }
  );
}

async function settled(page: Page, selector: string) {
  await page.locator(selector).first().waitFor({ state: "visible" });
  // The sheet's slide-in, so boxes are measured where they come to rest.
  await page.evaluate((s) => {
    const el = document.querySelector(s);
    return Promise.all(
      (el?.getAnimations({ subtree: true }) ?? []).map((a) => a.finished)
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
  }
}

for (const tag of LOCALES) {
  for (const screen of SCREENS) {
    const known = KNOWN[`${tag}/${screen}`];
    const run = known ? test.fail : test;
    run(
      `${tag} ${screen}: nothing overflows at 360px (#1458)${known ? ` [overflows today: ${known}]` : ""}`,
      async ({ page }) => {
        const findings = await sweep(page, tag, screen);
        if (process.env.LOCALE_FIT_SHOT) {
          await page.screenshot({
            path: `${process.env.LOCALE_FIT_SHOT}/${tag}-${screen}.png`,
          });
        }
        expect(
          findings,
          `${tag} ${screen}:\n${findings.map((f) => `${f.what}: ${f.detail}`).join("\n")}`
        ).toEqual([]);
      }
    );
  }
}

/**
 * The sweep has to be able to die. A viewport narrower than the controls need
 * must produce findings, and a label longer than its box must too; if either
 * returned nothing, the whole sweep above would be a green that measures
 * nothing.
 */
test("the sweep reports a control that cannot fit (mutation guard)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await seedToSegments(page);
  await page
    .getByRole("button", { name: "Back to books", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "New book" })).toBeVisible();
  await page.addStyleTag({
    content:
      ".books-shelf button, main button { white-space: nowrap !important; overflow: hidden !important; } button { padding-inline: 90px !important; }",
  });
  const findings = await measure(page, null);
  expect(findings.length).toBeGreaterThan(0);
});
