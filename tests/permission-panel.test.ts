import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { PermissionPanel } from "@/components/permission-panel";

import { one, render } from "./render";

/**
 * #276: `role="alert"` scoped to the title alone, not the panel's outer
 * wrapper — deferred from the round-3 dual review of #260 (George R3 P3).
 *
 * This is a props-to-attribute guarantee, the render harness's whole remit
 * (#197): it reads which element carries `role="alert"` in the markup
 * `PermissionPanel` actually emits. It does not exercise the async permission
 * refine itself (`use-recorder.ts`'s `navigator.permissions` query) or
 * confirm what a screen reader announces — that is on-device, unverified
 * here — only that the live region and the two buttons are no longer the
 * same element.
 */
describe("PermissionPanel (#276)", () => {
  it("puts role=alert on the title, not the outer wrapper", () => {
    const container = render(
      createElement(PermissionPanel, {
        message: null,
        onRetry: () => {},
        onBack: () => {},
      })
    );

    const alerts = container.querySelectorAll('[role="alert"]');
    expect(alerts.length).toBe(1);

    const title = one(container, "p");
    expect(title.getAttribute("role")).toBe("alert");

    // The panel's outer wrapper carries no role of its own — the bug this
    // scopes away from.
    const wrapper = container.firstElementChild;
    expect(wrapper?.getAttribute("role")).not.toBe("alert");
  });

  it("keeps the Retry and Back controls outside the alert element", () => {
    const container = render(
      createElement(PermissionPanel, {
        message: "The site has blocked microphone access.",
        onRetry: () => {},
        onBack: () => {},
      })
    );

    const alert = one(container, '[role="alert"]');
    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBe(2);
    for (const button of buttons) {
      // `contains` is false for a node that is not a descendant, which is
      // exactly the ARIA-authoring-practice shape this scoping restores:
      // a focused, interactive control must not sit inside the live region
      // that re-announces out from under it.
      expect(alert.contains(button)).toBe(false);
    }
  });

  it("renders the refined message text inside the alert title", () => {
    const message = "The site has blocked microphone access.";
    const container = render(
      createElement(PermissionPanel, {
        message,
        onRetry: () => {},
        onBack: () => {},
      })
    );

    const alert = one(container, '[role="alert"]');
    expect(alert.textContent).toBe(message);
  });
});
