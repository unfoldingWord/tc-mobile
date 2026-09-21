import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { RecorderStatus } from "@/components/recorder-status";
import { strings } from "@/components/strings";
import type { RecorderState } from "@/hooks/use-recorder";

import { one, render } from "./render";

/**
 * #197: which tone the recorder's status branches PASS.
 *
 * `tests/notice-tone.test.ts` proves the three tones are distinct
 * presentations, and `tests/processing-status.test.ts` proves
 * `recorderStatusKind` picks the right kind. Neither says the interrupted kind
 * is rendered as `info` — that was one JSX attribute (#154) with nothing behind
 * it, and a probe flipping it back to `busy` left all tests green. These
 * assertions are what that probe now dies on.
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
  it("renders the #59 interrupted take as `info` — a heads-up, not a wait", () => {
    const container = statusFor("processing", false);
    const notice = one(container, ".notice");

    expect(notice.getAttribute("data-tone")).toBe("info");
    expect(notice.textContent).toContain(strings.recorderInterrupted);
  });

  it("renders the commit window as `busy`", () => {
    const container = statusFor("idle", true);
    const notice = one(container, ".notice");

    expect(notice.getAttribute("data-tone")).toBe("busy");
    expect(notice.textContent).toContain(strings.recorderSaving);
  });

  it("lets the close window win over the `processing` nested inside it", () => {
    // `use-recorder` flips state back to `idle` mid-`close()`, so both inputs
    // can be true at once; a committing take is "saving", never "interrupted".
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
