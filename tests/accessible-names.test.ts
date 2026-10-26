import { createElement, type ReactElement } from "react";
import { afterAll, describe, expect, it } from "vitest";

import { ChapterPlayControl } from "@/components/chapter-play-control";
import type { ChapterRowStatus } from "@/components/chapter-row-status";
import { Control } from "@/components/control";
import { CoverPicker } from "@/components/cover-picker";
import { LanguageAsk } from "@/components/language-ask";
import { LicenceAsk } from "@/components/licence-ask";
import { O4BookDeleteAsk } from "@/components/o4-book-delete-ask";
import { SettingRow } from "@/components/setting-row";
import { TemplateList } from "@/components/template-picker";
import { indexLanguageList } from "@/lib/languages/list";
import { completeLocales, installLocale } from "@/lib/i18n/locales";
import { SHIPPED_LOCALE } from "@/lib/locale";
import { loadObsTemplate } from "@/lib/templates/obs";

import { render } from "./render";

/**
 * A gate for #1344's "every control carries a full accessible name": render
 * each presentational surface the audit touched, in English and in every
 * complete language, and read the attributes it emits.
 *
 * Three rules, each reported by surface and locale:
 *
 * 1. A button, radio, slider, switch or image has a non-empty accessible name.
 * 2. No `aria-label` sits on an element with no role that has none natively (a
 *    plain `span` or `div`): such a label is not spoken (inference), so the
 *    words it holds are lost. A `div` with a `role` stays fine.
 * 3. Label in name (WCAG 2.5.3): when a control draws text, its accessible
 *    name contains that text, so a person who says what they see is understood
 *    and a screen reader does not speak less than the screen shows.
 *
 * Scope is the surfaces listed in `SURFACES`, not a tree sweep. A surface this
 * does not list is not covered; adding one is one entry.
 *
 * WHAT A RENDER READ CANNOT SEE. This reads attributes in static markup. It is
 * not what TalkBack or VoiceOver speak: it does not run a browser's name
 * algorithm (the one below is a reduced reading of it: `aria-labelledby`, then
 * `aria-label`, then `alt` on an image or exposed text otherwise, then
 * `title`; `alt=""` and a presentational role mark a decorative image that
 * needs no name), it sees no CSS (so
 * `display: none` and the screen-reader-only class are matched by name), and
 * it cannot read a live region's announcement. Spoken form is a device check.
 *
 * The rules are read through `render`, so a comment cannot satisfy them.
 */

interface Finding {
  rule: 1 | 2 | 3;
  site: string;
  detail: string;
}

const NAMED_ROLES = new Set(["radio", "slider", "switch", "img"]);
// Elements whose own tag gives them a role, so an `aria-label` is spoken.
const LABELLABLE_TAGS = new Set([
  "button",
  "a",
  "input",
  "select",
  "textarea",
  "img",
  "svg",
  "section",
  "nav",
  "form",
  "dialog",
  "fieldset",
  "table",
  "ul",
  "ol",
  "main",
  "header",
  "footer",
  "aside",
]);

const squash = (text: string): string =>
  text.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The text a name is computed from: what is exposed to assistive technology,
 * not what is drawn. `aria-hidden` text is drawn but not exposed, so it names
 * nothing; screen-reader-only text is exposed but not drawn, so it does.
 */
function exposedText(el: Element): string {
  let out = "";
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3) out += node.textContent ?? "";
    else if (node.nodeType === 1) {
      const child = node as Element;
      if (
        child.hasAttribute("hidden") ||
        child.getAttribute("aria-hidden") === "true"
      ) {
        continue;
      }
      out += ` ${exposedText(child)} `;
    }
  }
  return out;
}

/** Each separately drawn piece of text, so a name may put a word between two. */
function drawnParts(el: Element): string[] {
  const parts: string[] = [];
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3) {
      const text = squash(node.textContent ?? "");
      if (text !== "") parts.push(text);
    } else if (node.nodeType === 1) {
      const child = node as Element;
      if (child.hasAttribute("hidden") || child.matches(".sr-only")) continue;
      parts.push(...drawnParts(child));
    }
  }
  return parts;
}

function accessibleName(el: Element): string {
  const by = el.getAttribute("aria-labelledby");
  if (by !== null) {
    const doc = el.ownerDocument;
    return by
      .split(/\s+/)
      .map((id) => doc.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
  }
  const label = el.getAttribute("aria-label");
  if (label !== null && label.trim() !== "") return label.trim();
  const title = (el.getAttribute("title") ?? "").trim();
  if (el.tagName === "IMG") {
    // A present `alt`, empty included, is the name; `title` only without one.
    const alt = el.getAttribute("alt");
    return alt !== null ? alt.trim() : title;
  }
  return exposedText(el).replace(/\s+/g, " ").trim() || title;
}

/** `alt=""` with no author label, or a presentational role: not named. */
function decorative(el: Element): boolean {
  const role = el.getAttribute("role");
  if (role === "presentation" || role === "none") return true;
  return (
    el.tagName === "IMG" &&
    el.getAttribute("alt") === "" &&
    !el.hasAttribute("aria-labelledby") &&
    (el.getAttribute("aria-label") ?? "").trim() === ""
  );
}

function site(el: Element): string {
  const cls = el.getAttribute("class");
  return `<${el.tagName.toLowerCase()}${cls ? `.${cls.split(" ")[0]}` : ""}>`;
}

/** Every finding in `root`, across the three rules. */
function findings(root: Element, labelInName = true): Finding[] {
  const out: Finding[] = [];
  const named = root.querySelectorAll(
    "button, img, [role=radio], [role=slider], [role=switch], [role=img]"
  );
  for (const el of Array.from(named)) {
    if (decorative(el)) continue;
    const role = el.getAttribute("role");
    if (role !== null && !NAMED_ROLES.has(role) && el.tagName !== "BUTTON") {
      continue;
    }
    const name = accessibleName(el);
    if (name === "") {
      out.push({ rule: 1, site: site(el), detail: "empty name" });
      continue;
    }
    if (labelInName) {
      for (const part of drawnParts(el)) {
        if (squash(name).includes(part)) continue;
        out.push({
          rule: 3,
          site: site(el),
          detail: `name "${name}" lacks drawn text "${part}"`,
        });
      }
    }
  }
  for (const el of Array.from(root.querySelectorAll("[aria-label]"))) {
    if (
      el.hasAttribute("role") ||
      LABELLABLE_TAGS.has(el.tagName.toLowerCase())
    ) {
      continue;
    }
    out.push({
      rule: 2,
      site: site(el),
      detail: `aria-label "${el.getAttribute("aria-label")}" on a roleless element`,
    });
  }
  return out;
}

const noop = () => {};

interface Surface {
  name: string;
  build: () => ReactElement[] | Promise<ReactElement[]>;
  /** Rule 3 off, with the reason beside the entry. */
  labelInName?: false;
}

const STATUSES: ChapterRowStatus[] = [
  "rest",
  "loading",
  "playing",
  "paused",
  "failed",
];

const SURFACES: Surface[] = [
  {
    name: "Control",
    build: () => [
      createElement(Control, { icon: "retry", label: "Try again" }),
      createElement(Control, {
        icon: "retry",
        label: "Try again",
        caption: "Try again",
        pressed: false,
        busy: true,
      }),
      createElement(Control, {
        icon: "retry",
        label: "Try again",
        disabled: true,
        hint: { label: "Nothing to retry" },
      }),
    ],
  },
  {
    name: "SettingRow",
    build: () => [
      createElement(SettingRow, {
        icon: "hear",
        label: "Sound",
        on: true,
        onClick: noop,
      }),
      createElement(SettingRow, {
        icon: "hear",
        label: "Sound",
        on: false,
        onClick: noop,
      }),
      createElement(SettingRow, {
        icon: "hear",
        label: "Theme",
        onClick: noop,
      }),
    ],
  },
  {
    name: "TemplateList",
    build: async () => [
      createElement(TemplateList, {
        entries: [await loadObsTemplate()],
        base: "/",
        language: "en",
        busy: false,
        onPick: noop,
      }),
    ],
  },
  {
    name: "LicenceAsk",
    build: () => [
      createElement(LicenceAsk, {
        onContinue: noop,
        onCancel: noop,
        saving: false,
        error: null,
      }),
      createElement(LicenceAsk, {
        onContinue: noop,
        onCancel: noop,
        saving: false,
        error: null,
        change: { current: "CC-BY-4.0" },
      }),
    ],
  },
  {
    name: "O4BookDeleteAsk",
    build: () => [
      createElement(O4BookDeleteAsk, {
        name: "Mark",
        coverHex: "#2a9d8f",
        busy: false,
        keepRef: noop,
        onKeep: noop,
        onDelete: noop,
      }),
    ],
  },
  {
    name: "ChapterPlayControl",
    build: () => [
      ...STATUSES.map((status) =>
        createElement(ChapterPlayControl, {
          heading: "Chapter 1",
          recordedCount: 2,
          status,
          pausedFraction: status === "paused" ? 0.4 : null,
          onPress: noop,
          readProgress: () => null,
        })
      ),
      createElement(ChapterPlayControl, {
        heading: "Chapter 1",
        recordedCount: 0,
        status: "rest",
        pausedFraction: null,
        onPress: noop,
        readProgress: () => null,
      }),
    ],
  },
  {
    name: "CoverPicker",
    build: () => [
      createElement(CoverPicker, { selected: "teal", onSelect: noop }),
      createElement(CoverPicker, { selected: null, onSelect: noop }),
    ],
  },
  {
    name: "LanguageAsk",
    // Rule 3 off: a row draws the autonym (for example "français") but is
    // named by the English name and tag ("French, fr"), so the autonym is not
    // in the name. Whether that is intended is #1718's call; the gap stays
    // named here rather than hidden. Rules 1 and 2 still apply.
    labelInName: false,
    build: () => [
      createElement(LanguageAsk, {
        state: {
          kind: "ready",
          list: indexLanguageList({
            source: "SIL langtags test",
            languages: [
              ["en", "English"],
              ["fr", "French", "français"],
            ],
          }),
        },
        onRetry: noop,
        onPick: noop,
        onCancel: noop,
        saving: false,
        error: null,
      }),
    ],
  },
];

afterAll(() => installLocale(SHIPPED_LOCALE));

describe("the gate itself, in both states", () => {
  it("is red on an empty name, a roleless label and a name that drops drawn text", () => {
    const bad = render(
      createElement("div", null, [
        createElement("button", { key: "a", type: "button" }),
        createElement("span", { key: "b", "aria-label": "Licence" }, "CC"),
        createElement(
          "button",
          { key: "c", type: "button", "aria-label": "Open" },
          "Open Bible Stories"
        ),
        createElement("div", {
          key: "d",
          role: "radio",
          "aria-checked": false,
        }),
      ])
    );
    expect(
      findings(bad)
        .map((f) => f.rule)
        .sort()
    ).toEqual([1, 1, 2, 3]);
  });

  it("is green on a labelled group, a named radio and a name that holds its text", () => {
    const good = render(
      createElement(
        "div",
        { role: "group", "aria-label": "Licence" },
        createElement(
          "button",
          { type: "button", "aria-label": "Open Bible Stories, licence" },
          "Open Bible Stories"
        ),
        createElement("div", {
          role: "radio",
          "aria-checked": true,
          "aria-label": "CC0",
        })
      )
    );
    expect(findings(good)).toEqual([]);
  });

  it("does not count screen-reader-only text as drawn", () => {
    const root = render(
      createElement(
        "button",
        { type: "button", "aria-label": "Keep" },
        createElement("span", { className: "sr-only" }, "Delete this book?"),
        "Keep"
      )
    );
    expect(findings(root)).toEqual([]);
  });

  it("names from exposed text: aria-hidden is not a name, sr-only text is", () => {
    const hiddenOnly = render(
      createElement(
        "button",
        { type: "button", "aria-label": "" },
        createElement("span", { "aria-hidden": "true" }, "Try again")
      )
    );
    expect(findings(hiddenOnly).map((f) => f.rule)).toEqual([1]);
    const srOnly = render(
      createElement(
        "button",
        { type: "button" },
        createElement("span", { className: "sr-only" }, "Delete")
      )
    );
    expect(findings(srOnly)).toEqual([]);
  });

  it("reads a native image: no alt is red, alt or alt=\"\" or presentation is clean", () => {
    const img = (props: Record<string, string>) =>
      render(createElement("div", null, createElement("img", props)));
    expect(findings(img({ src: "a.png" })).map((f) => f.rule)).toEqual([1]);
    expect(findings(img({ src: "a.png", title: "Cover" }))).toEqual([]);
    expect(findings(img({ src: "a.png", alt: "" }))).toEqual([]);
    expect(findings(img({ src: "a.png", alt: "", title: "x" }))).toEqual([]);
    expect(findings(img({ src: "a.png", alt: "Cover" }))).toEqual([]);
    expect(findings(img({ src: "a.png", role: "presentation" }))).toEqual([]);
    expect(findings(img({ src: "a.png", role: "none" }))).toEqual([]);
  });
});

describe("every surface the audit touched carries full accessible names", () => {
  for (const surface of SURFACES) {
    it(`${surface.name}, in English and every complete language`, async () => {
      const elements = await surface.build();
      const all: string[] = [];
      // An empty locale list would make `toEqual([])` below pass vacuously.
      expect(completeLocales().length).toBeGreaterThan(0);
      for (const locale of completeLocales()) {
        installLocale(locale);
        for (const element of elements) {
          for (const f of findings(
            render(element),
            surface.labelInName !== false
          )) {
            all.push(
              `${surface.name} [${locale.tag}] rule ${f.rule} ${f.site}: ${f.detail}`
            );
          }
        }
      }
      expect(all).toEqual([]);
    });
  }
});
