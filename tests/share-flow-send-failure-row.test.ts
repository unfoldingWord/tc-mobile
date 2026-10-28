import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useShareFlow } from "@/hooks/share-flow";

/**
 * A share SEND that fails writes one `"share-send"` failure-log row (it used
 * to end at `console.error`); a dismissed chooser writes none. Web Share is
 * stubbed, so this reads what the hook reports, not what a phone does.
 */

const mocks = vi.hoisted(() => ({ reportFailure: vi.fn() }));
vi.mock("@/hooks/report-failure", () => ({
  reportFailure: mocks.reportFailure,
}));

let dom: JSDOM;
let root: Root;
let shareImpl: () => Promise<void>;
const probe: { current: ReturnType<typeof useShareFlow> | null } = {
  current: null,
};
function Probe() {
  const result = useShareFlow();
  useLayoutEffect(() => {
    probe.current = result;
  });
  return null;
}
const hook = () => probe.current!;
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });

beforeEach(async () => {
  mocks.reportFailure.mockReset();
  shareImpl = () => Promise.resolve();
  dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>"
  );
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("navigator", {
    share: vi.fn(() => shareImpl()),
    canShare: () => true,
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  root = createRoot(dom.window.document.getElementById("root")!);
  await act(async () => {
    root.render(createElement(Probe));
  });
});
afterEach(async () => {
  try {
    await act(async () => root.unmount());
  } finally {
    dom.window.close();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  }
});

const built = () => ({
  file: new File([new Uint8Array([1])], "b.zip", { type: "application/zip" }),
  missing: 0,
  release: () => Promise.resolve(),
});

async function prepareAndSend(): Promise<void> {
  let prepared!: Promise<unknown>;
  act(() => {
    prepared = hook().prepare(async () => built());
  });
  await settle();
  await act(async () => prepared);
  expect(hook().status).toBe("ready");
  await act(async () => {
    await hook().send();
  });
}

it('a send that fails writes one "share-send" row', async () => {
  const cause = new Error("share refused");
  shareImpl = () => Promise.reject(cause);

  await prepareAndSend();

  expect(hook().error).toBe("failed");
  expect(mocks.reportFailure).toHaveBeenCalledTimes(1);
  expect(mocks.reportFailure).toHaveBeenCalledWith(cause, "share-send");
});

it("a dismissed chooser writes no row", async () => {
  shareImpl = () => Promise.reject(new DOMException("dismissed", "AbortError"));

  await prepareAndSend();

  expect(mocks.reportFailure).not.toHaveBeenCalled();
});
