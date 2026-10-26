// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useNavStack, type UseNavStack } from "@/hooks/use-nav-stack";

/**
 * A system Back on the recorder runs the sheet's own `requestClose()`. That
 * call never rejects by contract; if it ever did, the rejection was only a
 * console line. It now also writes one failure-log row under
 * `"recorder-close-rejected"`, and the in-flight latch still clears (the
 * `.finally` the source calls load-bearing).
 *
 * Mounts the real `useNavStack` (the `nav-consume-recorder-refusal` harness
 * shape) with a recorder handle whose `requestClose` rejects, then dispatches
 * the popstate a system Back produces.
 */
const boundary = vi.hoisted(() => ({
  report: vi.fn(),
  requestClose: vi.fn(),
}));
vi.mock("@/hooks/report-failure", () => ({ reportFailure: boundary.report }));

function Owner({ handleRef }: { handleRef: { current: UseNavStack | null } }) {
  const handle = useNavStack({
    hasChapter: false,
    recorderOpen: true,
    recovering: false,
    databasePanel: false,
    chapterClipboardHeld: false,
    getRecorderHandle: () => ({
      requestClose: boundary.requestClose,
    }),
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
  boundary.requestClose.mockReset();
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

async function back() {
  const handleRef: { current: UseNavStack | null } = { current: null };
  await act(async () => {
    root.render(createElement(Owner, { handleRef }));
  });
  await act(async () => {
    window.dispatchEvent(
      new PopStateEvent("popstate", { state: { index: -1 } })
    );
  });
}

it('a rejected requestClose reports "recorder-close-rejected" with its cause', async () => {
  const cause = new Error("close rejected");
  boundary.requestClose.mockRejectedValue(cause);

  await back();

  expect(boundary.requestClose).toHaveBeenCalledOnce();
  expect(boundary.report).toHaveBeenCalledExactlyOnceWith(
    cause,
    "recorder-close-rejected"
  );
});

it("a requestClose that resolves writes no row", async () => {
  boundary.requestClose.mockResolvedValue(false);

  await back();

  expect(boundary.requestClose).toHaveBeenCalledOnce();
  expect(boundary.report).not.toHaveBeenCalled();
});
