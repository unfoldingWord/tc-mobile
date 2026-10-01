import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { LoadErrorPanel } from "@/components/recorder";
import { strings } from "@/lib/strings";

import { one, render } from "./render";

/**
 * #172 part 2: `LoadErrorPanel` must render `strings[key]`, never a raw
 * message — and, per the 2026-09-22 issue triage note ("classifies quota on
 * open and then discards it — `LoadErrorPanel` never reads the key"), it must
 * actually READ the `FailureKey` `useRecorderSegment` now stores, not show the
 * same generic decode-failure copy regardless of what failed.
 *
 * A props-to-attribute guarantee, the render harness's remit (#197): it reads
 * the body text `LoadErrorPanel` actually emits for each key. It does not
 * exercise `useRecorderSegment`'s load/reload effect itself (that is
 * `tests/use-recorder-segment-failure-key.test.ts`, over fake-indexeddb) or
 * confirm what a screen reader announces on-device.
 */
describe("LoadErrorPanel (#172 part 2)", () => {
  it("shows the no-room sentence for a noRoom failure, not the generic decode-failure body", () => {
    const container = render(
      createElement(LoadErrorPanel, {
        errorKey: "noRoom",
        retrying: false,
        onRetry: () => {},
        onBack: () => {},
      })
    );

    const body = container.querySelectorAll("p")[1];
    expect(body?.textContent).toBe(strings.noRoom);
    expect(body?.textContent).not.toBe(strings.loadFailedBody);
  });

  it("keeps the established decode-failure body for every other key", () => {
    const container = render(
      createElement(LoadErrorPanel, {
        errorKey: "loadFailed",
        retrying: false,
        onRetry: () => {},
        onBack: () => {},
      })
    );

    const body = container.querySelectorAll("p")[1];
    expect(body?.textContent).toBe(strings.loadFailedBody);
  });

  it("never renders a raw message — only strings[key] or the fixed title", () => {
    const container = render(
      createElement(LoadErrorPanel, {
        errorKey: "noRoom",
        retrying: false,
        onRetry: () => {},
        onBack: () => {},
      })
    );

    const title = one(container, "p.t-title");
    expect(title.textContent).toBe(strings.loadFailedTitle);
    const body = container.querySelectorAll("p")[1];
    expect(body?.textContent).toBe(strings.noRoom);
  });
});
