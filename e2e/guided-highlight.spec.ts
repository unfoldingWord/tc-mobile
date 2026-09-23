import { existsSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

/**
 * The guided highlight, actually moving — in a real browser, against the real
 * build (#604).
 *
 * WHY THE NODE SUITE IS NOT ENOUGH. `tests/guided-step.test.ts` proves the
 * decision and `tests/guided-ring.test.ts` proves the class and the stylesheet,
 * but both are blind to the two things that make this feature work or not: that
 * the ring is one mark on screen at a time as a person walks the chain, and
 * that the rule reaches the element at all. The cascade is the failure mode
 * #171 was: a complete, correct block that nothing could select. So this drives
 * the shipped `dist/` build and reads computed styles.
 *
 * The capture cases use a synthetic Chromium microphone and held permission /
 * decode promises. They inspect requesting and processing paint, not an OS
 * permission dialog or a physical microphone. Phone legibility and daylight
 * contrast still require on-device observation.
 */

/**
 * Every element the person can actually SEE a ring on, with the shadow that
 * draws it.
 *
 * The class is not the claim — the paint is. A screen that has gone inert
 * behind a scrim keeps rendering the mark it last painted, and the stylesheet
 * is what takes it away; counting `.is-guided` would have called that two
 * marks on screen.
 */
function rings(page: Page): Promise<{ label: string; shadow: string }[]> {
  return page.locator(".is-guided").evaluateAll((els) =>
    els
      .map((el) => ({
        label:
          el.getAttribute("aria-label") ??
          el.querySelector("button")?.getAttribute("aria-label") ??
          el.textContent?.trim() ??
          "",
        shadow: getComputedStyle(el).boxShadow,
      }))
      .filter((r) => r.shadow !== "none")
  );
}

/** The accessible names of everything visibly ringed, in document order. */
const guided = async (page: Page): Promise<string[]> =>
  (await rings(page)).map((r) => r.label);

/** The one visible ring's shadow — fails loudly if there is not exactly one. */
async function ringOf(page: Page): Promise<string> {
  const found = await rings(page);
  expect(found, "expected exactly one visible guide ring").toHaveLength(1);
  return found[0]!.shadow;
}

test("the ring moves through the chain and marks exactly one control at a time", async ({
  page,
}) => {
  await page.goto("/");

  // Step 1 — an empty shelf. The header + is hidden here, so the invite's own
  // CTA is the only create control on the screen.
  await expect(page.getByRole("button", { name: "New book" })).toBeVisible();
  await expect.poll(() => guided(page)).toEqual(["New book"]);
  // The cascade half: the rule reached the element, in the accent, inside the
  // control's own box.
  expect(await ringOf(page)).toContain("rgb(46, 125, 246)");
  expect(await ringOf(page)).toContain("inset");

  // Step 2 — into the naming dialog, onto its commit control. The field is
  // pre-filled, so Confirm alone is the next required action (#314).
  await page.getByRole("button", { name: "New book" }).click();
  await expect(
    page.getByRole("dialog", { name: "Name your new book" })
  ).toBeVisible();
  await expect.poll(() => guided(page)).toEqual(["Create book"]);

  // Step 3 — the book exists and is empty: its Add chapter. And the two header
  // controls the issue names must NOT be wearing the accent now.
  await page.getByRole("button", { name: "Create book" }).click();
  await expect(
    page.getByRole("button", { name: /^Add chapter to/ })
  ).toBeVisible();
  await expect
    .poll(() => guided(page))
    .toEqual([
      await page
        .getByRole("button", { name: /^Add chapter to/ })
        .getAttribute("aria-label"),
    ]);
  await expect(page.getByRole("button", { name: "New book" })).not.toHaveClass(
    /is-guided/
  );
  await expect(page.getByRole("button", { name: "Open menu" })).not.toHaveClass(
    /is-guided/
  );

  // Step 3b — into the chapter dialog, onto its commit control. The field is
  // pre-filled with "Chapter N" (#609), so Confirm alone is the next required
  // action, and the inert shelf behind it must show no second ring.
  await page.getByRole("button", { name: /^Add chapter to/ }).click();
  await expect(
    page.getByRole("dialog", { name: "Name your new chapter" })
  ).toBeVisible();
  await expect.poll(() => guided(page)).toEqual(["Create chapter"]);

  // Step 4 — a chapter exists: the row that opens it.
  await page
    .getByRole("button", { name: "Create chapter", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Open Chapter 1" })
  ).toBeVisible();
  await expect.poll(() => guided(page)).toEqual(["Open Chapter 1"]);

  // Steps 5 and 6 — an empty chapter: Add segment.
  await page.getByRole("button", { name: "Open Chapter 1" }).click();
  await expect(
    page.getByRole("button", { name: "Back to books" })
  ).toBeVisible();
  await expect.poll(() => guided(page)).toEqual(["Add segment"]);

  // The hop the issue's list skips: a segment exists with nothing recorded into
  // it, and the row's own red Record is the only door to the recorder. Drawn
  // OUTSIDE the red, which is the stylesheet's one exception — keyed on the
  // variant, so it covers this control and the recorder's alike.
  await page.getByRole("button", { name: "Add segment" }).click();
  await expect(
    page.getByRole("button", { name: "Record segment 1" })
  ).toBeVisible();
  await expect.poll(() => guided(page)).toEqual(["Record segment 1"]);
  expect(await ringOf(page)).toContain("rgb(46, 125, 246)");
  expect(await ringOf(page)).not.toContain("inset");

  // Step 7 — the recorder over a segment with no audio: Record.
  await page.getByRole("button", { name: "Record segment 1" }).click();
  await expect(
    page.getByRole("button", { name: "Close recorder" })
  ).toBeVisible();
  await expect.poll(() => guided(page)).toEqual(["Record"]);
  expect(await ringOf(page)).toContain("rgb(46, 125, 246)");
  expect(await ringOf(page)).not.toContain("inset");
});

test("the shelf stops once its book has been worked in, and the mark is on the row instead", async ({
  page,
}) => {
  // The half of the terminal rule reachable without a microphone: a chapter
  // that HOLDS segments is past the shelf's step, so the chapter row that was
  // marked two steps ago is plain again and the only mark left is on the
  // Segments screen. The other half — a segment that HAS a take, where the
  // guide ends outright — needs a recording, so it is pinned from the input
  // in `tests/guided-step.test.ts` (`hasClip`, `hasAudio`) and not here.
  await page.goto("/");
  await page.getByRole("button", { name: "New book" }).click();
  await page.getByRole("button", { name: "Create book" }).click();
  await page.getByRole("button", { name: /^Add chapter to/ }).click();
  await page
    .getByRole("button", { name: "Create chapter", exact: true })
    .click();
  await page.getByRole("button", { name: "Open Chapter 1" }).click();
  await page.getByRole("button", { name: "Add segment" }).click();
  await expect(
    page.getByRole("button", { name: "Record segment 1" })
  ).toBeVisible();

  // A chapter with a segment and no audio in it marks the row's Record, and
  // nothing else — one mark, not a list of them.
  await expect.poll(() => guided(page)).toEqual(["Record segment 1"]);

  // Back on the shelf, nothing is marked — including the row that was guided
  // one step ago. The shelf comes back collapsed (its expanded set is screen
  // state and the screen remounted), so the row is expanded again first:
  // "nothing is guided" must be a row that is on screen and plain, not a row
  // that is absent.
  await page.getByRole("button", { name: "Back to books" }).click();
  await expect(page.getByRole("button", { name: "New book" })).toBeVisible();
  await expect.poll(() => guided(page)).toEqual([]);
  await page
    .getByRole("button", { name: /^Book .*, 1 chapter, collapsed$/ })
    .click();
  await expect(
    page.getByRole("button", { name: "Open Chapter 1" })
  ).toBeVisible();
  await expect.poll(() => guided(page)).toEqual([]);
});

test("a collapsed book is guided OPEN, because the row the chain wants is not rendered", async ({
  page,
}) => {
  // The shelf remounts on the two most ordinary paths there are — Back from
  // Segments, and a reload — and `expanded` is screen state, so the book comes
  // back closed and its chapter rows are not in the DOM at all. Before this
  // branch the accent simply vanished here, mid-chain, on a screen a
  // first-time user has already been walked through once.
  await page.goto("/");
  await page.getByRole("button", { name: "New book" }).click();
  await page.getByRole("button", { name: "Create book" }).click();
  await page.getByRole("button", { name: /^Add chapter to/ }).click();
  await page
    .getByRole("button", { name: "Create chapter", exact: true })
    .click();
  await page.getByRole("button", { name: "Open Chapter 1" }).click();
  await expect(
    page.getByRole("button", { name: "Back to books" })
  ).toBeVisible();

  await page.getByRole("button", { name: "Back to books" }).click();
  const toggle = page.getByRole("button", { name: /, 1 chapter, collapsed$/ });
  await expect(toggle).toBeVisible();
  // The target of the step that WOULD have been next is not on screen.
  await expect(
    page.getByRole("button", { name: "Open Chapter 1" })
  ).toHaveCount(0);
  await expect
    .poll(() => guided(page))
    .toEqual([await toggle.getAttribute("aria-label")]);

  // One tap later the list is open and the accent has moved on to the row.
  await toggle.click();
  await expect(
    page.getByRole("button", { name: "Open Chapter 1" })
  ).toBeVisible();
  await expect.poll(() => guided(page)).toEqual(["Open Chapter 1"]);

  // A reload is the same branch, reached the other way.
  await page.reload();
  await expect(
    page.getByRole("button", { name: /, 1 chapter, collapsed$/ })
  ).toBeVisible();
  await expect
    .poll(() => guided(page))
    .toEqual([
      await page
        .getByRole("button", { name: /, 1 chapter, collapsed$/ })
        .getAttribute("aria-label"),
    ]);
});

// Real capture with a synthetic microphone; only the permission and decode
// promises are held to make the requesting/processing paint inspectable.
test.use({
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
test.describe("disabled recorder guide", () => {
  for (const { theme, leave } of ["dark", "light"].flatMap((theme) =>
    [false, true].map((leave) => ({ theme, leave }))
  )) {
    test(`disabled guide during requesting and ${leave ? "Close" : "Stop"} (${theme})`, async ({
      page,
    }) => {
      await page.addInitScript(() => {
        let releaseMic!: () => void;
        let releaseDecode!: () => void;
        const micGate = new Promise<void>((resolve) => {
          releaseMic = resolve;
        });
        const decodeGate = new Promise<void>((resolve) => {
          releaseDecode = resolve;
        });
        Object.assign(window, {
          releaseGuideMic: releaseMic,
          releaseGuideDecode: releaseDecode,
        });
        const getUserMedia = navigator.mediaDevices.getUserMedia.bind(
          navigator.mediaDevices
        );
        navigator.mediaDevices.getUserMedia = async (constraints) => {
          await micGate;
          return getUserMedia(constraints);
        };
        const decode = AudioContext.prototype.decodeAudioData;
        AudioContext.prototype.decodeAudioData = function (
          bytes,
          success,
          failure
        ) {
          return decode
            .call(this, bytes, success, failure)
            .then(async (buffer) => {
              Object.assign(window, { guideDecodeWaiting: true });
              await decodeGate;
              return buffer;
            });
        };
      });
      await page.goto("/");
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await page.getByRole("button", { name: "New book" }).click();
      await page.getByRole("button", { name: "Create book" }).click();
      await page.getByRole("button", { name: /^Add chapter to/ }).click();
      await page
        .getByRole("button", { name: "Create chapter", exact: true })
        .click();
      await page.getByRole("button", { name: "Open Chapter 1" }).click();
      await page.getByRole("button", { name: "Add segment" }).click();
      await page.getByRole("button", { name: "Record segment 1" }).click();
      const button = page.locator(".record-guide > button");
      const host = page.locator(".record-guide");
      await expect(button).toBeEnabled();
      await button.evaluate((el) => {
        el.dataset.identity = "original";
      });
      await page.keyboard.press("Tab");
      await button.focus();
      await expect(button).toHaveCSS("outline-offset", "8px");
      const before = await button.boundingBox();
      await button.click();

      const expectUndimmedRing = async () => {
        await expect(button).toBeDisabled();
        await expect(host).toHaveClass(/is-guided/);
        await expect(button).toHaveAttribute("data-identity", "original");
        await expect(button).toHaveCSS("opacity", "0.55");
        await expect(button).toHaveCSS("filter", "saturate(0.12)");
        await expect(host).toHaveCSS("opacity", "1");
        await expect(host).toHaveCSS("filter", "none");
        const paint = await host.evaluate((el) => {
          const shadow = getComputedStyle(el).boxShadow;
          const floor = getComputedStyle(
            el.closest(".recorder-sheet")!
          ).backgroundColor;
          const ancestors = [];
          for (
            let parent = el.parentElement;
            parent;
            parent = parent.parentElement
          ) {
            const style = getComputedStyle(parent);
            ancestors.push({ opacity: style.opacity, filter: style.filter });
          }
          return { shadow, floor, ancestors };
        });
        expect(paint.shadow).toContain("rgb(46, 125, 246)");
        expect(
          paint.ancestors.every((s) => s.opacity === "1" && s.filter === "none")
        ).toBe(true);
        const luminance = (rgb: string) => {
          const values = rgb
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map(Number)
            .map((v) => {
              const c = v / 255;
              return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
            });
          return (
            values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722
          );
        };
        const a = luminance(paint.shadow);
        const b = luminance(paint.floor);
        expect(
          (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
        ).toBeGreaterThanOrEqual(3);
        expect(await button.boundingBox()).toEqual(before);
        expect(await host.boundingBox()).toEqual(before);
        expect(await rings(page)).toHaveLength(1);
      };
      await expectUndimmedRing();
      await page.evaluate("window.releaseGuideMic()");
      await expect(
        page.getByRole("button", { name: "Stop recording", exact: true })
      ).toBeVisible();
      await page.waitForTimeout(500);
      await page
        .getByRole("button", {
          name: leave ? "Close recorder" : "Stop recording",
          exact: true,
        })
        .click();
      await page.waitForFunction("window.guideDecodeWaiting === true");
      if (leave) {
        await expect(host).not.toHaveClass(/is-guided/);
        await expect.poll(() => guided(page)).toEqual([]);
      } else {
        await expectUndimmedRing();
      }
      await page.evaluate("window.releaseGuideDecode()");
      if (leave) {
        await expect(page.locator(".recorder-sheet")).toHaveCount(0);
      } else {
        await expect(button).toBeEnabled();
        await expect(host).not.toHaveClass(/is-guided/);
        await expect(button).toHaveAttribute("data-identity", "original");
      }
    });
  }
});
