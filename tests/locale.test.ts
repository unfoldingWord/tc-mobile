import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  SHIPPED_LOCALE,
  withLocaleAttributes,
  type Locale,
} from "@/lib/locale";

/**
 * #169's fourth fix item: `<html lang>`/`dir` and the manifest language come
 * from one locale, not from three literals.
 *
 * Two halves, and both are needed. The TABLE below covers the pure transform —
 * what it rewrites, what it leaves alone, and the two states it refuses. The
 * WIRING block covers the part a table cannot see: that the document and the
 * manifest actually read the module, rather than carrying their own copy of
 * `en` that happens to agree with it today. The wiring half is the one that
 * was red before this change: `index.html` carried no `dir` at all and
 * `vite.config.ts`'s manifest had a literal `lang: "en"`.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** Not the shipped locale, on purpose — see `rtl` below. */
const ARABIC: Locale = { tag: "ar", dir: "rtl" };

describe("withLocaleAttributes", () => {
  it("replaces an existing lang and adds the dir that was missing", () => {
    expect(withLocaleAttributes('<html lang="en">', ARABIC)).toBe(
      '<html lang="ar" dir="rtl">'
    );
  });

  it("replaces a dir that is already there rather than adding a second", () => {
    const out = withLocaleAttributes('<html lang="ar" dir="rtl">', {
      tag: "en",
      dir: "ltr",
    });
    expect(out).toBe('<html lang="en" dir="ltr">');
    // The defect this pins is two `dir` attributes with the stale one first,
    // which is valid-enough HTML that a browser silently honours the wrong one.
    expect(out.match(/dir=/g)).toHaveLength(1);
  });

  it("labels a bare <html> tag", () => {
    expect(withLocaleAttributes("<html>", ARABIC)).toBe(
      '<html lang="ar" dir="rtl">'
    );
  });

  it.each([
    ["unquoted", "<html lang=en dir=ltr>"],
    ["single-quoted", "<html lang='en' dir='ltr'>"],
    ["oddly spaced", "<html  lang = 'en'   dir = ltr >"],
  ])("replaces the %s spelling a hand-edited file can carry", (_name, tag) => {
    const out = withLocaleAttributes(tag, ARABIC);
    expect(out.match(/lang=/g)).toHaveLength(1);
    expect(out.match(/dir=/g)).toHaveLength(1);
    expect(out).toContain('lang="ar"');
    expect(out).toContain('dir="rtl"');
  });

  it("keeps every other attribute on the tag", () => {
    expect(
      withLocaleAttributes('<html lang="en" data-theme="dark">', ARABIC)
    ).toBe('<html lang="ar" data-theme="dark" dir="rtl">');
  });

  it("touches nothing outside the opening tag", () => {
    const doc = [
      "<!doctype html>",
      '<html lang="en">',
      "  <head>",
      '    <meta http-equiv="content-language" content="en" />',
      "    <title>tC Mobile</title>",
      "  </head>",
      "  <body><p>lang=en dir=ltr</p></body>",
      "</html>",
    ].join("\n");

    const out = withLocaleAttributes(doc, ARABIC);

    expect(out).toBe(
      doc.replace('<html lang="en">', '<html lang="ar" dir="rtl">')
    );
    // The body text and the closing tag both contain strings a sloppier
    // pattern would have rewritten.
    expect(out).toContain("<p>lang=en dir=ltr</p>");
    expect(out).toContain("</html>");
  });

  it("throws rather than shipping a document it could not label", () => {
    expect(() => withLocaleAttributes("<body></body>", ARABIC)).toThrow(
      /no <html> tag/
    );
  });

  it.each(["", "en_US", 'en" onload="x', "en-", "e n"])(
    "throws on %j rather than writing it into an attribute",
    (tag) => {
      expect(() => withLocaleAttributes("<html>", { tag, dir: "ltr" })).toThrow(
        /not a language tag/
      );
    }
  );

  it("accepts the subtagged forms a real second locale arrives as", () => {
    for (const tag of ["en", "pt-BR", "az-Cyrl-AZ"]) {
      expect(withLocaleAttributes("<html>", { tag, dir: "ltr" })).toContain(
        `lang="${tag}"`
      );
    }
  });
});

describe("the shipped locale reaches the document and the manifest", () => {
  it("index.html's static tag is what the transform would produce", () => {
    const html = read("index.html");
    // Not "index.html contains lang=en": that passes while `dir` is absent,
    // which is the state this change exists to fix. Idempotence against the
    // transform is the whole claim — the file a human reads, and the file the
    // build emits, say the same thing.
    expect(withLocaleAttributes(html, SHIPPED_LOCALE)).toBe(html);
  });

  it("the manifest takes its lang and dir from the locale, not a literal", () => {
    const config = read("vite.config.ts");
    const manifest = config.slice(config.indexOf("manifest: {"));
    expect(
      manifest.length,
      "no manifest block in vite.config.ts"
    ).toBeGreaterThan(200);

    expect(manifest).toContain("lang: SHIPPED_LOCALE.tag");
    expect(manifest).toContain("dir: SHIPPED_LOCALE.dir");
    // The literal this replaced. A second copy of the language in the build
    // config is exactly the drift #169 is about.
    expect(manifest).not.toMatch(/lang:\s*"/);
  });

  it("the build labels index.html through the locale module", () => {
    const config = read("vite.config.ts");
    expect(config).toContain("withLocaleAttributes");
    expect(config).toContain("transformIndexHtml");
    // Defining the plugin is not running it. A `localeHtmlPlugin` that is
    // never added to `plugins` leaves the config reading perfectly while
    // `dist/index.html` ships whatever `index.html` happened to say — which
    // is why `tests/dist-locale.test.ts` reads the built files instead of
    // trusting this grep.
    const plugins = config.slice(config.indexOf("plugins: ["));
    expect(
      plugins.length,
      "no plugins array in vite.config.ts"
    ).toBeGreaterThan(100);
    expect(plugins).toContain("localeHtmlPlugin()");
  });

  it("ships English, left-to-right — today's behaviour, stated", () => {
    expect(SHIPPED_LOCALE).toEqual({ tag: "en", dir: "ltr" });
  });
});
