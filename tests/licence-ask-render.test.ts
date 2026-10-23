import "fake-indexeddb/auto";

import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { LicenceAsk } from "@/components/licence-ask";
import { needsLicenceAsk } from "@/hooks/use-licence-ask";
import { strings } from "@/lib/strings";
import { createBook, getBook } from "@/lib/storage/books";
import { createBookFromPlan } from "@/lib/storage/template-book";
import { planBookFromTemplate } from "@/lib/templates/plan";
import { parseTemplatePackage } from "@/lib/templates/validate";
import type { Book, BookId, ChapterId, SegmentId } from "@/types/domain";

import { one, render } from "./render";
import { clearAllStores } from "./support";

/**
 * The licence ask (#1455, UI half): the four choices D5 and R20 name, CC BY-SA
 * 4.0 pre-selected, no "Other" (U1a is open), and never reached for a book
 * made from a template (D5 `lock-template`). One render, no events.
 */

beforeEach(clearAllStores);

function ask(extra: { saving?: boolean; error?: string | null } = {}) {
  return render(
    createElement(LicenceAsk, {
      onContinue: () => {},
      onCancel: () => {},
      saving: extra.saving ?? false,
      error: extra.error ?? null,
    })
  );
}

async function templateBook(): Promise<Book> {
  const json: unknown = JSON.parse(
    readFileSync(
      path.join(__dirname, "fixtures", "templates", "obs-min.json"),
      "utf8"
    )
  );
  const plan = planBookFromTemplate(
    parseTemplatePackage(json),
    (kind, key) => `${kind}:${key}`,
    100
  );
  return createBookFromPlan(plan, {
    book: "book-t" as BookId,
    chapters: plan.chapters.map((chapter, c) => ({
      id: `chapter-t-${c}` as ChapterId,
      segments: chapter.segments.map(
        (_, s) => `segment-t-${c}-${s}` as SegmentId
      ),
    })),
  });
}

describe("LicenceAsk", () => {
  it("offers exactly four choices, in the order the decisions list them", () => {
    const radios = Array.from(ask().querySelectorAll('[role="radio"]'));
    expect(radios.map((r) => r.getAttribute("data-licence"))).toEqual([
      "CC-BY-SA-4.0",
      "CC-BY-4.0",
      "CC0-1.0",
      "all-rights-reserved",
    ]);
    expect(radios.map((r) => r.getAttribute("aria-label"))).toEqual([
      "CC BY-SA 4.0",
      "CC BY 4.0",
      "CC0 1.0",
      strings.licenceAllRightsReserved,
    ]);
  });

  it("pre-selects CC BY-SA 4.0 and nothing else (R20)", () => {
    const radios = Array.from(ask().querySelectorAll('[role="radio"]'));
    const checked = radios.filter(
      (r) => r.getAttribute("aria-checked") === "true"
    );
    expect(checked.map((r) => r.getAttribute("data-licence"))).toEqual([
      "CC-BY-SA-4.0",
    ]);
  });

  it("does not offer Other while U1a is open", () => {
    expect(ask().textContent).not.toMatch(/other/i);
  });

  it("names the group, and says saving or the failure when it has one", () => {
    const root = ask({ saving: true, error: "Could not save." });
    expect(one(root, '[role="radiogroup"]').getAttribute("aria-label")).toBe(
      strings.licenceAskTitle
    );
    expect(root.textContent).toContain(strings.licenceSaving);
    expect(root.textContent).toContain("Could not save.");
  });
});

describe("needsLicenceAsk", () => {
  it("asks for a blank book whose licence is not chosen", async () => {
    const book = await createBook("Mark", null);
    expect(book.licence).toBeNull();
    expect(needsLicenceAsk(book)).toBe(true);
  });

  it("never asks for a template book, whose licence D5 fixes", async () => {
    const made = await templateBook();
    const stored = await getBook(made.id);
    expect(stored?.licence).toBe("CC-BY-SA-4.0");
    expect(needsLicenceAsk(stored!)).toBe(false);
  });

  it("does not ask again once a licence is chosen (S6, once per book)", () => {
    expect(needsLicenceAsk({ licence: "CC0-1.0" })).toBe(false);
    expect(needsLicenceAsk({ licence: "all-rights-reserved" })).toBe(false);
  });
});
