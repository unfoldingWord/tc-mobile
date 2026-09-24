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
 * What this file does not cover: whether the call sites in `recorder.tsx`
 * consult this. `tests/recorder-missing-target.test.ts` mounts the sheet for
 * the two close tails (`clear`, `mark`) on a missing segment; the `erase` and
 * `load` sites have no mounted test of their decision.
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
      expect(
        failureExit(site, { databaseUnreachable: false, targetMissing: false })
      ).toBe("stay");
    }
  });

  it("exits once the database cannot be reopened at all, so the panel can mount", () => {
    // `getDb()` is latched after this copy yields its connection: it rejects
    // before it opens, identically, for the life of the page. Staying means a
    // control that teaches retry over a call that can never succeed — and on the
    // close tails, Back IS that control, so the sheet cannot be left at all
    // (George R6 P2).
    for (const site of SITES) {
      expect(
        failureExit(site, { databaseUnreachable: true, targetMissing: false })
      ).toBe("exit");
    }
  });

  it("leaves and re-reads when the segment it wrote to no longer exists (#607)", () => {
    // Another live copy deleted the book: `clearSegmentTake` and
    // `setSegmentFinished` throw `No such segment`, and segment ids are never
    // reused, so the Back that retries the write can never land. The screen
    // behind has a stale state for a missing chapter (#597), and only a
    // re-read shows it — hence a distinct answer from `exit`, whose Segments
    // re-read would fail against a latched database anyway.
    for (const site of SITES) {
      expect(
        failureExit(site, { databaseUnreachable: false, targetMissing: true })
      ).toBe("leave-stale");
    }
  });

  it("lets an unreachable database outrank a missing target", () => {
    // With `getDb()` latched a re-read fails too, and what the translator
    // needs is the restart `DatabasePanel` offers, not a stale chapter state
    // that cannot load.
    for (const site of SITES) {
      expect(
        failureExit(site, { databaseUnreachable: true, targetMissing: true })
      ).toBe("exit");
    }
  });

  it("answers every site the same way — which is the whole fix", () => {
    // The class was four sites deciding separately. If one of them ever needs a
    // different answer, that divergence has to be written down here as a
    // divergence, and this case is what forces the conversation.
    for (const databaseUnreachable of [false, true]) {
      for (const targetMissing of [false, true]) {
        const answers = new Set(
          SITES.map((site) =>
            failureExit(site, { databaseUnreachable, targetMissing })
          )
        );
        expect(answers.size).toBe(1);
      }
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
