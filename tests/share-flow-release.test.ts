import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useShareFlow } from "@/hooks/share-flow";

/**
 * `useShareFlow` releases a prepared File's backing spool (#1003) on the two
 * prepare exits `use-book-share-spool.test.ts` cannot time through a real
 * export: a cancel that lands after the build has already returned, and a
 * File the browser refuses to share. Builders here are hand-written, so the
 * moment the build resolves is the test's to choose. Web Share is stubbed;
 * no browser or phone ran this.
 */

vi.mock("@/hooks/report-failure", () => ({ reportFailure: vi.fn() }));

let dom: JSDOM;
let root: Root;
let canShare: boolean;
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
  canShare = true;
  dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>"
  );
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("navigator", {
    share: vi.fn(() => Promise.resolve()),
    canShare: () => canShare,
  });
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
  }
});

const built = (release: () => Promise<void>) => ({
  file: new File([new Uint8Array([1])], "b.zip", { type: "application/zip" }),
  missing: 0,
  release,
});

it("releases the File's spool when a reset lands after the build returned but before the flow armed it", async () => {
  const release = vi.fn(() => Promise.resolve());
  let finishBuild!: () => void;
  let markBuildStarted!: () => void;
  const buildStarted = new Promise<void>((r) => {
    markBuildStarted = r;
  });
  let prepared!: Promise<unknown>;
  act(() => {
    prepared = hook().prepare(
      () =>
        new Promise((resolve) => {
          // The build is done and hands its File back only once the run is
          // already stale: nothing checks `isCurrent` after this.
          finishBuild = () => resolve(built(release));
          markBuildStarted();
        })
    );
  });
  await act(async () => {
    await buildStarted;
  });
  act(() => hook().reset());
  finishBuild();
  await act(async () => prepared);
  expect(release).toHaveBeenCalledTimes(1);
  expect(hook().status).toBe("idle");
});

it("releases the File's spool when the browser refuses to share that File", async () => {
  canShare = false;
  const release = vi.fn(() => Promise.resolve());
  let prepared!: Promise<unknown>;
  act(() => {
    prepared = hook().prepare(async () => built(release));
  });
  await settle();
  await act(async () => prepared);
  expect(hook().error).toBe("failed");
  expect(release).toHaveBeenCalledTimes(1);
});

it("does not release a File it armed until that File is done with", async () => {
  const release = vi.fn(() => Promise.resolve());
  let prepared!: Promise<unknown>;
  act(() => {
    prepared = hook().prepare(async () => built(release));
  });
  await settle();
  await act(async () => prepared);
  expect(hook().status).toBe("ready");
  expect(release).not.toHaveBeenCalled();
  act(() => hook().reset());
  expect(release).toHaveBeenCalledTimes(1);
});
