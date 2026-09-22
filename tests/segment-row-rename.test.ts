import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SegmentRow } from "@/components/segment-row";
import { strings } from "@/components/strings";
import type { SegmentRow as Row } from "@/types/view";
import type { SegmentId, ClipId } from "@/types/domain";

/**
 * Rename in the segment row's menu (#591): the label rides beside the ordinal,
 * and the menu reaches it on EVERY row — an empty one included, because the
 * facilitator labels segments while setting a chapter up, before anything is
 * recorded (#264's Nairobi workflow). The audio items stay recorded-row only.
 *
 * Scope: the row alone, with `onRename` standing in for the screen. The store's
 * normalisation (trim, blank ⇒ null) is `tests/storage.test.ts`'s; typing into
 * the field, and the screen wiring `onRename` to the hook, are
 * `e2e/segment-rename.spec.ts`'s.
 */

let dom: JSDOM;
let root: Root;
const recorded: Row = {
  segmentId: "segment" as SegmentId,
  ordinal: 3,
  label: null,
  hasClip: true,
  finished: false,
  clipId: "clip" as ClipId,
  peaks: null,
  durationMs: 1000,
};
const empty: Row = {
  ...recorded,
  hasClip: false,
  clipId: null,
  durationMs: null,
};

beforeEach(() => {
  dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>"
  );
  // Canvas pixels are outside this menu behaviour.
  vi.spyOn(
    dom.window.HTMLCanvasElement.prototype,
    "getContext"
  ).mockReturnValue(null);
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(dom.window.document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  vi.unstubAllGlobals();
});

async function render(
  row: Row,
  onRename: (label: string) => Promise<boolean> = () => Promise.resolve(true)
) {
  await act(async () => {
    root.render(
      createElement(SegmentRow, {
        row,
        playing: false,
        playbackElapsedMs: 0,
        onPlay: vi.fn(),
        onOpenRecorder: vi.fn(),
        onSetFinished: vi.fn(),
        onErase: vi.fn(),
        onRename,
      })
    );
  });
}
function button(label: string) {
  return [...document.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === label
  );
}
async function click(label: string) {
  const b = button(label);
  expect(b, label).toBeDefined();
  await act(async () => b!.click());
}
function field() {
  return document.querySelector<HTMLInputElement>(
    `input[aria-label="${strings.segmentNameField}"]`
  );
}
const dialog = () => document.querySelector('[role="dialog"]');
const heading = () => document.querySelector(".row-open")?.textContent;

describe("segment row rename (#591)", () => {
  it("shows the ordinal alone while unlabelled, and the label after it once set", async () => {
    await render(recorded);
    expect(heading()).toBe("3");
    await render({ ...recorded, label: "verses 3–4" });
    expect(heading()).toBe("3 · verses 3–4");
  });

  it("carries the label into the row's accessible names, so AT hears what is painted", async () => {
    // WCAG 2.5.3: the open button's aria-label replaces its visible text, so a
    // label missing from it is a label a screen reader never reads.
    const labelled = { ...recorded, label: "verses 3–4" };
    await render({ ...empty, label: "verses 3–4" });
    expect(button("Open segment 3 · verses 3–4")).toBeDefined();
    await render(labelled);
    expect(button("Edit segment 3 · verses 3–4")).toBeDefined();
    await click(strings.segmentMenu(3));
    // The menu's Edit item names the same segment the same way.
    expect(
      [...document.querySelectorAll('[role="dialog"] button')].some(
        (b) => b.getAttribute("aria-label") === "Edit segment 3 · verses 3–4"
      )
    ).toBe(true);
    await click(strings.menuClose);
    await render({ ...labelled, finished: true });
    expect(button("Edit segment 3 · verses 3–4, finished")).toBeDefined();
  });

  it("leaves an unlabelled row's accessible names exactly as they were", async () => {
    await render(empty);
    expect(button("Open segment 3")).toBeDefined();
    await render(recorded);
    expect(button("Edit segment 3")).toBeDefined();
    await render({ ...recorded, finished: true });
    expect(button("Edit segment 3, finished")).toBeDefined();
  });

  it("offers Rename on an empty row, with none of the audio items", async () => {
    await render(empty);
    await click(strings.segmentMenu(3));
    expect(button(strings.renameSegment)).toBeDefined();
    expect(button(strings.editSegment(3, null))).toBeUndefined();
    expect(button(strings.markFinished(3))).toBeUndefined();
    expect(button(strings.eraseSegment)).toBeUndefined();
  });

  it("offers Rename beside Edit, Finished and Erase on a recorded row", async () => {
    await render(recorded);
    await click(strings.segmentMenu(3));
    for (const label of [
      strings.editSegment(3, null),
      strings.markFinished(3),
      strings.renameSegment,
      strings.eraseSegment,
    ]) {
      expect(button(label), label).toBeDefined();
    }
  });

  it("commits the field's text and closes the menu once it lands", async () => {
    const onRename = vi.fn(() => Promise.resolve(true));
    await render({ ...recorded, label: "verse 3" }, onRename);
    await click(strings.segmentMenu(3));
    await click(strings.renameSegment);
    // Seeded with the current label, so a correction is an edit, not a retype.
    // Typing into it is the Playwright spec's to drive, in a real browser.
    expect(field()?.value).toBe("verse 3");
    await click(strings.saveName);
    expect(onRename).toHaveBeenCalledWith("verse 3");
    expect(dialog()).toBeNull();
  });

  it("seeds an unlabelled segment's field empty, not with its ordinal", async () => {
    await render(empty);
    await click(strings.segmentMenu(3));
    await click(strings.renameSegment);
    expect(field()?.value).toBe("");
  });

  it("keeps the field up with a plain failure line when the write does not land", async () => {
    await render({ ...recorded, label: "verse 3" }, () =>
      Promise.resolve(false)
    );
    await click(strings.segmentMenu(3));
    await click(strings.renameSegment);
    const before = field();
    await click(strings.saveName);
    expect(dialog()).not.toBeNull();
    // The SAME field, not a fresh one: what the translator had in it is still
    // there to correct and resend.
    expect(field()).toBe(before);
    expect(field()?.value).toBe("verse 3");
    expect(dialog()?.textContent).toContain(strings.renameSegmentFailed);
  });

  it("treats a rename that rejects as not landed, never as still saving", async () => {
    await render({ ...recorded, label: "verse 3" }, () =>
      Promise.reject(new Error("boom"))
    );
    await click(strings.segmentMenu(3));
    await click(strings.renameSegment);
    await click(strings.saveName);
    // Confirm is back to its idle name, not stuck on "Saving…".
    expect(button(strings.saveName)).toBeDefined();
    expect(button(strings.savingName)).toBeUndefined();
    expect(dialog()?.textContent).toContain(strings.renameSegmentFailed);
  });

  it("does not let a rename that settles late close a menu opened after it", async () => {
    let settle: (ok: boolean) => void = () => {};
    const onRename = vi.fn(
      () => new Promise<boolean>((resolve) => (settle = resolve))
    );
    await render(recorded, onRename);
    await click(strings.segmentMenu(3));
    await click(strings.renameSegment);
    await click(strings.saveName);
    await click(strings.menuClose);
    await click(strings.segmentMenu(3));
    await act(async () => settle(true));
    expect(dialog()).not.toBeNull();
    // And the reopened menu is the action list, not a stale busy field.
    expect(button(strings.renameSegment)).toBeDefined();
  });
});
