import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { Control } from "@/components/control";
import { EmptyState } from "@/components/empty-state";
import { NameEdit } from "@/components/name-edit";
import { SegmentRow } from "@/components/segment-row";
import type { SegmentRow as SegmentRowModel } from "@/types/view";

import { one, render } from "./render";

/**
 * The guide's ONE visual, and the wiring that carries it (#604).
 *
 * The decision — which control is the next required action — is
 * `tests/guided-step.test.ts`. This is the other half: that the answer is
 * painted in a single accent reached through a layer-2 role, and that every
 * member of the chain actually arrives at a control. A resolver nothing reads
 * is a comment; a ring drawn from a colour primitive is a theme that cannot
 * switch (AGENTS.md's styling boundary).
 *
 * The stylesheet half reads source text; the wiring half renders each carrier
 * once through `tests/render.ts` and reads the class it emits. Neither is the
 * cascade or the real build — that is the Playwright suite's job
 * (`e2e/theme-toggle.spec.ts` is the precedent) — and nothing here claims the
 * ring has been SEEN.
 */
const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const semantic = read("src/app/styles/2-semantic.css");
const components = read("src/app/styles/3-components.css");
const globals = read("src/app/globals.css");

/** The declaration block that follows `selector`, by its first `{`…`}` pair. */
function ruleBlock(css: string, selector: string): string {
  // Anchored on the selector at the start of a line so a selector NAMED in a
  // comment cannot capture the slice — the trap round 3 of #529 sprang on
  // `share-progress.test.ts`.
  const at = css.search(new RegExp(`^\\s*\\${selector}[^{]*\\{`, "m"));
  if (at === -1) throw new Error(`no rule for ${selector}`);
  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  if (close === -1) throw new Error(`unterminated rule for ${selector}`);
  return css.slice(open + 1, close);
}

describe("the guide accent is one colour, reached through layer 2 (#604)", () => {
  it("declares --s-guide in BOTH themes, at the same value", () => {
    // The issue asks for one guidance colour that reads on the dark background
    // and in light mode alike. A role only the dark block declares would leave
    // the ring unpainted in light — the half-applied theme #171 exists to catch.
    const light = semantic.indexOf(':root[data-theme="light"] {');
    expect(light, "no light block").toBeGreaterThan(-1);
    const guide = /--s-guide:\s*([^;]+);/g;
    const dark = guide.exec(semantic.slice(0, light))?.[1]?.trim();
    const lit = /--s-guide:\s*([^;]+);/
      .exec(semantic.slice(light))?.[1]
      ?.trim();
    expect(dark, "--s-guide is not declared in the dark block").toBeTruthy();
    expect(lit, "--s-guide is not declared in the light block").toBeTruthy();
    expect(lit).toBe(dark);
  });

  it("draws the ring from the role and nothing lower", () => {
    for (const selector of [
      ".is-guided",
      ".control--record.is-guided",
      ".record-guide.is-guided",
    ]) {
      const block = ruleBlock(components, selector);
      const declarations = [...block.matchAll(/([a-z-]+):\s*([^;]+);/g)];
      // Vacuity floor: a slice that caught a comment instead of a rule has no
      // declarations, and every assertion below would pass over nothing.
      expect(
        declarations.length,
        `${selector} declares nothing`
      ).toBeGreaterThanOrEqual(1);
      for (const [, prop, value] of declarations)
        expect(value, `${selector}'s ${prop} reaches past layer 2`).not.toMatch(
          /--p-(amber|cool|green|red|warn|blue)/
        );
      expect(block, `${selector} does not paint the guide role`).toMatch(
        /var\(--s-guide\)/
      );
    }
  });

  it("drops the ring inside an inert subtree, and does so last", () => {
    // Composition, not decision: a screen that goes inert behind a scrim keeps
    // rendering the mark it last painted, so the ring has to be killed where
    // the subtree is, not where the step is. Source order is the assertion —
    // this rule ties with the record exception on specificity, so it only wins
    // by coming after it.
    const block = ruleBlock(components, "[inert] .is-guided");
    expect(block).toMatch(/box-shadow:\s*none/);
    expect(components.indexOf("[inert] .is-guided")).toBeGreaterThan(
      components.indexOf(".control--record.is-guided")
    );
  });

  it("paints the recorder guide outside the disabled button", () => {
    expect(ruleBlock(components, ".record-guide.is-guided")).toMatch(
      /box-shadow:\s*0/
    );
    const source = read("src/components/recorder.tsx");
    expect(source).toContain(
      'className={cn("record-guide", guidedRecord && "is-guided")}'
    );
    expect(source).not.toContain("guided={guidedRecord}");
    expect(source).toContain("isClosing: isClosing && !stoppingInPlace");
  });

  it("keeps the record ring OUTSIDE the red, and every other ring inside", () => {
    // Not a taste call. The accent on `--s-live` is well under the non-text
    // floor in both themes — `tests/contrast.test.ts` asserts it — so a ring
    // drawn inside the red button is a ring almost nobody can see; on the
    // sheet's floor around it, it clears that floor. Everywhere else the ring
    // must stay inside its own box, because a full-bleed row is flush with a
    // scroll container that clips anything drawn outside it.
    expect(ruleBlock(components, ".is-guided")).toMatch(/box-shadow:\s*inset/);
    expect(ruleBlock(components, ".control--record.is-guided")).toMatch(
      /box-shadow:\s*0/
    );
  });

  it("holds the focus ring off the record ring, which shares its side", () => {
    // Everywhere else the guide is inside the box and focus is outside it, so
    // they are separated by construction. On the record button both are
    // outside, and at the base offset they would touch: the guide covers
    // 0-3px out and the outline starts at 3px. The offset has to be pushed by
    // at least the ring's own width for the two to read as two.
    const block = ruleBlock(
      globals,
      ".control--record.is-guided:focus-visible"
    );
    expect(block).toMatch(/outline-offset:\s*calc\(/);
    expect(block).toContain("--c-focus-offset");
    expect(block).toContain("--c-guide-ring");
    expect(globals.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/@layer\b/);
    expect(components).not.toContain(
      ".control--record.is-guided:focus-visible"
    );
  });
});

describe("every step of the chain reaches a control (#604)", () => {
  const resolver = read("src/components/guided-step.ts");
  const screens = {
    "src/components/books-screen.tsx": [
      "new-book",
      "create-book",
      "add-chapter",
      "create-chapter",
      "expand-book",
      "open-chapter",
    ],
    "src/components/segments-screen.tsx": ["add-segment", "open-segment"],
    "src/components/recorder.tsx": ["record"],
  } as const;

  it("claims every member of the union, so a new step cannot ship unwired", () => {
    const declared = new Set(
      [...resolver.matchAll(/kind:\s*"([a-z-]+)"/g)].map(([, k]) => k!)
    );
    expect(declared.size).toBeGreaterThanOrEqual(6);
    expect([...declared].sort()).toEqual(
      Object.values(screens).flat().slice().sort()
    );
  });

  for (const [file, kinds] of Object.entries(screens)) {
    it(`${path.basename(file)} asks the resolver and marks its own steps`, () => {
      const source = read(file);
      expect(source, "does not call guidedStep").toMatch(/guidedStep\(/);
      expect(source, "marks no control").toMatch(
        /guided=\{|guidedRecord && "is-guided"/
      );
      for (const kind of kinds) {
        if (kind === "record") {
          expect(source).toMatch(/guidedRecordShown\(/);
        } else {
          expect(source, `never reads the "${kind}" step`).toContain(
            `"${kind}"`
          );
        }
      }
    });
  }

  it("marks the two plain buttons on the shelf, which are not Controls", () => {
    // The chapter row and the book's expand toggle carry the class themselves;
    // every other target goes through `Control`/`EmptyState`/`NameEdit`/
    // `SegmentRow`, whose props are covered by the render cases above.
    const source = read("src/components/books-screen.tsx");
    expect(source.match(/guided\w* && "is-guided"/g) ?? []).toHaveLength(2);
  });
});

describe("the mark reaches the control it is given to (#604)", () => {
  // Three carriers, because the chain's targets are not all the same
  // component: a bare `Control` (Add chapter, Record), an `EmptyState` CTA
  // (New book, Add segment) and `NameEdit`'s commit (Create book). Each
  // forwards the flag to the one button it owns, and each must leave the mark
  // off when it is not the step — the half that keeps the ring from lingering.
  it("Control paints the ring only while guided", () => {
    const control = (guided?: boolean) =>
      one(
        render(
          createElement(Control, { icon: "plus", label: "New book", guided })
        ),
        "button"
      ).className;

    expect(control(true)).toContain("is-guided");
    expect(control(false)).not.toContain("is-guided");
    expect(control()).not.toContain("is-guided");
  });

  it("EmptyState hands the mark to its CTA and nothing else", () => {
    const container = render(
      createElement(EmptyState, {
        headline: "Start your first book",
        teach: "A book holds the chapters you record.",
        ctaLabel: "New book",
        ctaIcon: "plus",
        onCta: () => {},
        guided: true,
      })
    );
    expect(one(container, "button").className).toContain("is-guided");
    expect(container.querySelectorAll(".is-guided")).toHaveLength(1);
  });

  it("SegmentRow hands the mark to the red Record that opens the recorder", () => {
    // The row's own Record is the door to the recorder, and it is a
    // `--record` control, so the ring lands on it through the outset rule the
    // recorder's Record uses — the stylesheet keys that on the variant, not on
    // the screen, so both red controls are covered by one exception.
    const row: SegmentRowModel = {
      segmentId: "segment-1" as SegmentRowModel["segmentId"],
      ordinal: 1,
      label: null,
      hasClip: false,
      finished: false,
      clipId: null,
      peaks: null,
      durationMs: null,
    };
    const container = (guided: boolean) =>
      render(
        createElement(SegmentRow, {
          row,
          playing: false,
          playbackElapsedMs: 0,
          onPlay: () => {},
          onOpenRecorder: () => {},
          onSetFinished: () => {},
          onErase: () => {},
          onRename: () => Promise.resolve(true),
          guided,
        })
      );

    const marked = one(container(true), ".is-guided");
    expect(marked.getAttribute("aria-label")).toBe("Record segment 1");
    expect(marked.className).toContain("control--record");
    expect(container(false).querySelectorAll(".is-guided")).toHaveLength(0);
  });

  it("NameEdit hands the mark to its commit control, never the field", () => {
    // The field arrives pre-filled (#314), so Confirm is the next REQUIRED
    // action and the typing is optional — the ring says which.
    const container = render(
      createElement(NameEdit, {
        initialValue: "Book 001",
        fieldLabel: "Book name",
        saveLabel: "Create book",
        onSave: () => {},
        onCancel: () => {},
        guided: true,
      })
    );
    expect(one(container, "button").className).toContain("is-guided");
    expect(one(container, "input").className).not.toContain("is-guided");
  });

  it("NameEdit drops the mark while the create is in flight", () => {
    // A control
    // that is swallowing activations is not a control anyone should be pointed
    // at. `busy` keeps Confirm focusable and on screen (#137), so without this
    // the ring would sit on a button that answers nothing for the length of
    // the write.
    const container = render(
      createElement(NameEdit, {
        initialValue: "Book 001",
        fieldLabel: "Book name",
        saveLabel: "Create book",
        onSave: () => {},
        onCancel: () => {},
        busy: true,
        guided: true,
      })
    );
    expect(one(container, "button").className).not.toContain("is-guided");
  });
});
