import { describe, expect, it } from "vitest";

import {
  backEffectFor,
  navDirection,
  overlayBlocksClose,
  popAction,
  screenFor,
} from "@/lib/nav/navigation";

/**
 * The History wiring in `App.tsx` is browser-only and untestable here (there is
 * no jsdom/renderer — see AGENTS.md); what IS testable is the decision it runs
 * on. The regression these guard: a Back gesture on the recorder must route to
 * the commit path, not to a bare unmount that drops the in-progress take (#58 /
 * #168). If `backEffectFor("recorder")` ever stops returning
 * `"commit-close-recorder"`, that data-loss regression is back — so that row is
 * the mutation that must fail.
 */
describe("screenFor", () => {
  it("is books with no chapter and no recorder", () => {
    expect(screenFor(false, false)).toBe("books");
  });

  it("is segments with a chapter and no recorder", () => {
    expect(screenFor(true, false)).toBe("segments");
  });

  it("is recorder whenever the recorder is open — even over a chapter", () => {
    expect(screenFor(true, true)).toBe("recorder");
    // The recorder is a sheet, so an open recorder wins over the screen beneath
    // it regardless of the chapter flag.
    expect(screenFor(false, true)).toBe("recorder");
  });
});

describe("backEffectFor", () => {
  it("commits and closes the recorder — never a take-dropping unmount (#58)", () => {
    expect(backEffectFor("recorder")).toBe("commit-close-recorder");
  });

  it("returns Segments to the Books shelf", () => {
    expect(backEffectFor("segments")).toBe("to-books");
  });

  it("exits the app from the Books shelf, where Back loses nothing", () => {
    expect(backEffectFor("books")).toBe("exit-app");
  });
});

describe("navDirection", () => {
  it("is back when the destination index is lower", () => {
    expect(navDirection(2, 1)).toBe("back");
  });

  it("is forward when the destination index is higher", () => {
    // `popstate` fires for Forward too; the old handler had no way to see this
    // and misrouted it as a Back (Frank R1 F2).
    expect(navDirection(1, 2)).toBe("forward");
  });

  it("is same when the index did not move", () => {
    expect(navDirection(1, 1)).toBe("same");
  });
});

describe("popAction", () => {
  it("routes a Back on the recorder to the commit path (#58)", () => {
    expect(popAction("back", "recorder", false, false)).toBe(
      "commit-close-recorder"
    );
  });

  it("routes a Back on Segments to Books, and on Books to exit", () => {
    expect(popAction("back", "segments", false, false)).toBe("to-books");
    expect(popAction("back", "books", false, false)).toBe("exit-app");
  });

  it("traps a Forward instead of misrouting it as a Back (F2)", () => {
    // The load-bearing F2 row: a Forward while on Segments must NOT run
    // `to-books` (which dropped the UI to Books). It is trapped.
    expect(popAction("forward", "segments", false, false)).toBe("trap-forward");
    expect(popAction("forward", "recorder", false, false)).toBe("trap-forward");
  });

  it("ignores a same-index popstate", () => {
    expect(popAction("same", "segments", false, false)).toBe("ignore");
  });

  it("re-arms every gesture while a recorder commit is in flight (F1)", () => {
    // The load-bearing F1 row. First Back starts the commit…
    expect(popAction("back", "recorder", false, false)).toBe(
      "commit-close-recorder"
    );
    // …and a SECOND Back arriving before it settles must re-arm the protective
    // entry, never escape the recorder and drop the uncommitted take (#58).
    // `committing` wins over direction and screen, so nothing else can leave.
    expect(popAction("back", "recorder", true, false)).toBe(
      "rearm-during-commit"
    );
    expect(popAction("back", "segments", true, false)).toBe(
      "rearm-during-commit"
    );
    expect(popAction("forward", "recorder", true, false)).toBe(
      "rearm-during-commit"
    );
  });

  it("traps every gesture under the failed-save recovery modal (R3 G-R3-1)", () => {
    // The load-bearing R3 row. A Back under the `SaveFailed` modal must NOT run
    // `to-books`/`exit-app` — those walk one entry farther toward the document
    // unload that destroys the heap and the ONLY in-memory copy of the held take.
    // `recovering` outranks direction, screen, and even a commit in flight, so
    // nothing under the modal can escape; the handler absorbs it by re-arming.
    expect(popAction("back", "segments", false, true)).toBe("trap-recovery");
    expect(popAction("back", "books", false, true)).toBe("trap-recovery");
    expect(popAction("back", "recorder", false, true)).toBe("trap-recovery");
    expect(popAction("forward", "segments", false, true)).toBe("trap-recovery");
    expect(popAction("same", "segments", false, true)).toBe("trap-recovery");
    expect(popAction("back", "recorder", true, true)).toBe("trap-recovery");
  });
});

describe("overlayBlocksClose", () => {
  it("refuses close while the erase is busy — never save over an erase (G1)", () => {
    // The load-bearing G1 row: a system Back must not commit while an erase is in
    // flight, or `saveEditedSegment` races the erase (last IDB writer wins).
    expect(overlayBlocksClose(false, false, true)).toBe(true);
  });

  it("refuses close while the erase-confirm or the menu is open", () => {
    expect(overlayBlocksClose(false, true, false)).toBe(true);
    expect(overlayBlocksClose(true, false, false)).toBe(true);
  });

  it("allows close when no overlay is up", () => {
    expect(overlayBlocksClose(false, false, false)).toBe(false);
  });
});
