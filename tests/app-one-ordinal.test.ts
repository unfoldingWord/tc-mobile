import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * #160 (L-11): `App` held two state slots for one fact — `recorder.ordinal`
 * and `recordingOrdinal`, written from the same argument in the same call —
 * and only the second was ever read (by the recovery screen). The first is
 * gone; this pins which one went, and why the other could not.
 *
 * The two are NOT interchangeable, which is the trap in "keep one": the
 * `recorder` slot is cleared the instant the sheet closes, and the recovery
 * screen exists precisely for the case where a save FAILED and the sheet
 * closed. Reading the ordinal off `recorder` would render `SaveFailed` with
 * no segment number on it, so the slot that survives is the one with the
 * longer lifetime. That asymmetry is invisible in the type system and has no
 * runtime home either — `App` cannot be rendered here (AGENTS.md: the #197
 * harness is one component, no effects) — so it is read as source text, the
 * same split `tests/recorder-cut-drag-gate.test.ts` and
 * `tests/nav-commit-close-race-guards.test.ts` use.
 *
 * Comments are stripped before ANY match. This file's subject is a pair of
 * identifiers that `App.tsx`'s own comments now name in prose — including a
 * comment that quotes `setRecorder(null)` in order to explain it — so a
 * whole-file regex would false-hit on the explanation instead of the code.
 */

const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const app = stripComments(
  readFileSync(new URL("../src/app/App.tsx", import.meta.url), "utf8")
);

/** The `useState` call whose setter is `name`, body only, comments already out. */
const stateDeclaration = (name: string) => {
  const at = app.indexOf(`, ${name}] = useState`);
  expect(at, `no useState paired with ${name} in App.tsx`).toBeGreaterThan(-1);
  const start = app.lastIndexOf("const [", at);
  expect(start).toBeGreaterThan(-1);
  const end = app.indexOf(";", at);
  expect(end).toBeGreaterThan(start);
  const decl = app.slice(start, end + 1);
  expect(decl.length, `empty declaration read for ${name}`).toBeGreaterThan(20);
  return decl;
};

describe("App holds ONE ordinal, and it is the recovery screen's (#160 L-11)", () => {
  it("the recorder slot carries the segment id and nothing else", () => {
    const decl = stateDeclaration("setRecorder");
    expect(decl).toMatch(/useState<SegmentId \| null>\(null\)/);
    // The kill: the old `useState<{ segmentId: SegmentId; ordinal: number }>`
    // put a second ordinal here, written on every open and read by nobody.
    expect(decl).not.toMatch(/ordinal/i);
  });

  it("nothing writes an ordinal into the recorder slot", () => {
    for (const write of app.matchAll(/setRecorder\(([^)]*)\)/g)) {
      expect(
        write[1],
        `setRecorder(${write[1]}) carries an ordinal`
      ).not.toMatch(/ordinal/i);
    }
    // A floor, so the loop above cannot pass by iterating over nothing: open,
    // close, chapter change and back-to-books.
    expect([...app.matchAll(/setRecorder\(/g)].length).toBeGreaterThanOrEqual(
      4
    );
  });

  it("the surviving ordinal is the one the recovery screen reads", () => {
    // The other direction of the collapse — dropping `recordingOrdinal` and
    // reading `recorder.ordinal` — would compile, and would lose the segment
    // number on exactly the screen that names it.
    expect(app).toMatch(/ordinal=\{recordingOrdinal\}/);
    expect(app).not.toMatch(/recorder\??\.ordinal/);
  });

  it("closing the sheet does not take the ordinal with it", () => {
    // The lifetime difference that makes two slots correct. Every site that
    // clears `recorder` is checked for a paired clear of the ordinal; a save
    // that failed runs one of them before `SaveFailed` ever renders.
    const clears = [...app.matchAll(/setRecorder\(null\)/g)];
    expect(clears.length).toBeGreaterThanOrEqual(3);
    for (const clear of clears) {
      const around = app.slice(
        Math.max(0, clear.index - 400),
        clear.index + 400
      );
      expect(around).not.toMatch(/setRecordingOrdinal\(\s*null\s*\)/);
    }
    // ...and the one writer is the open, which is also the only place the two
    // slots are still set together.
    expect([...app.matchAll(/setRecordingOrdinal\(/g)].length).toBe(1);
  });

  it("that one writer passes the opened segment's ordinal, beside its id", () => {
    // George r1 (Low/HYGIENE) on PR #699: the count above proves there is
    // exactly ONE `setRecordingOrdinal(`, and the window above proves no
    // `setRecordingOrdinal(null)` sits next to a clear — but neither asks what
    // the surviving call PASSES. `setRecordingOrdinal(0)`, and a decoupling
    // that writes `ordinal + 1` after `setRecorder`, both survived those two.
    // Confirmed by running them, not reasoned about.
    //
    // So read the open handler's own body and pin the pair. Adjacency is the
    // claim: the ordinal is captured for the segment being opened, in the same
    // call, which is what makes `recordingOrdinal` a faithful mirror of the
    // sheet at open time rather than a number that drifted.
    const at = app.indexOf("const openRecorderState = useCallback(");
    expect(at, "no openRecorderState in App.tsx").toBeGreaterThan(-1);
    const end = app.indexOf("const recorderClosedState = useCallback(", at);
    expect(end).toBeGreaterThan(at);
    const body = app.slice(at, end);
    expect(body.length, "empty openRecorderState body read").toBeGreaterThan(
      50
    );
    expect(body).toMatch(
      /setRecordingOrdinal\(ordinal\);\s*setRecorder\(segmentId\);/
    );
  });

  it("the sheet is mounted on an explicit null check, not on truthiness", () => {
    // `SegmentId` is a branded STRING now that the slot is not an object, so
    // `{recorder && <Recorder …>}` would render the empty string instead of
    // the sheet. Cheap to get right, invisible until it is not.
    expect(app).toMatch(/\{recorder !== null && \(/);
    expect(app).not.toMatch(/\{recorder && \(/);
  });
});
