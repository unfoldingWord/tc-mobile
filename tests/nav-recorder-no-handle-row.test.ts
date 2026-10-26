// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useNavStack, type UseNavStack } from "@/hooks/use-nav-stack";
import { lightsFailureMarker } from "@/lib/failure-marker";

/**
 * A system Back on the recorder screen with no recorder handle (the unmount
 * gap `use-nav-stack.ts` describes) used to end at a bare `console.error` with
 * no cause object. It now also writes one failure-log row under
 * `"recorder-back-no-handle"`, carrying an Error built at the site.
 */
const boundary = vi.hoisted(() => ({ report: vi.fn() }));
vi.mock("@/hooks/report-failure", () => ({ reportFailure: boundary.report }));

function Owner({ handleRef }: { handleRef: { current: UseNavStack | null } }) {
  const handle = useNavStack({
    hasChapter: false,
    recorderOpen: true,
    recovering: false,
    databasePanel: false,
    chapterClipboardHeld: false,
    getRecorderHandle: () => null,
    onOpenChapter: () => {},
    onOpenRecorder: () => {},
    onLeaveToBooks: () => {},
    onRecorderClosed: () => {},
  } as unknown as Parameters<typeof useNavStack>[0]);
  useLayoutEffect(() => {
    handleRef.current = handle;
  });
  return null;
}

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  boundary.report.mockReset();
  window.history.replaceState(null, "", "/");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('a Back with no recorder handle reports "recorder-back-no-handle" with an Error', async () => {
  const handleRef: { current: UseNavStack | null } = { current: null };
  await act(async () => {
    root.render(createElement(Owner, { handleRef }));
  });
  await act(async () => {
    window.dispatchEvent(
      new PopStateEvent("popstate", { state: { index: -1 } })
    );
  });

  expect(boundary.report).toHaveBeenCalledOnce();
  const [cause, context] = boundary.report.mock.calls[0] as [unknown, string];
  expect(context).toBe("recorder-back-no-handle");
  expect(cause).toBeInstanceOf(Error);
  expect((cause as Error).message).toContain("no recorder handle");
});

it("a Back that finds no recorder handle lights the marker", () => {
  expect(lightsFailureMarker("recorder-back-no-handle")).toBe(true);
});
