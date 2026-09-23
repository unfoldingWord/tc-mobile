import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * #173: the recorder OWNS its state, and nothing keeps a mirror of its own.
 *
 * A SOURCE-LEVEL check, and this file does not pretend otherwise. The property
 * is "`readState()` answers with what was last written, in the same tick", and
 * observing that needs a state transition inside a mounted hook: `tests/render.ts`
 * gives one render with no effects and no events, so the transition is not
 * reachable in this suite. What IS reachable, and what actually broke here
 * before, is the COUPLING — a write that reaches the render but not the ref, or
 * a second consumer growing its own copy. Both are visible in the text.
 *
 * **`readState` has no caller in the tree as of #614, and this file says so
 * rather than quietly testing an orphan.** Its four callers were all
 * `readRecorderState() === "paused"` in `use-audio-session.ts`, inside the
 * floor hand-off for a mic that was open but not capturing. #614 ended the
 * paused take — a recording is now committed by the tap that stops it — so
 * that hand-off and its reads are gone. The recorder's own half is kept: the
 * ref write is one line inside the setter, the reader is one line beside it,
 * and the invariant they encode is the thing a future synchronous caller will
 * need. Removing them instead is a call for the DRI, not for the PR that
 * happened to delete the last caller.
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
    // And by SHAPE, not only by that one name, since #614 left this case as the
    // file's only live assertion (see the docblock). A mirror is a ref seeded
    // from the rendered state, however it is spelled; the two assertions above
    // and below would both survive someone calling it something else.
    expect(withoutComments(audioSession)).not.toMatch(
      /useRef\(\s*recorderState\s*\)/
    );

    // What the rendered state MAY still be used for, so this is a scoping and
    // not a ban: exactly one effect reads it, the idle/mic floor backstop. An
    // effect runs after the commit that carries the value, so the rendered one
    // is the one that matches the tree it reconciles — the mirror's defect was
    // answering a SYNCHRONOUS caller a commit late, which is a different act.
    // A second reader appearing here is what this count is for: if it is inside
    // a handler rather than an effect, it is the old bug wearing a new name.
    expect(
      withoutComments(audioSession).match(/recorderState === /g)
    ).toHaveLength(1);
  });
});
