import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { RecorderStatus } from "@/components/recorder-status";
import { strings } from "@/lib/i18n/strings";
import type { RecorderState } from "@/hooks/use-recorder";

import { one, render } from "./render";

/**
 * #197: which tone the recorder's status branches PASS.
 *
 * `tests/notice-tone.test.ts` proves the three tones are distinct
 * presentations, and `tests/processing-status.test.ts` proves
 * `recorderStatusKind` picks the right kind. Neither reaches the question this
 * file answers: which tone the branch actually passes. That is one JSX
 * attribute (#154), and until `RecorderStatus` was lifted out of `recorder.tsx`
 * no test could render the code that carries it.
 *
 * `data-tone` is the attribute under test rather than a colour or a class:
 * `Notice` writes it from its `tone` prop and `tests/notice-bridge.test.ts`
 * already gates `data-tone` against the stylesheet in both directions, so
 * pinning it here joins the two halves — which tone a branch chooses, and what
 * that tone looks like — without this file knowing anything about CSS.
 */
function statusFor(state: RecorderState, isClosing: boolean) {
  return render(createElement(RecorderStatus, { state, isClosing }));
}

describe("the recorder's commit-window status", () => {
  it("renders a frozen #59 take as `busy` too — it is on its way to disk", () => {
    // Before #614 this branch was `info` and told the translator to tap Back.
    // The interruption now ends the take and the sheet commits it in place, so
    // there is one status and one tone: the wait.
    const container = statusFor("processing", false);
    const notice = one(container, ".notice");

    expect(notice.getAttribute("data-tone")).toBe("busy");
    expect(notice.textContent).toContain(strings.recorderSaving);
  });

  it("renders the commit window as `busy`", () => {
    const container = statusFor("idle", true);
    const notice = one(container, ".notice");

    expect(notice.getAttribute("data-tone")).toBe("busy");
    expect(notice.textContent).toContain(strings.recorderSaving);
  });

  it("says the same thing for the `processing` nested inside a commit", () => {
    // `use-recorder` flips state back to `idle` mid-commit, so both inputs can
    // be true at once. They no longer choose between two answers, but the
    // branch must still reach one.
    const notice = one(statusFor("processing", true), ".notice");

    expect(notice.getAttribute("data-tone")).toBe("busy");
  });

  it("renders nothing at all when there is nothing to say", () => {
    // Not merely "no Notice": the padded wrapper must go too, or an idle
    // recorder carries dead vertical space above the stage.
    expect(statusFor("idle", false).innerHTML).toBe("");
    expect(statusFor("recording", false).innerHTML).toBe("");
  });
});
