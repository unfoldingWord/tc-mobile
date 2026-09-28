// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ALLOCATION_BREADCRUMB_KEY } from "@/hooks/phone-check-probes";
import { usePhoneCheck } from "@/hooks/use-phone-check";
import { serializeBreadcrumb } from "@/lib/phone-check/allocation";

/**
 * #1014 item 1: no test failed if `usePhoneCheck` stopped clearing the
 * allocation breadcrumb on mount — the read that recovers a `reloaded`
 * memory-ceiling result is pinned (`tests/phone-check-storage.test.ts`,
 * `tests/phone-check-report.test.ts`), but nothing mounted the hook itself to
 * pin the post-commit clear (`use-phone-check.ts`'s docblock: "The breadcrumb
 * is cleared once read, so the same crash is reported once").
 *
 * `finish-transcode` is stubbed because `runChecks`/`runMemory` pause a
 * background sweep this test never starts; only mounting is under test here,
 * so neither action is called.
 */

vi.mock("@/hooks/finish-transcode", () => ({
  pauseTranscodeSweep: () => {},
  resumeTranscodeSweep: () => {},
  transcodeSweepSettled: () => Promise.resolve(),
}));

function Owner(): null {
  usePhoneCheck();
  return null;
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.sessionStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe("usePhoneCheck clears the allocation breadcrumb on mount (#1014 item 1)", () => {
  it("clears a breadcrumb left by a page the memory ceiling killed", async () => {
    window.sessionStorage.setItem(
      ALLOCATION_BREADCRUMB_KEY,
      serializeBreadcrumb({ attemptingMb: 200, lastOkMb: 175 })
    );

    await act(async () => root.render(createElement(Owner)));

    expect(window.sessionStorage.getItem(ALLOCATION_BREADCRUMB_KEY)).toBeNull();
  });

  it("is a no-op when there was no breadcrumb to begin with", async () => {
    expect(window.sessionStorage.getItem(ALLOCATION_BREADCRUMB_KEY)).toBeNull();
    await act(async () => root.render(createElement(Owner)));
    expect(window.sessionStorage.getItem(ALLOCATION_BREADCRUMB_KEY)).toBeNull();
  });
});
