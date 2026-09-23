import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  panAfterCutCollapse,
  selectionReseed,
} from "@/components/recorder-stage";

/**
 * #613: after a cut, the selection band collapses to the red centerline at the
 * cut point — the sample a paste will be inserted at — and the scissors leaves.
 *
 * The state the requirements owner saw on v0.2.9 was not `cut()` failing to
 * clear the frame: `useSegmentEditor.cut` has always ended in
 * `clearSelection()`. It was `recorder.tsx`'s render-time reseed, which opens a
 * fresh span around the insertion pan on ANY edit-mode render with no frame
 * open — so the band the cut had just dropped was re-drawn in the same commit,
 * with the scissors live over it and the centerline hidden underneath
 * (`centerlineOverlayShown` is false while a frame is open). That reseed is
 * what `selectionReseed`'s `collapsedByCut` term suspends.
 *
 * Both halves are pure or source-shape on purpose: `recorder.tsx` cannot be
 * rendered here (AGENTS.md — the #197 harness is one component, no effects),
 * so the truth table is a function and the wiring is read as text, the same
 * split `tests/recorder-centerline-overlay-gate.test.ts` uses.
 */

const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const read = (rel: string) =>
  readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

const recorder = stripComments(read("src/components/recorder.tsx"));

describe("panAfterCutCollapse — the line lands on the cut point (#613)", () => {
  it("puts the line at the cut's start, wherever the pan was before it", () => {
    // The pan that #473's `panAfterCutRest` preserved: entirely before the
    // removed span, so the old rule left it at 2_000. The paste target is the
    // cut point, so the line moves there instead.
    expect(panAfterCutCollapse({ start: 5_000, end: 6_000 }, 10_000)).toBe(
      5_000
    );
  });

  it("rests — null, not the number newLength — when the cut ran to the end (#442/#473)", () => {
    // #473's own repro, and the invariant that survives the rule change: a cut
    // to the end leaves the cut point AT the new length, where an absolute
    // index goes stale the moment anything is pasted or appended and the next
    // Record punches into the new audio instead of following it.
    expect(
      panAfterCutCollapse({ start: 8_000, end: 10_000 }, 10_000)
    ).toBeNull();
  });

  it("truncates a fractional boundary the way `sliceRange` does, on BOTH terms", () => {
    // Selection edges are floats; `cut`/`sliceRange` truncate via
    // `Int16Array.slice`. The cut point is the truncated start, and the
    // post-cut length is derived from the truncated span — a raw
    // `10_000 - 8_000.4` would leave the rest clamp a fraction off.
    expect(
      panAfterCutCollapse({ start: 8_000.4, end: 10_000 }, 10_000)
    ).toBeNull();
    expect(panAfterCutCollapse({ start: 2_000.7, end: 4_000.2 }, 10_000)).toBe(
      2_000
    );
  });

  it("a whole-buffer cut rests, and a cut from sample 0 lands on 0", () => {
    expect(panAfterCutCollapse({ start: 0, end: 10_000 }, 10_000)).toBeNull();
    expect(panAfterCutCollapse({ start: 0, end: 1 }, 10_000)).toBe(0);
  });
});

describe("selectionReseed — when the render-time frame is re-opened (#613)", () => {
  const base = {
    mode: "edit" as const,
    selectionActive: false,
    entrySettled: true,
    length: 10_000,
    collapsedByCut: false,
  };

  it("seeds a fresh span on an ordinary edit-mode render with no frame open", () => {
    expect(selectionReseed(base)).toBe("seed");
  });

  it("does NOT seed while a cut has collapsed the frame to the playhead", () => {
    // The #613 kill: with this term dropped the answer is "seed" and the band
    // comes straight back over the line the cut just left behind.
    expect(selectionReseed({ ...base, collapsedByCut: true })).toBe("clear");
  });

  it("recorder.tsx runs the entry-latch and zoom-fit clears outside the seed arm", () => {
    // "clear", not "none": the stale zoom fit must still go, or the paste
    // marker stays hidden (`zoomPan === null` gates it) on the very state
    // this change exists to make paste-ready. The enum answer is pinned
    // above; this pins the wiring — both resets follow the CLOSE of the
    // `reseed === "seed"` arm, inside `reseed !== "none"`.
    expect(recorder).toMatch(
      /if \(reseed !== "none"\) \{\s*if \(reseed === "seed"\) \{[\s\S]*?editor\.openSelection\(\{[\s\S]*?\}\);\s*\}\s*if \(selectionEntry\) setSelectionEntry\(null\);\s*if \(zoomPan !== null\) setZoomPan\(null\);\s*\}/
    );
  });

  it("is inert in record mode, with a frame already open, or before the committed buffer arrives", () => {
    expect(selectionReseed({ ...base, mode: "record" })).toBe("none");
    expect(selectionReseed({ ...base, selectionActive: true })).toBe("none");
    expect(selectionReseed({ ...base, entrySettled: false })).toBe("none");
  });

  it("clears rather than seeds on an empty buffer — there is no span to pick", () => {
    expect(selectionReseed({ ...base, length: 0 })).toBe("clear");
  });
});

describe("recorder.tsx wires the collapse (#613)", () => {
  const onCutBody = (() => {
    const at = recorder.indexOf("const onCut = useCallback(");
    expect(at, "no onCut in recorder.tsx").toBeGreaterThan(-1);
    const end = recorder.indexOf("const onPaste = useCallback(", at);
    expect(end).toBeGreaterThan(at);
    return recorder.slice(at, end);
  })();

  it("onCut moves the pan to the cut point and latches the collapse", () => {
    expect(onCutBody).toMatch(/panAfterCutCollapse\(/);
    expect(onCutBody).toMatch(/setCutCollapsed\(true\)/);
  });

  it("onCut no longer keeps the line on the old audio (the rule #613 replaced)", () => {
    expect(recorder).not.toMatch(/panAfterCutRest/);
  });

  it("the Cut control is mounted only while a frame is open, the way the paste marker is", () => {
    // "Drop the scissors": with no frame there is nothing to cut, so the
    // control leaves rather than sitting dimmed over a collapsed line. The
    // row around it stays mounted (reserved height, below) so the waveform
    // does not jump.
    const at = recorder.indexOf('<div className="recorder-cut');
    expect(at).toBeGreaterThan(-1);
    const block = recorder.slice(at, recorder.indexOf("</div>", at));
    expect(block).toMatch(/editor\.selectionActive &&/);
    expect(block).toMatch(/label=\{strings\.cut\}/);
  });

  it("a lift that resumes playback leaves the frame collapsed (#671 Frank R1 P2)", () => {
    // After a cut, Play sounds the tail from the line (no span: `scroll`), a
    // touch interrupts it, and the lift resumes `soundRange(from, length)`.
    // Reopening the frame on that same lift seeded a ±15% span, and
    // `stageView` then drew an in-place audition of that span while the
    // TAIL was what sounded. Only a lift that does not resume may reopen.
    const at = recorder.indexOf("const onPointerUp = useCallback(");
    expect(at, "no onPointerUp in recorder.tsx").toBeGreaterThan(-1);
    const end = recorder.indexOf("[length, soundRange", at);
    expect(end).toBeGreaterThan(at);
    const body = recorder.slice(at, end);
    expect(body).toMatch(/if \(outcome\.resume\) soundRange\(from, length\)/);
    expect(body).toMatch(/if \(wasOwner && !outcome\.resume\) reopenFrame\(\)/);
    expect(body).not.toMatch(/if \(wasOwner\) reopenFrame\(\)/);
  });

  it("everything that should bring the frame back clears the latch", () => {
    for (const handler of [
      "const onPaste = useCallback(",
      "const onUndo = useCallback(",
      "const onRedo = useCallback(",
      "const onExitEdit = useCallback(",
    ]) {
      const at = recorder.indexOf(handler);
      expect(at, `${handler} not found`).toBeGreaterThan(-1);
      const body = recorder.slice(at, at + 1_200);
      expect(body, `${handler} does not reopen the frame`).toMatch(
        /setCutCollapsed\(false\)|reopenFrame\(\)/
      );
    }
  });
});

describe("the Cut row reserves its height (#613)", () => {
  it(".recorder-cut holds the scissors' box whether or not the button is mounted", () => {
    // The paste row's lesson (#414 R3 P3): `.recorder-stage` is a centered
    // column, so a row that collapses when its child unmounts recenters the
    // group and the canvas jumps. `.recorder-paste` reserves its height for
    // exactly this reason; the Cut row now has a conditional child too.
    const css = read("src/app/styles/3-components.css");
    const start = css.indexOf("  .recorder-cut {");
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf("}", start));
    const declarations = [...block.matchAll(/([a-z-]+):\s*([^;]+);/g)];
    expect(declarations.length).toBeGreaterThanOrEqual(3);
    const minHeight = declarations.find(([, prop]) => prop === "min-height");
    expect(minHeight, ".recorder-cut reserves no height").toBeDefined();
    // Through the token, not a repeated `40px` — `--c-control-sm` is what
    // `.control--quiet` (the scissors) is sized by, and #362 is an open
    // question about changing it.
    expect(minHeight?.[2]).toMatch(/var\(--c-control-sm\)/);
    // ...and the row's own padding, which border-box counts INSIDE
    // `min-height`. Reserving the bare control box passed this assertion
    // while the canvas still moved 3px (jag3773 P3 on #671), which is why
    // the real gate is the canvas-bounds comparison in
    // `e2e/recorder-selection.spec.ts` and this only pins the declaration.
    expect(minHeight?.[2]).toMatch(/var\(--p-space-2\)/);
  });
});
