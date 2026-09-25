import { readFileSync } from "node:fs";
import path from "node:path";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SegmentRow } from "@/components/segment-row";
import { SegmentsHead } from "@/components/segments-head";
import type { Design } from "@/lib/design";
import { strings } from "@/lib/strings";
import type { ClipId, SegmentId } from "@/types/domain";
import type { SegmentRow as Row } from "@/types/view";

import { one, render } from "./render";

/**
 * The O4 Segments screen (#944, epic #936): states 05 (empty chapter), 06
 * (chapter with segments) and G10 (adding a segment).
 *
 * The switch is read through `useDesign()`, mocked here so each case picks its
 * look — the pattern `tests/use-design.test.ts` points at. The current look is
 * asserted beside O4 in every case that could drift, because "switch off means
 * unchanged" is half of what this lane promises; the existing SegmentRow suites
 * run against the real hook (which answers "current" in Node) unedited.
 *
 * What this file does NOT cover: the cascade. It proves the markup each look
 * emits and that `o4/segments.css` holds scoped rules with the issue's values;
 * whether those rules win on a real page is a browser question, and nothing
 * here has been run on a phone.
 */

const design = vi.hoisted(() => ({ current: "current" as Design }));
vi.mock("@/hooks/use-design", () => ({
  useDesign: () => ({ design: design.current, toggle: () => {} }),
}));

const recorded: Row = {
  segmentId: "segment-3" as SegmentId,
  ordinal: 3,
  label: null,
  hasClip: true,
  finished: false,
  clipId: "clip-3" as ClipId,
  peaks: null,
  durationMs: 1000,
};
const finished: Row = { ...recorded, finished: true };
const empty: Row = {
  ...recorded,
  hasClip: false,
  clipId: null,
  durationMs: null,
};
const titled: Row = { ...recorded, label: "verses 3–4" };

function rowProps(row: Row, extra: Record<string, unknown> = {}) {
  return {
    row,
    playing: false,
    playbackElapsedMs: 0,
    onPlay: () => {},
    onOpenRecorder: () => {},
    onSetFinished: () => {},
    onErase: () => {},
    onRename: () => Promise.resolve(true),
    ...extra,
  };
}

function renderRow(look: Design, row: Row, extra?: Record<string, unknown>) {
  design.current = look;
  return render(createElement(SegmentRow, rowProps(row, extra)));
}

/** Every accessible name the row exposes, in document order, with its role. */
function names(container: Element): string[] {
  return [...container.querySelectorAll("[aria-label]")]
    .filter((el) => el.closest("[aria-hidden='true']") === null)
    .map(
      (el) =>
        `${el.getAttribute("role") ?? el.tagName.toLowerCase()}:${el.getAttribute("aria-label")}`
    );
}

afterEach(() => {
  design.current = "current";
});

describe("O4 segment row (#944)", () => {
  it("puts the ordinal in a 44 badge on every row state, finished included (#591, #81)", () => {
    for (const row of [recorded, empty, finished, titled]) {
      const container = renderRow("o4", row);
      expect(one(container, ".row-badge").textContent).toBe("3");
    }
    const done = renderRow("o4", finished);
    expect(one(done, ".row").classList.contains("row--finished")).toBe(true);
  });

  it("shows a typed title as a 22px line over a 36px wave, and a 56px wave without one", () => {
    const withTitle = renderRow("o4", titled);
    const title = one(withTitle, ".row-title");
    expect(title.textContent).toBe("verses 3–4");
    // The open button's name already carries the label (#591), so the line
    // is visual only and adds nothing to the reading order.
    expect(title.getAttribute("aria-hidden")).toBe("true");
    expect((one(withTitle, "canvas") as HTMLCanvasElement).style.height).toBe(
      "36px"
    );

    const without = renderRow("o4", recorded);
    expect(without.querySelector(".row-title")).toBeNull();
    expect((one(without, "canvas") as HTMLCanvasElement).style.height).toBe(
      "56px"
    );
  });

  it("marks the played fraction on the scrub while playing, and only then", () => {
    const playing = renderRow("o4", recorded, {
      playing: true,
      playbackElapsedMs: 250,
    });
    const scrub = one(playing, ".scrub") as HTMLElement;
    expect(scrub.classList.contains("scrub--playing")).toBe(true);
    expect(scrub.style.getPropertyValue("--row-played")).toBe("25%");

    const idle = one(renderRow("o4", recorded), ".scrub") as HTMLElement;
    expect(idle.classList.contains("scrub--playing")).toBe(false);
  });

  it("exposes the same accessible names in both looks", () => {
    for (const row of [recorded, empty, finished, titled]) {
      const current = names(renderRow("current", row));
      const o4 = names(renderRow("o4", row));
      expect(current.length).toBeGreaterThanOrEqual(3);
      expect(o4).toEqual(current);
    }
  });

  it("keeps the guided ring on the empty row's Record in O4 (#604)", () => {
    const container = renderRow("o4", empty, { guided: true });
    const record = one(
      container,
      `button[aria-label="${strings.recordSegment(3)}"]`
    );
    expect(record.classList.contains("is-guided")).toBe(true);
  });

  it("leaves the current look's markup alone", () => {
    const container = renderRow("current", titled);
    expect(container.querySelector(".row-badge")).toBeNull();
    expect(container.querySelector(".row-title")).toBeNull();
    expect(container.querySelector(".row-mid")).toBeNull();
    expect(one(container, ".row-heading").textContent).toBe("3 · verses 3–4");
    expect((one(container, "canvas") as HTMLCanvasElement).style.height).toBe(
      "26px"
    );
    const playing = one(
      renderRow("current", recorded, { playing: true, playbackElapsedMs: 250 }),
      ".scrub"
    ) as HTMLElement;
    expect(playing.classList.contains("scrub--playing")).toBe(false);
    expect(playing.style.getPropertyValue("--row-played")).toBe("");
  });
});

describe("O4 selected row (#944)", () => {
  let dom: JSDOM;
  let root: Root;

  beforeEach(() => {
    dom = new JSDOM(
      "<!doctype html><html><body><div id='root'></div></body></html>"
    );
    vi.spyOn(
      dom.window.HTMLCanvasElement.prototype,
      "getContext"
    ).mockReturnValue(null);
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    root = createRoot(dom.window.document.getElementById("root")!);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    vi.unstubAllGlobals();
  });

  async function openMenu(look: Design): Promise<Element> {
    design.current = look;
    await act(async () => {
      root.render(createElement(SegmentRow, rowProps(recorded)));
    });
    const row = dom.window.document.querySelector(".row")!;
    expect(row.classList.contains("row--selected")).toBe(false);
    const more = [...dom.window.document.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === strings.segmentMenu(3)
    );
    expect(more).toBeDefined();
    await act(async () => more!.click());
    return row;
  }

  it("outlines the row whose menu is open in O4", async () => {
    const row = await openMenu("o4");
    expect(row.classList.contains("row--selected")).toBe(true);
  });

  it("does not add the class in the current look", async () => {
    const row = await openMenu("current");
    expect(row.classList.contains("row--selected")).toBe(false);
  });
});

describe("O4 chapter head (#944)", () => {
  const rows: Row[] = [
    { ...empty, segmentId: "a" as SegmentId, ordinal: 1 },
    { ...recorded, segmentId: "b" as SegmentId, ordinal: 2 },
    { ...finished, segmentId: "c" as SegmentId, ordinal: 3 },
  ];

  it("shows the typed chapter title over a progress mark per segment", () => {
    const container = render(
      createElement(SegmentsHead, { chapterName: "The sower", rows })
    );
    expect(one(container, ".segments-title").textContent).toBe("The sower");
    const marks = [...container.querySelectorAll(".segments-mark")];
    expect(marks.map((m) => m.getAttribute("data-state"))).toEqual([
      "empty",
      "recorded",
      "finished",
    ]);
    // Decoration: the breadcrumb already names the chapter, and each row
    // already names its own state.
    expect(one(container, ".segments-head").getAttribute("aria-hidden")).toBe(
      "true"
    );
  });

  it("has no title line without a typed name, and one empty mark for an empty chapter", () => {
    const container = render(
      createElement(SegmentsHead, { chapterName: null, rows: [] })
    );
    expect(container.querySelector(".segments-title")).toBeNull();
    const marks = [...container.querySelectorAll(".segments-mark")];
    expect(marks.map((m) => m.getAttribute("data-state"))).toEqual(["empty"]);
  });
});

describe("o4/segments.css (#944)", () => {
  const source = readFileSync(
    path.resolve(import.meta.dirname, "../src/app/styles/o4/segments.css"),
    "utf8"
  );
  // Comments stripped first: a header that names a selector or a primitive
  // must not satisfy, or trip, a check below (AGENTS.md, the share-scrim trap).
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const layerOpen = code.indexOf("@layer components {");
  const body = code.slice(layerOpen + "@layer components {".length);
  const rules = [...body.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1]!
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    declarations: m[2]!
      .split(";")
      .map((d) => d.replace(/\s+/g, " ").trim())
      .filter(Boolean),
  }));

  /** The declarations of the one rule whose selector list includes `sel`. */
  function block(sel: string): string[] {
    const hits = rules.filter((r) => r.selectors.includes(sel));
    expect(hits, sel).toHaveLength(1);
    return hits[0]!.declarations;
  }

  it("holds its rules inside the components layer", () => {
    expect(layerOpen).toBeGreaterThanOrEqual(0);
    expect(rules.length).toBeGreaterThanOrEqual(10);
  });

  it("scopes every selector under the switch", () => {
    for (const rule of rules) {
      for (const sel of rule.selectors) {
        expect(sel.startsWith('[data-design="o4"] '), sel).toBe(true);
      }
    }
  });

  it("reads colour only through layer-2 roles", () => {
    const values = rules.flatMap((r) => r.declarations);
    expect(values.length).toBeGreaterThanOrEqual(30);
    for (const decl of values) {
      expect(decl, decl).not.toMatch(/var\(--p-/);
      expect(decl, decl).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });

  it("carries the issue's geometry and roles", () => {
    const O4 = '[data-design="o4"]';
    const row = block(`${O4} .row`);
    expect(row).toEqual(
      expect.arrayContaining(["min-height: 90px", "border-radius: 16px"])
    );
    // The `--s-surface` ground stays layer 3's: an O4 background on `.row`
    // would out-specify the finished row's wash (#81).
    expect(row.some((d) => d.startsWith("background"))).toBe(false);
    expect(block(`${O4} .row:not(.row--finished)`)).toContain(
      "border-color: var(--s-card-edge)"
    );
    expect(block(`${O4} .row--selected`)).toContain(
      "outline: 2px solid var(--s-guide)"
    );
    expect(block(`${O4} .row-badge`)).toEqual(
      expect.arrayContaining([
        "width: 44px",
        "height: 44px",
        "background: var(--s-well)",
      ])
    );
    expect(block(`${O4} .row--finished .row-badge`)).toContain(
      "background: var(--s-done)"
    );
    expect(block(`${O4} .row .control--play`)).toEqual(
      expect.arrayContaining(["width: 72px", "height: 72px"])
    );
    expect(block(`${O4} .row .control--record`)).toEqual(
      expect.arrayContaining(["width: 72px", "height: 72px"])
    );
    expect(block(`${O4} .row-title`)).toEqual(
      expect.arrayContaining(["height: 22px"])
    );
    expect(block(`${O4} .segments-title`)).toEqual(
      expect.arrayContaining(["font-size: 22px", "font-weight: 800"])
    );
    expect(block(`${O4} .scrub--playing canvas`).join(";")).toMatch(
      /(^|;)mask-image: linear-gradient\( ?to right, black var\(--row-played\), var\(--s-voice-dim\) var\(--row-played\) ?\)/
    );
  });
});
