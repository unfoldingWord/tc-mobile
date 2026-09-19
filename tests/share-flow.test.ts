import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { classifyShareError, sentGap } from "@/hooks/share-flow";

/** Source-shape reads, because there is no renderer here (#197). */
const read = (rel: string) =>
  readFileSync(path.resolve(import.meta.dirname, "..", rel), "utf8");

/**
 * B7 Share (chapter + book) — the share-rejection classifier.
 *
 * The two-gesture flow lives in `useShareFlow` (wrapped by `useChapterShare` and
 * `useBookShare`), whose state machine and the `navigator.share` handoff are
 * React + browser glue this repo has no renderer to exercise (the constraint
 * `tests/use-erase-segment.test.ts` documents). What IS node-testable is the pure
 * decision the classifier makes about a rejection,
 * and it is the one with real product weight: it decides whether a translator
 * sees a failure, gets a silent retry, or the flow simply ends.
 *
 * The distinction that matters most is `NotAllowedError` → `retry`. That was the
 * P1 that sent this PR back: encoding spent the iOS activation window and the
 * share was refused. The rework prevents the refusal, but if one still arrives,
 * treating it as `failed` would throw away the already-encoded File and send the
 * translator back to re-encode — so it must classify as `retry`, keeping the
 * File armed for a fresh tap.
 */
describe("classifyShareError", () => {
  it("treats a dismissed sheet (AbortError) as dismissed, whatever the activation", () => {
    const abort = new DOMException("user cancelled", "AbortError");
    expect(classifyShareError(abort, false)).toBe("dismissed");
    expect(classifyShareError(abort, true)).toBe("dismissed");
  });

  it("treats NotAllowedError with NO live activation as retry, keeping the File", () => {
    // The tap's activation was spent; a fresh tap can still hand over the File.
    const notAllowed = new DOMException("permission denied", "NotAllowedError");
    expect(classifyShareError(notAllowed, false)).toBe("retry");
  });

  it("treats NotAllowedError WITH live activation as a real failure, not a loop", () => {
    // Activation was live and share still refused: a standing block (Permissions
    // Policy), so surface an error rather than a "Share now" that never works.
    const notAllowed = new DOMException("blocked by policy", "NotAllowedError");
    expect(classifyShareError(notAllowed, true)).toBe("failed");
  });

  it("treats any other DOMException as a real failure", () => {
    const other = new DOMException("boom", "DataError");
    expect(classifyShareError(other, false)).toBe("failed");
    expect(classifyShareError(other, true)).toBe("failed");
  });

  it("treats a plain Error as a real failure", () => {
    expect(classifyShareError(new Error("network"), false)).toBe("failed");
  });

  it("treats a non-error throw as a real failure", () => {
    expect(classifyShareError("nope", false)).toBe("failed");
    expect(classifyShareError(undefined, true)).toBe("failed");
  });
});

/**
 * `sentGap` (P1, this lane's own review round) — the pure decision that picks
 * `sent` vs `partial` at `send()`'s own settle, node-testable for the same
 * reason `classifyShareError` above is.
 *
 * The defect this closes: a chapter/book share that went out with segments or
 * chapters missing wore the SAME plain success tick a whole share gets — the
 * gap Notice on screen a moment earlier vanished with no trace once the sheet
 * closed, so a facilitator reading only the glyph collected an incomplete
 * chapter believing it whole. `share-progress.ts`'s header on `ShareSettled`
 * names the exact same collision this is #178's own fix shape recreates one
 * screen later, which is why this reuses the mark rather than adding a
 * fourth.
 */
describe("sentGap", () => {
  it("no gap when both counts are zero", () => {
    expect(sentGap({ missing: 0, partial: 0 })).toBeUndefined();
  });

  it("a gap from `missing` alone (a chapter's own left-out segments, or a book's whole missing chapters)", () => {
    expect(sentGap({ missing: 1, partial: 0 })).toEqual({
      missing: 1,
      partial: 0,
    });
  });

  it("a gap from `partial` alone (segments missing inside a book chapter that DID ship)", () => {
    expect(sentGap({ missing: 0, partial: 2 })).toEqual({
      missing: 0,
      partial: 2,
    });
  });

  it("a gap from both at once — a book can carry both", () => {
    expect(sentGap({ missing: 1, partial: 2 })).toEqual({
      missing: 1,
      partial: 2,
    });
  });
});

/**
 * The wiring pins the state machine alone cannot prove: that `send()` reads
 * ITS gap off the ARMED value (not off `missing`/`partial` state, which the
 * same transition already zeroes), that a scrim tap cannot discard an
 * irreversibly in-flight send (P2), and that the guard-hole branch settles
 * the modal like every other outcome (P3) — all three from this lane's own
 * review round. `tests/share-progress.test.ts` already pins the busy/outcome
 * machine and the iOS activation-window shape; this file adds only what
 * changed here.
 */
describe("the wiring around sentGap and the reset guard (this lane's own review round)", () => {
  const flow = read("src/hooks/share-flow.ts");

  it("prepare() arms the gap counts alongside the File, not just in useState", () => {
    expect(flow).toMatch(
      /handoff\.arm\(\{\s*file,\s*staged,\s*missing:\s*prepared\.missing,\s*partial:\s*prepared\.partial \?\? 0,?\s*\}\)/
    );
  });

  it("send() decides sent vs partial through sentGap(armed), never a hand-rolled comparison at the call site", () => {
    const from = flow.indexOf('modal.dispatch({ type: "begin", work: "send"');
    const settleSite = flow.indexOf("const gap = sentGap(armed);", from);
    expect(settleSite).toBeGreaterThan(from);
    expect(flow).toMatch(/settled: gap \? "partial" : "sent"/);
  });

  it("reset() refuses to run while a send is irreversibly in flight (P2)", () => {
    // The scrim's onCancel and the menu's Close/Escape all funnel through
    // reset(); without this guard, any of them can bump the run token under
    // a send that has already asked the OS for a chooser, turning a genuine
    // success into a dropped "superseded" outcome — reproducing #336/#491
    // inside the very modal built to fix it.
    const resetFn = flow.slice(
      flow.indexOf("const reset = useCallback"),
      flow.indexOf("}, [handoff, modal]);", flow.indexOf("const reset ="))
    );
    expect(resetFn).toMatch(/if \(handoff\.sending\) return;/);
    // The guard must be the FIRST statement in the body — before the token
    // bump it exists to prevent.
    const guardAt = resetFn.indexOf("if (handoff.sending) return;");
    const bumpAt = resetFn.indexOf("runIdRef.current += 1;");
    expect(guardAt).toBeGreaterThan(-1);
    expect(bumpAt).toBeGreaterThan(guardAt);
  });

  it("the guard-hole branch (armed === null) settles the modal like every other outcome (P3)", () => {
    const holeAt = flow.indexOf("if (armed === null) {");
    const holeEnd = flow.indexOf('return "failed";', holeAt);
    const hole = flow.slice(holeAt, holeEnd);
    expect(hole).toMatch(/type: "begin",\s*work: "send"/);
    expect(hole).toMatch(/type: "settle",\s*settled: "failed"/);
  });
});
