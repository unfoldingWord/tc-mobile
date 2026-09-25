import { readFileSync } from "node:fs";
import path from "node:path";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { recorderLook, type RecorderLook } from "@/components/recorder-look";
import { RecorderStamp } from "@/components/recorder-o4";
import { PlayheadOverlay } from "@/components/playhead-overlay";
import { render } from "./render";
import { cssRule, stripComments } from "./support";

/**
 * The O4 Recorder (#945, epic #936): states 08 idle, 09 recording, 10
 * recorded, 11 playing and 12 editing, behind the `data-design="o4"` switch.
 *
 * Three halves, each read the way this repo already reads its kind:
 *
 * - the stylesheet, `src/app/styles/o4/recorder.css`, by `cssRule` (block
 *   comments stripped first, so prose naming a selector cannot be the match —
 *   AGENTS.md's #529 trap) plus a whole-file scope and colour-boundary sweep
 *   that matches declarations, not bare identifiers;
 * - the one new piece of markup, `RecorderStamp`, through `tests/render.ts`
 *   for the static states and a jsdom client root for the playing clock;
 * - `recorder.tsx`'s wiring, by a source pin, because the sheet mounts the
 *   audio hook graph and no test renders it (`tests/render.ts`'s docblock).
 *
 * What none of this covers: the cascade in a real engine, and any phone.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
/**
 * The stylesheet with block comments gone and every rule's selector on one
 * line: Prettier wraps a long selector across lines, and `cssRule` matches a
 * selector on the line that opens its block.
 */
function flatten(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(
      /([;{}])\s*([^;{}]+?)\s*\{/g,
      (_, end: string, sel: string) =>
        `${end}\n  ${sel.replace(/\s+/g, " ").trim()} {`
    );
}
const CSS = flatten(read("src/app/styles/o4/recorder.css"));
const O4 = '[data-design="o4"]';

/** Every selector list that opens a style rule (not an at-rule). */
function ruleSelectors(css: string): string[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...stripped.matchAll(/([^{};]+)\{/g)]
    .map((m) => (m[1] ?? "").trim())
    .filter((s) => s !== "" && !s.startsWith("@"));
}

describe("o4/recorder.css is scoped and stays on the colour roles (#945)", () => {
  const selectors = ruleSelectors(CSS);

  it("has the rules this lane adds (non-emptiness floor)", () => {
    expect(selectors.length).toBeGreaterThanOrEqual(10);
  });

  it("scopes every selector in every list under the switch", () => {
    // With the switch off nothing here may match (#936, "Behind a switch").
    for (const list of selectors)
      for (const sel of list.split(","))
        expect(sel.trim().startsWith(`${O4} `), sel).toBe(true);
  });

  it("reads colour only through layer-2 roles, never a primitive or a literal", () => {
    const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    const values = [...stripped.matchAll(/[\w-]+\s*:\s*([^;{}]+);/g)].map(
      (m) => m[1] ?? ""
    );
    expect(values.length).toBeGreaterThanOrEqual(20);
    for (const v of values) {
      expect(v, v).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(v, v).not.toMatch(/\b(rgb|rgba|hsl|hsla|oklch)\(/i);
      for (const [, name] of v.matchAll(/var\((--[\w-]+)/g))
        expect(name, v).toMatch(
          /^--(s-|c-|o4-|p-(space|radius|text|weight|dur|ease))/
        );
    }
  });
});

describe("the O4 recorder values (#945, design reference §2–§3)", () => {
  it("08–12 stage: radius 20 on the surface role", () => {
    const stage = cssRule(CSS, `${O4} .recorder-stage`);
    expect(stage).toMatch(/border-radius:\s*20px/);
    expect(stage).toMatch(/background:\s*var\(--s-surface\)/);
  });

  it("09 recording: the stage wears a live edge — static; the loop is #950's", () => {
    const edge = cssRule(
      CSS,
      `${O4} .recorder-stage[data-o4-look="recording"]::after`
    );
    expect(edge).toMatch(/box-shadow:\s*inset 0 0 0 2px var\(--s-live\)/);
    expect(edge).not.toMatch(/animation/);
  });

  it("09 recording: timer at 32/800 with tabular numerals", () => {
    const timer = cssRule(CSS, `${O4} .recorder-status .t-timer`);
    expect(timer).toMatch(/font-size:\s*32px/);
    expect(timer).toMatch(/font-weight:\s*800/);
    expect(timer).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  it("10/11: the timestamp is mono at 15/500 with tabular numerals", () => {
    const stamp = cssRule(CSS, `${O4} .recorder-stamp`);
    expect(stamp).toMatch(/font-size:\s*15px/);
    expect(stamp).toMatch(/font-weight:\s*500/);
    expect(stamp).toMatch(/font-family:\s*ui-monospace/);
    expect(stamp).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });

  it("11 playing: both playheads read --s-playhead", () => {
    // The scrolling play's playhead IS the centerline (#415); the in-place
    // audition's is `PlayheadOverlay`, recoloured by a utility class instead
    // (see the recorder.tsx pin below) because `bg-ink` is a utility and a
    // components-layer rule cannot beat it.
    const line = cssRule(
      CSS,
      `${O4} .recorder-stage[data-o4-look="playing"] [data-testid="centerline-overlay"]::after`
    );
    expect(line).toMatch(/background:\s*var\(--s-playhead\)/);
  });

  it("12 editing: trim handles are 30 × 56, radius 15, on --s-voice", () => {
    expect(cssRule(CSS, `${O4} .selection-handle`)).toMatch(
      /--c-selection-hit:\s*30px/
    );
    const knob = cssRule(CSS, `${O4} .selection-handle::after`);
    expect(knob).toMatch(/width:\s*30px/);
    expect(knob).toMatch(/height:\s*56px/);
    expect(knob).toMatch(/border-radius:\s*15px/);
    expect(knob).toMatch(/background:\s*var\(--s-voice\)/);
  });

  it("the big transport buttons are 80 × 80, shrinking no lower than the 44 floor", () => {
    const pair = cssRule(CSS, `${O4} .recorder-toolbar.pair`);
    expect(pair).toMatch(/container-type:\s*inline-size/);
    expect(pair).toMatch(/--o4-big:\s*max\(\s*44px,\s*min\(80px,/);
    for (const variant of ["control--record", "control--play"]) {
      const big = cssRule(CSS, `${O4} .recorder-toolbar.pair .${variant}`);
      expect(big, variant).toMatch(/width:\s*var\(--o4-big\)/);
      expect(big, variant).toMatch(/height:\s*var\(--o4-big\)/);
    }
  });

  it("the secondary transport is 64, on the well", () => {
    const pair = cssRule(
      CSS,
      `${O4} .recorder-toolbar.pair .control:not(.control--record):not(.control--play)`
    );
    expect(pair).toMatch(/width:\s*64px/);
    expect(pair).toMatch(/height:\s*64px/);
    expect(pair).toMatch(/background:\s*var\(--s-well\)/);
    const bar = cssRule(CSS, `${O4} .recorder-toolbar.edit`);
    expect(bar).toMatch(/--o4-secondary:\s*max\(\s*44px,\s*min\(64px,/);
    const edit = cssRule(CSS, `${O4} .recorder-toolbar.edit .control`);
    expect(edit).toMatch(/width:\s*var\(--o4-secondary\)/);
    expect(edit).toMatch(/height:\s*var\(--o4-secondary\)/);
    expect(edit).toMatch(/background:\s*var\(--s-well\)/);
  });

  it("the edit toggle keeps its size and vertical centre across the mode flip", () => {
    // 3-components.css gives both bars one height so the toggle (the last,
    // key="edit-toggle" control in both) does not move when the mode flips.
    // O4 keeps that, and keeps the toggle at the pair's 64 in the edit bar.
    const height = (sel: string) =>
      /(?:^|;)\s*height:\s*([^;]+);/.exec(cssRule(CSS, sel))?.[1]?.trim();
    const pair = height(`${O4} .recorder-toolbar.pair`);
    expect(pair).toBeDefined();
    expect(height(`${O4} .recorder-toolbar.edit`)).toBe(pair);
    const toggle = cssRule(
      CSS,
      `${O4} .recorder-toolbar.edit > .control-hinted:last-child .control`
    );
    expect(toggle).toMatch(/width:\s*64px/);
    expect(toggle).toMatch(/height:\s*64px/);
  });

  it("sets no ink on the transport, so the pressed toggle's is-on ink still wins", () => {
    for (const sel of [
      `${O4} .recorder-toolbar.pair .control:not(.control--record):not(.control--play)`,
      `${O4} .recorder-toolbar.edit .control`,
    ])
      expect(cssRule(CSS, sel), sel).not.toMatch(/(^|[\s;])color\s*:/);
  });

  it("leaves the greyed-control rules alone (#857/#878): no opacity or filter here", () => {
    // The inert look is `3-components.css`'s `.control:disabled` /
    // `[aria-disabled]` dim and desaturate. Overriding opacity or filter in
    // O4 would un-grey a control the current look greys.
    const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(stripped).not.toMatch(/(^|[\s;{])opacity\s*:/);
    expect(stripped).not.toMatch(/(^|[\s;{])filter\s*:/);
  });
});

describe("recorderLook (#945): which O4 state the stage is in", () => {
  const base = {
    recording: false,
    playing: false,
    editing: false,
    hasAudio: false,
  };
  const cases: [Partial<typeof base>, RecorderLook][] = [
    [{}, "idle"],
    [{ recording: true }, "recording"],
    [{ hasAudio: true }, "recorded"],
    [{ hasAudio: true, playing: true }, "playing"],
    [{ hasAudio: true, editing: true }, "editing"],
    // An edit-mode audition is a playing state (workbench: trim -> play).
    [{ hasAudio: true, editing: true, playing: true }, "playing"],
    // A re-record over existing audio is recording, whatever else is true.
    [{ hasAudio: true, recording: true }, "recording"],
  ];
  for (const [over, want] of cases)
    it(`${JSON.stringify(over)} -> ${want}`, () => {
      expect(recorderLook({ ...base, ...over })).toBe(want);
    });
});

describe("RecorderStamp (#945): the mono timestamp, 10 recorded and 11 playing", () => {
  const read = () => null;

  it("renders nothing with the switch off, in every state", () => {
    for (const look of [
      "idle",
      "recording",
      "recorded",
      "playing",
      "editing",
    ] as const) {
      const c = render(
        createElement(RecorderStamp, {
          design: "current",
          look,
          durationMs: 65_000,
          readElapsedMs: read,
        })
      );
      expect(c.innerHTML, look).toBe("");
    }
  });

  it("renders nothing in O4's idle, recording and editing states", () => {
    for (const look of ["idle", "recording", "editing"] as const) {
      const c = render(
        createElement(RecorderStamp, {
          design: "o4",
          look,
          durationMs: 65_000,
          readElapsedMs: read,
        })
      );
      expect(c.innerHTML, look).toBe("");
    }
  });

  it("10 recorded: shows the duration, hidden from assistive tech", () => {
    const c = render(
      createElement(RecorderStamp, {
        design: "o4",
        look: "recorded",
        durationMs: 65_000,
        readElapsedMs: read,
      })
    );
    const stamp = c.querySelector(".recorder-stamp");
    expect(stamp?.textContent).toBe("01:05");
    // Same accessibility tree in both looks (#936 brief): the stamp is a
    // visual echo of what the controls already say.
    expect(stamp?.getAttribute("aria-hidden")).toBe("true");
  });

  it("11 playing: position / duration, starting at zero", () => {
    const c = render(
      createElement(RecorderStamp, {
        design: "o4",
        look: "playing",
        durationMs: 65_000,
        readElapsedMs: read,
      })
    );
    expect(c.querySelector(".recorder-stamp")?.textContent).toBe(
      "00:00 / 01:05"
    );
  });
});

describe("RecorderStamp's playing clock pulls the position on rAF (#945)", () => {
  let dom: JSDOM;
  let root: Root;
  let frames: FrameRequestCallback[];

  beforeEach(() => {
    dom = new JSDOM(
      "<!doctype html><html><body><div id='r'></div></body></html>"
    );
    frames = [];
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    root = createRoot(dom.window.document.getElementById("r")!);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    vi.unstubAllGlobals();
  });

  function runFrame() {
    const pending = frames;
    frames = [];
    for (const cb of pending) cb(0);
  }

  it("writes the sounding position each frame, and keeps the last on a null read", async () => {
    let ms: number | null = 12_400;
    await act(async () => {
      root.render(
        createElement(RecorderStamp, {
          design: "o4",
          look: "playing",
          durationMs: 65_000,
          readElapsedMs: () => ms,
        })
      );
    });
    const stamp = () =>
      dom.window.document.querySelector(".recorder-stamp")?.textContent;
    runFrame();
    expect(stamp()).toBe("00:12 / 01:05");
    ms = 30_900;
    runFrame();
    expect(stamp()).toBe("00:30 / 01:05");
    ms = null;
    runFrame();
    expect(stamp()).toBe("00:30 / 01:05");
  });

  it("runs no loop outside the playing state", async () => {
    await act(async () => {
      root.render(
        createElement(RecorderStamp, {
          design: "o4",
          look: "recorded",
          durationMs: 65_000,
          readElapsedMs: () => 1_000,
        })
      );
    });
    expect(frames.length).toBe(0);
  });
});

describe("PlayheadOverlay takes the O4 playhead colour over its own (#945)", () => {
  it("bg-playhead replaces bg-ink rather than sitting beside it", () => {
    // Two background utilities on one element would be decided by Tailwind's
    // own emit order, not by intent; `cn`'s tailwind-merge must drop bg-ink.
    const c = render(
      createElement(PlayheadOverlay, {
        readElapsedMs: () => null,
        active: false,
        durationMs: 1_000,
        startFraction: 0,
        endFraction: 1,
        clampToEdge: false,
        className: "bg-playhead",
      })
    );
    const line = c.firstElementChild!;
    expect(line.classList.contains("bg-playhead")).toBe(true);
    expect(line.classList.contains("bg-ink")).toBe(false);
  });
});

describe("recorder.tsx wires the O4 look through useDesign (#945, source pin)", () => {
  // The sheet mounts the audio hook graph and no test renders it, so the
  // wiring is pinned by source — the precedent is
  // `tests/recorder-cut-collapse.test.ts`'s "passes the clipboard's fullness".
  const src = stripComments(read("src/components/recorder.tsx"));

  it("reads the design from the hook", () => {
    expect(src).toMatch(/const \{ design \} = useDesign\(\);/);
  });

  it("marks the stage with its look only under O4, so the current markup is unchanged", () => {
    expect(src).toMatch(
      /className="recorder-stage flex-1"\s+data-o4-look=\{design === "o4" \? look : undefined\}/
    );
  });

  it("recolours the in-place playhead only under O4", () => {
    const at = src.indexOf("<PlayheadOverlay");
    expect(at).toBeGreaterThan(-1);
    const tag = src.slice(at, src.indexOf("/>", at));
    expect(tag).toMatch(
      /className=\{design === "o4" \? "bg-playhead" : undefined\}/
    );
  });

  it("feeds recorderLook the live recording, playing, editing and audio state", () => {
    const at = src.indexOf("recorderLook({");
    expect(at).toBeGreaterThan(-1);
    const call = src.slice(at, src.indexOf("})", at));
    expect(call).toMatch(/\brecording,/);
    expect(call).toMatch(/\bplaying: audio\.playingBuffer,/);
    expect(call).toMatch(/\bediting: mode === "edit",/);
    expect(call).toMatch(/\bhasAudio,?\s*$/);
  });

  it("keeps the edit toggle last in the edit bar and hint-wrapped", () => {
    // The O4 toggle rule targets `> .control-hinted:last-child .control`,
    // which holds only while the toggle passes `hint` (so Control wraps it)
    // and stays the edit arm's last child.
    const bars = stripComments(read("src/components/recorder-toolbars.tsx"));
    const edit = bars.slice(bars.indexOf('className="recorder-toolbar edit'));
    const last = edit.slice(
      edit.lastIndexOf("<Control", edit.indexOf("</div>")),
      edit.indexOf("</div>")
    );
    expect(last).toMatch(/key="edit-toggle"/);
    expect(last).toMatch(/hint=\{null\}/);
  });

  it("mounts the stamp inside the stage with the live design and look", () => {
    const at = src.indexOf("<RecorderStamp");
    expect(at).toBeGreaterThan(
      src.indexOf('className="recorder-stage flex-1"')
    );
    const tag = src.slice(at, src.indexOf("/>", at));
    expect(tag).toMatch(/design=\{design\}/);
    expect(tag).toMatch(/look=\{look\}/);
    expect(tag).toMatch(/durationMs=\{drawnDurationMs\}/);
    expect(tag).toMatch(/readElapsedMs=\{readSoundingElapsed\}/);
  });
});
