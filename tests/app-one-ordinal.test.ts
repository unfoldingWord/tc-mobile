import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * #160 (L-11): `App` held two state slots for one fact — `recorder.ordinal`
 * and `recordingOrdinal`, written from the same argument in the same call —
 * and only the second was ever read (by the recovery screen). The first is
 * gone; this pins which one went, and why the other could not.
 *
 * The recovery screen no longer reads this slot at all (#710): the sheet's
 * saves stamp the take with it, and `SaveFailed` reads the number off the held
 * take. The runtime half of that is `tests/app-save-failed-ordinal.test.ts`,
 * which mounts `App`; this file keeps the source-shape pins on which slot holds
 * the ordinal and who writes it, the same split
 * `tests/recorder-cut-drag-gate.test.ts` and
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

describe("App holds ONE ordinal, and the sheet's saves stamp it on the take (#160 L-11, #710)", () => {
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

  it("the recovery screen reads the held take's number, not the open-time slot", () => {
    // #710: `ordinal={recordingOrdinal}` named whichever segment was opened
    // LAST, which a second open during a first in-flight save moves off the
    // held take's segment.
    expect(app).toMatch(/ordinal=\{recovery\.ordinal\}/);
    expect(app).not.toMatch(/ordinal=\{recordingOrdinal\}/);
    expect(app).not.toMatch(/recorder\??\.ordinal/);
  });

  it("closing the sheet does not take the ordinal with it", () => {
    // Every site that clears `recorder` is checked for a paired clear of the
    // ordinal: the slot is written by the open and overwritten by the next.
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
    // #718: end the slice at the callback's OWN closing dependency array, not
    // at the NEXT declaration. Anchoring on the next declaration only pins
    // the pair somewhere in the span between the two anchors — a function
    // inserted between this callback's close and `recorderClosedState`, that
    // happens to carry the same two lines, would satisfy the old match even
    // with the pair moved out of `openRecorderState` itself.
    const depsMarker = "[leave, primeAudioContext]";
    const depsAt = app.indexOf(depsMarker, at);
    expect(
      depsAt,
      "no closing dependency array for openRecorderState"
    ).toBeGreaterThan(at);
    const end = depsAt + depsMarker.length;
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
