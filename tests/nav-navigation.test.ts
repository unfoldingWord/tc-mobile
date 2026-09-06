import { describe, expect, it } from "vitest";

import { backEffectFor, screenFor } from "@/lib/nav/navigation";

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
