import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { LanguageAsk, LanguageCountStatus } from "@/components/language-ask";
import { LicenceAsk } from "@/components/licence-ask";
import type { LanguageListState } from "@/hooks/use-language-ask";
import { indexLanguageList } from "@/lib/languages/list";
import { strings } from "@/lib/strings";

import { one, render } from "./render";

/**
 * The two asks' spoken names (#1344, #1455, #1492). One render, no effects, no
 * events: what each licence radio is called and what it shows, and the polite
 * status line that says how many languages match. That a screen reader reads
 * these names aloud is inference from the markup; no screen reader was run.
 */

const FULL: Record<string, string> = {
  "CC-BY-SA-4.0": "Creative Commons Attribution-ShareAlike 4.0 (CC BY-SA 4.0)",
  "CC-BY-4.0": "Creative Commons Attribution 4.0 (CC BY 4.0)",
  "CC0-1.0": "Creative Commons Zero 1.0, public domain (CC0 1.0)",
  "all-rights-reserved": "All rights reserved",
};
const SHORT: Record<string, string> = {
  "CC-BY-SA-4.0": "CC BY-SA 4.0",
  "CC-BY-4.0": "CC BY 4.0",
  "CC0-1.0": "CC0 1.0",
  "all-rights-reserved": "All rights reserved",
};

describe("LicenceAsk spoken names", () => {
  const root = render(
    createElement(LicenceAsk, {
      onContinue: () => {},
      onCancel: () => {},
      saving: false,
      error: null,
    })
  );
  const radios = Array.from(root.querySelectorAll('[role="radio"]'));

  it("names each radio by the full licence name, with the short label inside it", () => {
    expect(radios.map((r) => r.getAttribute("data-licence"))).toEqual(
      Object.keys(FULL)
    );
    for (const r of radios) {
      const id = r.getAttribute("data-licence") as string;
      const name = r.getAttribute("aria-label") as string;
      expect(name).toBe(FULL[id]);
      expect(name).toContain(SHORT[id]);
    }
  });

  it("keeps the visible row on the short label", () => {
    for (const r of radios) {
      const id = r.getAttribute("data-licence") as string;
      expect(one(r, ".licence-row-name").textContent).toBe(SHORT[id]);
    }
  });
});

function ready(languages: string[][]): LanguageListState {
  return {
    kind: "ready",
    list: indexLanguageList({ source: "SIL langtags test", languages }),
  };
}

describe("LanguageAsk result count", () => {
  it("mounts one empty polite status line for the ask", () => {
    const root = render(
      createElement(LanguageAsk, {
        state: ready([["en", "English"]]),
        onRetry: () => {},
        onPick: () => {},
        onCancel: () => {},
        saving: false,
        error: null,
      })
    );
    const status = one(root, '[role="status"].sr-only');
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toBe("");
  });

  const say = (total: number, shown: number) =>
    render(createElement(LanguageCountStatus, { result: { total, shown } }))
      .textContent;

  it("says the count through the plural table", () => {
    expect(say(1, 1)).toBe("1 language matches.");
    expect(say(7, 7)).toBe("7 languages match.");
  });

  it("says more match than are shown when the list is cut", () => {
    expect(say(120, 50)).toBe(
      "120 languages match. Showing the first 50. Type more to narrow your search."
    );
  });

  it("says nothing for no match or no search, the visible notice owns no-match", () => {
    expect(say(0, 0)).toBe("");
    expect(
      render(createElement(LanguageCountStatus, { result: null })).textContent
    ).toBe("");
    expect(strings.languageNoMatch).not.toBe("");
  });
});
