import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { SendLogControl } from "@/components/send-log-control";
import { strings } from "@/lib/strings";

import { one, render } from "./render";

/**
 * #1088 item 2, the render half. `SendLogControl` wraps the browser-boundary
 * `useFailureLogShare` hook, which starts every mount at `status: "idle"`,
 * `error: null`, `sendUnconfirmed: false` — the only state `tests/render.ts`'s
 * static markup can reach (no events, no effects; `tests/save-failed.test.ts`
 * and `tests/send-log-control-view.test.ts` both say the same about the
 * states a tap would reach). The label and hand-off TEXT tables are pinned
 * directly, in `tests/send-log-control-view.test.ts`; this file pins that the
 * component actually wires that table's output onto the DOM at the one state
 * a static render reaches.
 */
describe("SendLogControl — the visible label (#1088 item 2)", () => {
  it("shows the same sentence on screen that it already speaks as its accessible name", () => {
    const container = render(createElement(SendLogControl));
    const button = one(container, "button");
    const caption = one(container, ".send-log-label");

    expect(button.getAttribute("aria-label")).toBe(strings.shareFailureLog);
    expect(caption.textContent).toBe(strings.shareFailureLog);
    // Not a second thing a screen reader hears: `label` above already IS the
    // accessible name.
    expect(caption.getAttribute("aria-hidden")).toBe("true");
  });

  it("shows no hand-off confirmation before anything has been sent", () => {
    const container = render(createElement(SendLogControl));
    // Nothing has settled on a fresh mount, so no `Notice` at all — not the
    // preparing one (status is idle) and not a hand-off confirmation (no
    // send has happened yet).
    expect(container.querySelector(".notice")).toBeNull();
  });
});
