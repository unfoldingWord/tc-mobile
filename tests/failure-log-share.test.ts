import { describe, expect, it } from "vitest";

import {
  type LogShareCapabilities,
  selectLogShareShape,
} from "@/hooks/use-failure-log-share";

/**
 * #205 — which shape the durable failure log leaves the phone in.
 *
 * The two-gesture flow around this decision is React + browser glue this repo
 * has no renderer to exercise (the constraint `tests/share-flow.test.ts`
 * documents). The decision itself is pure, and it is the part with the history:
 * every review round so far has found a bug in it, each one the same mistake —
 * making a capability the log does not need a precondition for sending it.
 *
 *   - round 1 (George): the log rode the File-only share flow, so a platform
 *     that refuses a `text/plain` File refused the log permanently;
 *   - round 2 (Frank): an ABSENT `navigator.canShare` was read as "files work",
 *     arming the file branch on exactly the browsers that cannot take one;
 *   - takeover round 1 (Frank): the whole thing was gated on `navigator.share`,
 *     which the Android System WebView the training's APK runs in may not have
 *     (#336) — so the log was unsendable on the platform it was written for.
 *
 * Each of those is a case below.
 */

const LEVEL_2 = (file: boolean, text: boolean): LogShareCapabilities => ({
  native: false,
  webShare: true,
  canShare: { file, text },
});

describe("selectLogShareShape", () => {
  it("sends through the native plugin inside the shell, whatever the WebView can do", () => {
    // The training build IS this case: an APK and a TestFlight app. The plugin
    // needs no Web Share, so a WebView without it must not block the log.
    expect(
      selectLogShareShape({ native: true, webShare: false, canShare: null })
    ).toBe("native");
    // And native wins even where Web Share exists: a WebView's Web Share is the
    // thing that has already failed in the field (#336), so it is not consulted.
    expect(
      selectLogShareShape({
        native: true,
        webShare: true,
        canShare: { file: true, text: true },
      })
    ).toBe("native");
  });

  it("prefers a File when canShare explicitly says files work", () => {
    expect(selectLogShareShape(LEVEL_2(true, true))).toBe("file");
    // A platform that takes the file but claims not to take text still gets the
    // file: the preference is for the attachment, not for the fallback.
    expect(selectLogShareShape(LEVEL_2(true, false))).toBe("file");
  });

  it("falls back to text when canShare refuses the file", () => {
    // iOS has historically not accepted every type in a file share. The log's
    // one exit must open anyway: text is worse than an attachment and
    // incomparably better than a button that cannot work.
    expect(selectLogShareShape(LEVEL_2(false, true))).toBe("text");
  });

  it("treats an ABSENT canShare as text, never as a file", () => {
    // Web Share LEVEL 1: `share` exists, `canShare` does not, and files are not
    // supported at all — `canShare` arrived with Level 2, which is also what
    // added file sharing. Reading absence as a yes armed the file branch on
    // precisely those browsers (Frank, round 2).
    expect(
      selectLogShareShape({ native: false, webShare: true, canShare: null })
    ).toBe("text");
  });

  it("is unsupported only when the browser can share nothing", () => {
    // No Web Share at all, and not in the shell: there is no exit, and saying so
    // is better than arming a gesture that cannot work. Decided BEFORE the
    // IndexedDB read, which is why the shape takes no File.
    expect(
      selectLogShareShape({ native: false, webShare: false, canShare: null })
    ).toBe("unsupported");
    // Web Share present but refusing both shapes is a standing refusal that no
    // retry clears, so it belongs on screen rather than in a loop.
    expect(selectLogShareShape(LEVEL_2(false, false))).toBe("unsupported");
  });
});
