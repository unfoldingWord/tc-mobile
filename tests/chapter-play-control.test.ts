import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { ChapterPlayControl } from "@/components/chapter-play-control";
import { chapterRowStatus } from "@/components/chapter-row-status";
import { CHAPTER_IDLE, type ChapterPlayState } from "@/hooks/chapter-player";
import { strings } from "@/lib/strings";
import type { ChapterId } from "@/types/domain";

import { one, render } from "./render";

/**
 * The chapter row's play control (#1469): what each state emits, read from
 * the markup. One render, no effects — the ring's animation loop is covered
 * in `tests/books-chapter-play.test.ts`, which mounts the screen.
 */

const id = "chapter-1-4000-8000-000000000001" as ChapterId;
const other = "chapter-1-4000-8000-000000000002" as ChapterId;
const HEADING = "The sower";

type Status = Parameters<typeof ChapterPlayControl>[0]["status"];

function control(
  status: Status,
  extra: Partial<Parameters<typeof ChapterPlayControl>[0]> = {}
) {
  return render(
    createElement(ChapterPlayControl, {
      heading: HEADING,
      recordedCount: 3,
      status,
      pausedFraction: null,
      onPress: () => {},
      readProgress: () => null,
      ...extra,
    })
  );
}

const button = (c: Element) => one(c, "button");

describe("the chapter row's play control (#1469)", () => {
  it("rests as Play, with a play glyph and an empty ring", () => {
    const c = control("rest");
    expect(button(c).getAttribute("aria-label")).toBe(
      strings.playChapter(HEADING)
    );
    expect(one(c, ".books-play").getAttribute("data-status")).toBe("rest");
    expect(one(c, ".books-play-ring").getAttribute("style")).toContain(
      "--play-progress:0"
    );
  });

  it("is Pause while it loads and while it plays", () => {
    for (const status of ["loading", "playing"] as const) {
      const c = control(status);
      expect(button(c).getAttribute("aria-label")).toBe(
        strings.pauseChapter(HEADING)
      );
      expect(one(c, ".books-play").getAttribute("data-status")).toBe(status);
      // The loop owns the fill while it moves; the markup must not pin one.
      expect(
        one(c, ".books-play-ring").getAttribute("style") ?? ""
      ).not.toContain("--play-progress");
    }
  });

  it("is Resume while paused, naming the percent, with the ring held at the fill", () => {
    const c = control("paused", { pausedFraction: 0.375 });
    expect(button(c).getAttribute("aria-label")).toBe(
      strings.resumeChapter(HEADING, 38)
    );
    expect(one(c, ".books-play-ring").getAttribute("style")).toContain(
      "--play-progress:0.375"
    );
  });

  it("names a failure in the label: it did not play, and a tap tries again", () => {
    const c = control("failed");
    expect(button(c).getAttribute("aria-label")).toBe(
      strings.chapterPlayFailed(HEADING)
    );
    expect(button(c).getAttribute("title")).toBe(
      strings.chapterPlayFailed(HEADING)
    );
    expect(one(c, ".books-play").getAttribute("data-status")).toBe("failed");
    expect(c.querySelector("[role='alert'], [aria-live]")).toBeNull();
  });

  it("an empty chapter keeps its nothing-to-play name even if the status says failed", () => {
    const c = control("failed", { recordedCount: 0 });
    expect(button(c).getAttribute("aria-label")).toBe(
      strings.chapterNothingToPlay(HEADING)
    );
  });

  it("is not a toggle and announces nothing", () => {
    for (const status of ["rest", "playing", "paused", "failed"] as const) {
      const c = control(status, { pausedFraction: 0.5 });
      expect(button(c).hasAttribute("aria-pressed")).toBe(false);
      expect(c.querySelector("[aria-live], [role='status']")).toBeNull();
    }
  });

  it("hides the ring and the glyph from the reading order", () => {
    const c = control("playing");
    expect(one(c, ".books-play-ring").getAttribute("aria-hidden")).toBe("true");
    expect(one(c, "button svg").getAttribute("aria-hidden")).toBe("true");
  });

  it("is soft-disabled with its reason when nothing is recorded: focusable, named, inert", () => {
    const c = control("rest", { recordedCount: 0 });
    const b = button(c);
    expect(b.getAttribute("aria-disabled")).toBe("true");
    // Not natively disabled: a disabled button leaves the tab order, and the
    // reason lives in the name.
    expect(b.hasAttribute("disabled")).toBe(false);
    expect(b.getAttribute("aria-label")).toBe(
      strings.chapterNothingToPlay(HEADING)
    );
  });

  it("is live when something is recorded", () => {
    const b = button(control("rest", { recordedCount: 1 }));
    expect(b.hasAttribute("aria-disabled")).toBe(false);
    expect(b.hasAttribute("disabled")).toBe(false);
  });
});

describe("chapterRowStatus", () => {
  const playing: ChapterPlayState = {
    chapterId: id,
    status: "playing",
    pausedFraction: null,
  };
  it("is rest for every row when idle", () => {
    expect(chapterRowStatus(CHAPTER_IDLE, id)).toBe("rest");
  });
  it("is the state on the row that owns it and rest on every other", () => {
    expect(chapterRowStatus(playing, id)).toBe("playing");
    expect(chapterRowStatus(playing, other)).toBe("rest");
    expect(
      chapterRowStatus(
        { ...playing, status: "paused", pausedFraction: 0.2 },
        id
      )
    ).toBe("paused");
    expect(chapterRowStatus({ ...playing, status: "failed" }, id)).toBe(
      "failed"
    );
    expect(chapterRowStatus({ ...playing, status: "loading" }, id)).toBe(
      "loading"
    );
  });
});
