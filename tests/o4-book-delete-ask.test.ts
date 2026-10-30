import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { O4BookDeleteAsk } from "@/components/o4-book-delete-ask";
import { strings } from "@/lib/strings";
import { areaRule, areaScope, areaSelector, fileRules } from "./o4-area-css";
import { declarationValue } from "./support";
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
    const cover = one(group, ".o4-sheet-head > .books-cover.is-sm");
    expect(cover.getAttribute("aria-hidden")).toBe("true");
    expect(cover.getAttribute("style")).toContain("--book-cover:#2a9d8f");
    expect(one(cover, "svg")).toBeTruthy();
    expect(one(group, ".o4-sheet-head > .books-sheet-name").textContent).toBe(
      "Mark"
    );
  });

  it("has Keep's aria-describedby resolve to the question naming the book (#1032)", () => {
    const root = ask();
    const keep = buttonNamed(root, strings.keepBook);
    const id = keep.getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    const target = root.ownerDocument.getElementById(id!);
    expect(target).toBeTruthy();
    expect(target!.textContent).toBe(strings.deleteBookConfirmTitle("Mark"));
    expect(target!.textContent).toContain("Mark");
    expect(target!.classList.contains("sr-only")).toBe(true);
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

describe("3-components/books.css: the delete ask's rules match its markup (#980)", () => {
  const books = areaScope("books");
  const sel = (selector: string) => areaSelector("books", selector);
  const value = (scope: string, selector: string, property: string) =>
    declarationValue(areaRule(scope, selector), property);
  const added = [
    ".books-delete-ask",
    ".books-cover.is-sm",
    ".books-sheet-name",
  ];

  it("has one rule for each new class, and each matches the rendered ask", () => {
    const root = ask();
    for (const selector of added) {
      // `areaRule` throws on a missing, doubled or empty rule, so reading it
      // is the check.
      areaRule(books, sel(selector));
      expect(root.querySelector(selector), selector).not.toBeNull();
    }
  });

  it("draws the workbench's small cover: 52 x 64 with a 5px spine", () => {
    expect(value(books, sel(".books-cover.is-sm"), "width")).toBe("52px");
    expect(value(books, sel(".books-cover.is-sm"), "height")).toBe("64px");
    expect(value(books, sel(".books-cover.is-sm::before"), "width")).toBe(
      "5px"
    );
  });

  it("adds no second copy of the menu sheets' head rules (#980)", () => {
    // The head is 3-components/menus.css's `o4-sheet-head`, which also hides the
    // sheet's own title while it is in the panel. books.css must not restate
    // either rule under a Books-only name, in any block of the file.
    const rules = fileRules("books");
    expect(rules.length).toBeGreaterThanOrEqual(12);
    for (const r of rules) {
      for (const selector of r.selectors) {
        expect(selector, selector).not.toMatch(
          /sheet-head|menu-panel.*\.t-title/
        );
      }
    }
  });

  it("uses 3-components/menus.css's sheet head, which hides the title and lays out the row", () => {
    const menus = areaScope("menus");
    expect(
      value(menus, areaSelector("menus", ".o4-sheet-head"), "display")
    ).toBe("flex");
    expect(
      value(
        menus,
        areaSelector("menus", ".menu-panel:has(.o4-sheet-head) .t-title"),
        "visibility"
      )
    ).toBe("hidden");
    expect(
      ask().querySelector(".books-delete-ask > .o4-sheet-head")
    ).not.toBeNull();
  });
});
