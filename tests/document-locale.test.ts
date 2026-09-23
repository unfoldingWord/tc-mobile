import { readFileSync } from "node:fs";
import path from "node:path";

import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";

import { installDocumentLocale } from "@/hooks/document-locale";
import { DEFAULT_LOCALE, LOCALE_META } from "@/lib/i18n/locale";

/**
 * `<html lang>` and `<html dir>` come from the active locale, in all three
 * places that carry them (#169).
 *
 * There are three copies of this pair and they cannot be collapsed into one:
 * `index.html` is the static shell a browser parses before any module body
 * runs, the PWA manifest is read once at install time and can never follow a
 * runtime change, and `installDocumentLocale()` is what the running app
 * asserts. What they CAN do is disagree, and the failure is silent — a screen
 * reader reads the document's `lang` and nothing in the product would look
 * wrong to a sighted maintainer while it is saying an English catalog's words
 * in a Swahili voice.
 *
 * So all three are pinned to `LOCALE_META[DEFAULT_LOCALE]`, the one row
 * `locale.ts` owns. Changing the active locale without changing the shell and
 * the manifest fails here; so does changing either of them on their own.
 */
const ROOT = path.resolve(import.meta.dirname, "..");
const expected = LOCALE_META[DEFAULT_LOCALE];

/** The `<html>` open tag's attributes, from the file a browser actually gets. */
function shellHtmlTag(): string {
  const shell = readFileSync(path.join(ROOT, "index.html"), "utf8");
  // Anchored on the tag itself, not on a `lang=` anywhere in the file: the
  // shell's own comments name both attributes, and a substring search over the
  // whole file would match the prose that explains them.
  const tag = /<html\b[^>]*>/.exec(shell)?.[0];
  if (!tag) throw new Error("no <html> tag in index.html");
  return tag;
}

function attr(tag: string, name: string): string | null {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
}

describe("the document's language and direction (#169)", () => {
  it("index.html's shell carries the active locale's tag and direction", () => {
    const tag = shellHtmlTag();
    expect(attr(tag, "lang")).toBe(expected.tag);
    expect(attr(tag, "dir")).toBe(expected.dir);
  });

  it("the PWA manifest carries them too", () => {
    const config = readFileSync(path.join(ROOT, "vite.config.ts"), "utf8");
    // The manifest block only — `vite.config.ts` has other `lang`-shaped
    // strings nowhere near it, and a whole-file match would find them.
    const manifest = /manifest:\s*\{[\s\S]*?\n      \}/.exec(config)?.[0];
    if (!manifest) throw new Error("no manifest block in vite.config.ts");
    expect(manifest).toContain(`lang: "${expected.tag}"`);
    expect(manifest).toContain(`dir: "${expected.dir}"`);
  });
});

describe("installDocumentLocale (#169)", () => {
  const realDocument = Reflect.getOwnPropertyDescriptor(globalThis, "document");

  afterEach(() => {
    if (realDocument)
      Reflect.defineProperty(globalThis, "document", realDocument);
    else Reflect.deleteProperty(globalThis, "document");
  });

  it("writes both attributes onto a document that has neither", () => {
    // Starts from a shell with NO lang and NO dir, so a no-op implementation
    // fails: asserting against the real `index.html` would have passed on an
    // empty function, since the shell already carries the right pair.
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    Reflect.defineProperty(globalThis, "document", {
      value: dom.window.document,
      configurable: true,
    });

    expect(dom.window.document.documentElement.getAttribute("lang")).toBeNull();

    installDocumentLocale();

    expect(dom.window.document.documentElement.getAttribute("lang")).toBe(
      expected.tag
    );
    expect(dom.window.document.documentElement.getAttribute("dir")).toBe(
      expected.dir
    );
  });
});
