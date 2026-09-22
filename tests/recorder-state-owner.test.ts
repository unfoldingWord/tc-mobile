import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * #173: the recorder OWNS its state, and `useAudioSession` reads it rather than
 * keeping a mirror of its own.
 *
 * A SOURCE-LEVEL check, and this file does not pretend otherwise. The property
 * is "`readState()` answers with what was last written, in the same tick", and
 * observing that needs a state transition inside a mounted hook: `tests/render.ts`
 * gives one render with no effects and no events, so the transition is not
 * reachable in this suite. What IS reachable, and what actually broke here
 * before, is the COUPLING — a write that reaches the render but not the ref, or
 * a second consumer growing its own copy. Both are visible in the text.
 */
const audioSession = readFileSync("src/hooks/use-audio-session.ts", "utf8");
const recorder = readFileSync("src/hooks/use-recorder.ts", "utf8");

/** Strip whole-line `//` comments and docblock continuation lines before checking code. */
function withoutComments(source: string): string {
  return source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("*"))
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

describe("recorder state ownership (#173)", () => {
  const recorderCode = withoutComments(recorder);

  it("routes EVERY rendered state write through the wrapper that writes the ref", () => {
    // The mutation this exists for: a new path calling `setRenderedState`
    // directly. The ref would then answer for a state the recorder has left,
    // and `useAudioSession` would preempt a live mic (#101 R1 P1) — with the
    // same symptom the mirror this replaced had, and no mirror to blame.
    const writes = recorderCode.match(/setRenderedState\(/g) ?? [];
    expect(writes).toHaveLength(1);

    const wrapper = recorderCode.slice(
      recorderCode.indexOf("const setState = useCallback"),
      recorderCode.indexOf("const readState = useCallback")
    );
    expect(wrapper.length).toBeGreaterThan(0);
    expect(wrapper).toContain("setRenderedState(");
    // The write the whole change rests on. Delete it and `readState` answers
    // "idle" for the life of the take.
    expect(wrapper).toMatch(/stateRef\.current = next/);
  });

  it("hands the reader out, and reads it from the ref", () => {
    expect(recorderCode).toMatch(/readonly readState: \(\) => RecorderState;/);
    expect(recorderCode).toMatch(/=> stateRef\.current/);
    // Returned from the hook, not merely declared inside it.
    expect(recorderCode.slice(recorderCode.lastIndexOf("return {"))).toMatch(
      /\breadState,/
    );
  });

  it("leaves useAudioSession no mirror of its own", () => {
    // The mirror #173 removed, by name: it lagged a commit behind, which is the
    // whole defect. Checked over the file including comments on purpose — a
    // comment reintroducing it by name would be describing code that is gone.
    expect(audioSession).not.toMatch(/recorderStateRef/);
    expect(audioSession).toMatch(/readState: readRecorderState,/);
    // Read through the owner at each use, never snapshotted into a local.
    expect(
      withoutComments(audioSession).match(/readRecorderState\(\) === "paused"/g)
    ).toHaveLength(4);
  });
});
