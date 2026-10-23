import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFromEntry, newIntent } from "@/hooks/use-template-library";
import { listBooks } from "@/lib/storage/books";
import {
  licenceTag,
  resolveAssetUrl,
  templateTitle,
} from "@/lib/templates/library";
import { loadObsTemplate } from "@/lib/templates/obs";
import { strings } from "@/lib/strings";
import { clearAllStores } from "./support";

/**
 * The Template Library's logic (#246, part of #1450): where a package asset
 * resolves, how a licence and a title are worded, and the create that passes
 * the template's name to the store so a second book from the same template is
 * refused (U4b). The picker's markup is `template-picker-render.test.ts`'s.
 */

vi.mock("@/hooks/report-failure", () => ({ reportFailure: vi.fn() }));

describe("resolveAssetUrl: a package asset resolves against the app base, never the route", () => {
  const rel = "obs/thumbs/obs-01-07.jpg";

  it("gives the root path at the default base", () => {
    expect(resolveAssetUrl(rel, "/")).toBe("/obs/thumbs/obs-01-07.jpg");
  });

  it("does not depend on the page the screen is on", () => {
    // A bare relative `src` resolves against the document URL, so the same
    // string lands in a different place from each route. The resolved form
    // is an absolute path, so the route cannot move it.
    for (const route of ["/", "/books/3", "/books/3/chapters/9/"]) {
      const resolved = new URL(
        resolveAssetUrl(rel, "/"),
        `https://app.test${route}`
      );
      expect(resolved.pathname).toBe("/obs/thumbs/obs-01-07.jpg");
    }
    const bare = new URL(rel, "https://app.test/books/3/chapters/9/");
    expect(bare.pathname).toBe("/books/3/chapters/9/obs/thumbs/obs-01-07.jpg");
  });

  it("honours a base that is not the origin root, with or without its slash", () => {
    expect(resolveAssetUrl(rel, "/tc/")).toBe("/tc/obs/thumbs/obs-01-07.jpg");
    expect(resolveAssetUrl(rel, "/tc")).toBe("/tc/obs/thumbs/obs-01-07.jpg");
  });

  it("resolves the first thumbnail the OBS package carries", async () => {
    const { pkg } = await loadObsTemplate();
    const first = pkg.chapters[0]?.segments[0]?.thumbnail;
    expect(first).toBe("obs/thumbs/obs-01-01.jpg");
    expect(resolveAssetUrl(first ?? "", "/")).toBe("/obs/thumbs/obs-01-01.jpg");
  });
});

describe("licenceTag and templateTitle", () => {
  it("writes an SPDX id the way people write it", () => {
    expect(licenceTag("CC-BY-SA-4.0")).toBe("CC BY-SA 4.0");
    expect(licenceTag("CC-BY-4.0")).toBe("CC BY 4.0");
    expect(licenceTag("all-rights-reserved")).toBe("all-rights-reserved");
  });

  it("takes the title in the asked language, then the package's first", () => {
    const title = { en: "Open Bible Stories", es: "Historias" };
    expect(templateTitle(title, ["en", "es"], "es")).toBe("Historias");
    expect(templateTitle(title, ["en", "es"], "fr")).toBe("Open Bible Stories");
  });
});

describe("createFromEntry: the template's name goes to the store (U4b)", () => {
  beforeEach(async () => {
    await clearAllStores();
  });

  it("writes the first book and names it with the template title", async () => {
    const entry = await loadObsTemplate();
    const outcome = await createFromEntry(
      newIntent(entry),
      "Open Bible Stories"
    );
    expect(outcome.ok).toBe(true);
    const books = await listBooks();
    expect(books).toHaveLength(1);
    expect(books[0]?.name).toBe("Open Bible Stories");
    expect(books[0]?.chapterIds).toHaveLength(50);
  });

  it("refuses a second book from the same template under the same name, and writes nothing", async () => {
    const entry = await loadObsTemplate();
    await createFromEntry(newIntent(entry), "Open Bible Stories");
    const second = await createFromEntry(
      newIntent(entry),
      "Open Bible Stories"
    );
    expect(second).toEqual({ ok: false, key: "bookNameTaken" });
    expect(strings.bookNameTaken).toBe(
      "Another book has this name. Type a different name."
    );
    expect(await listBooks()).toHaveLength(1);
  });

  it("accepts the same template again under a different name, on the same intent", async () => {
    const entry = await loadObsTemplate();
    await createFromEntry(newIntent(entry), "Open Bible Stories");
    const intent = newIntent(entry);
    const refused = await createFromEntry(intent, "Open Bible Stories");
    expect(refused.ok).toBe(false);
    const retry = await createFromEntry(intent, "Open Bible Stories 2");
    expect(retry.ok).toBe(true);
    expect(await listBooks()).toHaveLength(2);
  });
});
