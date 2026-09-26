import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { O4BookDeleteAsk } from "@/components/o4-book-delete-ask";
import { strings } from "@/lib/strings";
import { areaRules } from "./o4-area-css";
import { one, render } from "./render";

/**
 * The O4 book sheet's delete ask (#980, G6; #949 D16) as markup: props in,
 * attributes out, through the #197 render harness. What the ask DOES —
 * focus, Keep, Escape, Back, the outcomes — is
 * `tests/books-delete-in-sheet-o4.test.ts`, which mounts the whole screen.
 *
 * The stylesheet half reads rules, comments stripped (`o4-area-css.ts`), and
 * checks each new books.css selector against this markup, so a renamed class
 * on either side fails here rather than silently unstyling the sheet.
 */

function ask(busy = false): Element {
  return render(
    createElement(O4BookDeleteAsk, {
      name: "Mark",
      coverHex: "#2a9d8f",
      busy,
      keepRef: () => {},
      onKeep: () => {},
      onDelete: () => {},
    })
  );
}

function buttonNamed(root: Element, label: string): Element {
  return one(root, `button[aria-label="${label}"]`);
}

describe("O4BookDeleteAsk markup (#980)", () => {
  it("names the question on the group, and draws the book's small cover and name", () => {
    const root = ask();
    const group = one(root, ".books-delete-ask");
    expect(group.getAttribute("role")).toBe("group");
    expect(group.getAttribute("aria-label")).toBe(
      strings.deleteBookConfirmTitle("Mark")
    );
    const cover = one(group, ".books-sheet-head > .books-cover.is-sm");
    expect(cover.getAttribute("aria-hidden")).toBe("true");
    expect(cover.getAttribute("style")).toContain("--book-cover:#2a9d8f");
    expect(one(cover, "svg")).toBeTruthy();
    expect(
      one(group, ".books-sheet-head > .books-sheet-name").textContent
    ).toBe("Mark");
  });

  it("puts Keep then Delete, as direct children of the confirm actions row", () => {
    const root = ask();
    const actions = one(root, ".confirm-actions");
    const kids = [...actions.children];
    expect(kids.map((k) => k.getAttribute("aria-label"))).toEqual([
      strings.keepBook,
      strings.deleteBookYes,
    ]);
    expect(kids[0]!.classList.contains("confirm-cancel")).toBe(true);
    expect(kids[1]!.classList.contains("control--record")).toBe(true);
  });

  it("disables only Delete while the delete is in flight, so the trap keeps Keep", () => {
    const idle = ask(false);
    expect(
      buttonNamed(idle, strings.deleteBookYes).hasAttribute("disabled")
    ).toBe(false);
    const busy = ask(true);
    expect(
      buttonNamed(busy, strings.deleteBookYes).hasAttribute("disabled")
    ).toBe(true);
    expect(buttonNamed(busy, strings.keepBook).hasAttribute("disabled")).toBe(
      false
    );
  });
});

describe("o4/books.css: the delete ask's rules match its markup (#980)", () => {
  const O4 = '[data-design="o4"] ';
  const rules = areaRules("books");
  const added = [
    ".books-delete-ask",
    ".books-sheet-head",
    ".books-cover.is-sm",
    ".books-sheet-name",
  ];

  it("has one rule for each new class, and each matches the rendered ask", () => {
    expect(rules.length).toBeGreaterThanOrEqual(12);
    const root = ask();
    for (const sel of added) {
      const hits = rules.filter((r) => r.selectors.includes(`${O4}${sel}`));
      expect(hits, sel).toHaveLength(1);
      expect(root.querySelector(sel), sel).not.toBeNull();
    }
  });

  it("draws the workbench's small cover: 52 x 64 with a 5px spine", () => {
    const sm = rules.find((r) =>
      r.selectors.includes(`${O4}.books-cover.is-sm`)
    )!;
    expect(sm.decls.get("width")).toBe("52px");
    expect(sm.decls.get("height")).toBe("64px");
    const spine = rules.find((r) =>
      r.selectors.includes(`${O4}.books-cover.is-sm::before`)
    );
    expect(spine?.decls.get("width")).toBe("5px");
  });

  it("hides the sheet's own title only while the ask is in it", () => {
    const hide = rules.filter((r) =>
      r.selectors.includes(`${O4}.menu-panel:has(.books-delete-ask) .t-title`)
    );
    expect(hide).toHaveLength(1);
    expect(hide[0]!.decls.get("visibility")).toBe("hidden");
  });
});
