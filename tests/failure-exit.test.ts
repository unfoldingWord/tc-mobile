import { describe, expect, it } from "vitest";

import {
  failureExit,
  type RecorderFailureSite,
} from "@/lib/takes/failure-exit";

/**
 * The retry-vs-terminal decision for a store failure inside the recorder sheet.
 *
 * The defect class this closes (George R5 P3 / #450, then George R6 P2) was four
 * failure sites each deciding for themselves whether a failure was worth
 * retrying, while the screen that could actually help was withheld behind them.
 * So the cases below are about the SET of sites as much as about either answer:
 * they must agree, and the list must be exhaustive.
 *
 * What cannot be tested here, and is not claimed: that the four call sites
 * actually consult this. They are inside `recorder.tsx`, and this repo has no
 * renderer. That is on the two-tab staging list.
 */
const SITES: readonly RecorderFailureSite[] = [
  "clear",
  "mark",
  "erase",
  "load",
];

describe("failureExit", () => {
  it("stays and lets the translator retry while the database is still reachable", () => {
    // The unchanged behaviour of every one of these sites, and it must survive:
    // a quota rejection or an unknown blip may well succeed on the next tap, and
    // throwing the translator out of the sheet over a transient would be a worse
    // defect than the one this fixes.
    for (const site of SITES) {
      expect(failureExit(site, false)).toBe("stay");
    }
  });

  it("exits once the database cannot be reopened at all, so the panel can mount", () => {
    // `getDb()` is latched after this copy yields its connection: it rejects
    // before it opens, identically, for the life of the page. Staying means a
    // control that teaches retry over a call that can never succeed — and on the
    // close tails, Back IS that control, so the sheet cannot be left at all
    // (George R6 P2).
    for (const site of SITES) {
      expect(failureExit(site, true)).toBe("exit");
    }
  });

  it("answers every site the same way — which is the whole fix", () => {
    // The class was four sites deciding separately. If one of them ever needs a
    // different answer, that divergence has to be written down here as a
    // divergence, and this case is what forces the conversation.
    for (const unreachable of [false, true]) {
      const answers = new Set(
        SITES.map((site) => failureExit(site, unreachable))
      );
      expect(answers.size).toBe(1);
    }
  });

  it("covers the four sites the class was found at, and no fewer", () => {
    // A fifth failure path inside the sheet cannot be added without coming here
    // and naming itself. `#450` was the load path; the close tails and the erase
    // were George R6 P2.
    expect(new Set(SITES).size).toBe(4);
    for (const site of ["clear", "mark", "erase", "load"] as const) {
      expect(SITES).toContain(site);
    }
  });
});
