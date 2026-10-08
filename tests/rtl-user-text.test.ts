import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { NameEdit } from "@/components/name-edit";
import { O4BookDeleteAsk } from "@/components/o4-book-delete-ask";
import { O4BookHead } from "@/components/o4-book-menu";
import { O4Crumbs, O4SheetHead } from "@/components/o4-crumbs";
import { SegmentRow } from "@/components/segment-row";
import { SegmentsHead } from "@/components/segments-head";
import type { ClipId, SegmentId } from "@/types/domain";
import type { SegmentRow as Row } from "@/types/view";

import { one, render } from "./render";
import { cssRule, declarationValue, stripCssComments } from "./support";

/**
 * #1267: a name the facilitator typed sets its own direction from its content.
 * Every element that shows one carries `dir="auto"`, and the inputs that edit
 * them do too; the rest of the UI keeps the app locale's direction, so an
 * element that shows a UI string or a bare number carries no `dir`.
 *
 * This file renders the pieces that can be rendered alone. The three screens
 * (Books, the chapter screen, the recorder) are asserted where they are
 * already mounted: `tests/books-o4.test.ts`, `tests/o4-header-crumbs.test.ts`
 * and `tests/o4-menus-chapter-segment.test.ts`.
 *
 * What it does not cover: bidi layout. jsdom computes no boxes and no bidi
 * resolution, so that `auto` resolves an Arabic or Hebrew name to rtl, puts
 * its trailing period after the last word and elides it at its logical end is
 * the browser's rule, measured for the crumbs in
 * `e2e/header-crumbs-fit.spec.ts` and on no phone.
 */

// Right-to-left names, each ending in the period the tester's report is about.
const HEBREW = "שלום עולם.";
const ARABIC = "مرقس.";

const row: Row = {
  segmentId: "segment-3" as SegmentId,
  ordinal: 3,
  label: null,
  hasClip: true,
  finished: false,
  clipId: "clip-3" as ClipId,
  peaks: null,
  durationMs: 1000,
};

function renderRow(over: Partial<Row>) {
  return render(
    createElement(SegmentRow, {
      row: { ...row, ...over },
      playing: false,
      playbackElapsedMs: 0,
      onPlay: () => {},
      onOpenRecorder: () => {},
      onSetFinished: () => {},
      onErase: () => {},
      onDeleteSegment: () => {},
      onRename: () => Promise.resolve(true),
    })
  );
}

describe("the O4 crumbs (#1267)", () => {
  it("sets each name chip's own direction, and leaves the segment number's alone", () => {
    const root = render(
      createElement(O4Crumbs, {
        book: HEBREW,
        chapter: ARABIC,
        segment: { ordinal: 2, state: "empty" },
      })
    );
    const spans = [...root.querySelectorAll(".o4-crumb > span")];
    expect(spans.map((el) => el.textContent)).toEqual([HEBREW, ARABIC, "2"]);
    expect(spans.map((el) => el.getAttribute("dir"))).toEqual([
      "auto",
      "auto",
      null,
    ]);
  });

  it("puts the direction on the text span the ellipsis is drawn on, not on the clipped chip", () => {
    const root = render(createElement(O4Crumbs, { book: HEBREW }));
    // `o4/menus.css` sets text-overflow on `.o4-crumb > span`; that element's
    // own direction is what picks the end the "…" lands on.
    const chip = one(root, ".o4-crumb");
    expect(chip.hasAttribute("dir")).toBe(false);
    expect(one(chip, "span").getAttribute("dir")).toBe("auto");
    const rule = cssRule(
      stripCssComments(
        readFileSync(
          path.resolve(import.meta.dirname, "../src/app/styles/o4/menus.css"),
          "utf8"
        )
      ),
      ":root .o4-crumb > span"
    );
    expect(declarationValue(rule, "text-overflow")).toBe("ellipsis");
  });

  it("sets the spoken place line's direction and the sheet head's chips", () => {
    const root = render(
      createElement(O4SheetHead, { book: HEBREW, chapter: ARABIC })
    );
    expect(one(root, ".o4-sheet-place").getAttribute("dir")).toBe("auto");
    expect(
      [...root.querySelectorAll(".o4-sheet-head .o4-crumb > span")].map((el) =>
        el.getAttribute("dir")
      )
    ).toEqual(["auto", "auto"]);
  });
});

describe("book sheet heads (#1267)", () => {
  it("the book menu's head name", () => {
    const root = render(
      createElement(O4BookHead, { name: HEBREW, coverHex: "#11796d" })
    );
    expect(one(root, ".books-sheet-name").getAttribute("dir")).toBe("auto");
  });

  it("the delete ask's book name, and not its UI strings", () => {
    const root = render(
      createElement(O4BookDeleteAsk, {
        name: ARABIC,
        coverHex: "#11796d",
        busy: false,
        keepRef: { current: null },
        onKeep: () => {},
        onDelete: () => {},
      })
    );
    expect(one(root, ".books-sheet-name").getAttribute("dir")).toBe("auto");
    // Every other piece of text in the ask is a UI string: none sets a direction.
    const others = [...root.querySelectorAll("[dir]")].filter(
      (el) => !el.classList.contains("books-sheet-name")
    );
    expect(others).toHaveLength(0);
  });
});

describe("the chapter head (#1267)", () => {
  it("sets the typed chapter title's direction", () => {
    const root = render(
      createElement(SegmentsHead, { chapterName: HEBREW, rows: [] })
    );
    expect(one(root, ".segments-title").getAttribute("dir")).toBe("auto");
  });
});

describe("the segment row (#1267)", () => {
  it("sets the typed title's direction", () => {
    const root = renderRow({ label: HEBREW });
    expect(one(root, ".row-title").getAttribute("dir")).toBe("auto");
  });

  it("leaves the badge's bare ordinal alone, labelled or not", () => {
    for (const over of [{ label: ARABIC }, {}]) {
      const badge = one(renderRow(over), ".row-badge");
      expect(badge.textContent).toBe("3");
      expect(badge.hasAttribute("dir")).toBe(false);
    }
  });
});

describe("the name field (#1267)", () => {
  it("sets the input's direction from what is typed", () => {
    const root = render(
      createElement(NameEdit, {
        initialValue: HEBREW,
        fieldLabel: "Book name",
        onSave: () => {},
        onCancel: () => {},
      })
    );
    const input = one(root, "input");
    expect(input.getAttribute("dir")).toBe("auto");
    // The form around it and the commit control are UI: no direction.
    expect(one(root, "form").hasAttribute("dir")).toBe(false);
    expect(root.querySelectorAll("[dir]")).toHaveLength(1);
  });
});

describe("alignment follows the direction (#1267)", () => {
  it("a dir=auto element aligns to its own start, not to the physical left its button sets", () => {
    const css = stripCssComments(
      readFileSync(
        path.resolve(import.meta.dirname, "../src/app/styles/3-components.css"),
        "utf8"
      )
    );
    const rule = cssRule(css, '[dir="auto"]');
    expect(declarationValue(rule, "text-align")).toBe("start");
  });
});
