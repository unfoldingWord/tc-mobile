import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The `[ ]` control seeds its span through `seedSelection` (#554).
 *
 * The rule itself — left edge at the playhead, slid left only as far as the
 * end of the buffer forces — is pure geometry and is pinned as arithmetic in
 * `tests/audio-viewport.test.ts`. What that cannot see is whether the recorder
 * still computes its own seed: the component used to spell the span inline as
 * `win.centerlineSample ± win.visibleSamples * 0.15`, and a fix that left the
 * inline arithmetic in place beside a new library function would pass every
 * case over there while the app kept opening centred.
 *
 * Source-shape, for the reason `tests/recorder-cut-drag-gate.test.ts` is:
 * there is no DOM runner here (AGENTS.md), so the callback cannot be invoked
 * and its `openSelection` argument inspected — only read as text.
 *
 * It reads the callback's BODY, sliced out between its head and its dependency
 * array, never the whole file: a bare search for `0.15` across `recorder.tsx`
 * would hit any prose that mentioned the old rule, which is the #529 round-3
 * comment-capture trap. The slice carries the floors AGENTS.md asks for — the
 * head must be found, must be unique (so a comment quoting it cannot become
 * the anchor), and the body it delimits must be non-empty — so a slice that
 * silently caught nothing fails here rather than asserting over an empty
 * string.
 */
describe("onToggleSelection seeds through seedSelection (#554)", () => {
  const recorder = readFileSync(
    new URL("../src/components/recorder.tsx", import.meta.url),
    "utf8"
  );

  const CALLBACK_HEAD = "const onToggleSelection = useCallback(() => {";

  const { body, deps } = (() => {
    const headIdx = recorder.indexOf(CALLBACK_HEAD);
    expect(
      headIdx,
      `no \`${CALLBACK_HEAD}\` in recorder.tsx — the callback was renamed or reshaped`
    ).toBeGreaterThan(-1);
    expect(
      recorder.lastIndexOf(CALLBACK_HEAD),
      "the callback head appears more than once (a comment quoting it would make the slice below ambiguous)"
    ).toBe(headIdx);

    const after = recorder.slice(headIdx + CALLBACK_HEAD.length);
    const closing = /\n\s*\}, \[([^\]]*)\]\);/.exec(after);
    if (!closing) {
      throw new Error(
        "onToggleSelection's dependency array was not found after its head"
      );
    }
    return {
      body: after.slice(0, closing.index),
      deps: closing[1] ?? "",
    };
  })();

  it("slices a non-empty callback body", () => {
    // The floor. Round 3 of #529 sliced a comment instead of a rule and looped
    // over nothing; only a floor like this turned that into a failure.
    expect(body.trim().length).toBeGreaterThan(0);
    expect(body).toMatch(/editor\.openSelection\(/);
  });

  it("hands openSelection the library seed rather than building one inline", () => {
    // RED-FIRST kill: before #554 this body read
    //   const half = win.visibleSamples * 0.15;
    //   editor.openSelection({ start: win.centerlineSample - half, ... });
    // with no `seedSelection` call at all, so this fails on the base tree.
    expect(body).toMatch(
      /seedSelection\(\s*length,\s*win\.centerlineSample,\s*win\.visibleSamples\s*\)/
    );
  });

  it("leaves no inline seed arithmetic behind for the two to drift apart", () => {
    // Additive fixes are the failure mode here: a library call added next to
    // the old `half` would satisfy the case above while the app kept using
    // whichever expression reached `openSelection` first.
    expect(body).not.toMatch(/visibleSamples\s*\*\s*0\.15/);
    expect(body).not.toMatch(/centerlineSample\s*[-+]/);
  });

  it("depends on the buffer length the seed is measured against", () => {
    // `seedSelection` slides the span off `length`, so a callback that did not
    // list it would keep seeding against the length captured when the span was
    // last re-created — after a cut, past the new end.
    expect(deps.split(",").map((d) => d.trim())).toContain("length");
  });
});
