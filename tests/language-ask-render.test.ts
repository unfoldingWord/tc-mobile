import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { LanguageAsk } from "@/components/language-ask";
import type { LanguageListState } from "@/hooks/use-language-ask";
import { indexLanguageList } from "@/lib/languages/list";
import { strings } from "@/lib/strings";

import { one, render } from "./render";

/**
 * The language ask's markup (#1492), rendered once through `tests/render.ts`:
 * what each row is called, what the field is called, and what each list
 * state says. One render, no effects and no events: typing, arrow keys and
 * focus are in e2e/export-language-ask.spec.ts.
 */

function ready(languages: string[][]): LanguageListState {
  return {
    kind: "ready",
    list: indexLanguageList({ source: "SIL langtags test", languages }),
  };
}

function ask(
  state: LanguageListState,
  extra: { saving?: boolean; error?: string | null } = {}
) {
  return render(
    createElement(LanguageAsk, {
      state,
      onRetry: () => {},
      onPick: () => {},
      onCancel: () => {},
      saving: extra.saving ?? false,
      error: extra.error ?? null,
    })
  );
}

describe("LanguageAsk", () => {
  it("draws each row's name, autonym and tag as its content, with no label over it, and the autonym in its own language", () => {
    const root = ask(
      ready([
        ["en", "English"],
        ["fr", "French", "français"],
      ])
    );
    const rows = Array.from(root.querySelectorAll("ul.language-list button"));
    expect(rows.map((r) => r.hasAttribute("aria-label"))).toEqual([
      false,
      false,
    ]);
    expect(rows.map((r) => r.textContent)).toEqual([
      "English en",
      "French français fr",
    ]);
    const autonym = one(root, ".language-row [lang]");
    expect(autonym.textContent).toBe("français");
    expect(autonym.getAttribute("lang")).toBe("fr");
    expect(rows.every((r) => r.getAttribute("type") === "button")).toBe(true);
  });

  it("labels the search field and points it at the list", () => {
    const root = ask(ready([["en", "English"]]));
    const field = one(root, "input");
    expect(field.getAttribute("aria-label")).toBe(strings.languageSearch);
    const list = one(root, "ul.language-list");
    expect(field.getAttribute("aria-controls")).toBe(list.getAttribute("id"));
  });

  it("draws fifty rows and says to type more when the list is longer", () => {
    const many = Array.from({ length: 60 }, (_, i) => [
      `x${String(i).padStart(2, "0")}`,
      `Language ${String(i).padStart(2, "0")}`,
    ]);
    const root = ask(ready(many));
    expect(root.querySelectorAll("ul.language-list button")).toHaveLength(50);
    expect(root.textContent).toContain(strings.languageNarrow);
  });

  it("says it is loading, or that the load failed with a way to try again", () => {
    expect(ask({ kind: "loading" }).textContent).toContain(
      strings.languageLoading
    );
    const failed = ask({ kind: "failed" });
    expect(failed.textContent).toContain(strings.languageLoadFailed);
    const buttons = Array.from(failed.querySelectorAll("button")).map(
      (b) => b.textContent
    );
    expect(buttons).toEqual([strings.tryAgain, strings.languageAskCancel]);
  });

  it("marks the rows busy while the pick is saved, and shows a failed save", () => {
    const root = ask(ready([["en", "English"]]), {
      saving: true,
      error: strings.saveFailed,
    });
    expect(one(root, ".language-row").getAttribute("aria-disabled")).toBe(
      "true"
    );
    expect(root.textContent).toContain(strings.languageSaving);
    expect(root.textContent).toContain(strings.saveFailed);
  });
});
