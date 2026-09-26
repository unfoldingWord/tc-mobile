// @vitest-environment jsdom
import "fake-indexeddb/auto";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  clearFailureLog,
  flushFailureLog,
  useFailureCount,
  useMarkedFailureCount,
} from "@/hooks/failure-log";
import { appendFailure } from "@/lib/storage/failures";

/**
 * Rows already on disk when Books mounts — a relaunch after a take was sealed
 * at the 20-minute cap (#1005) — go through `useFailureCount`'s own read, not
 * through the sink's post-write re-read that `tests/failure-marker.test.ts`
 * covers. That read must fill the marker count too, or ≡ would stay plain
 * over a real failure from the last session.
 *
 * The rows are written straight to the store, so nothing but the mounted
 * hook's read can put them into the counts.
 */

let root: Root;

/** Renders both counts as `total/marked`, read back from the DOM. */
function Probe() {
  const total = useFailureCount();
  const marked = useMarkedFailureCount();
  return createElement("output", null, `${total}/${marked}`);
}

function seen(): string | null | undefined {
  return document.querySelector("output")?.textContent;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // Empties the store and puts the module counts at a known 0.
  await clearFailureLog();
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root")!);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function mountAndRead() {
  await act(async () => root.render(createElement(Probe)));
  await act(async () => {
    await flushFailureLog();
  });
}

it("a cap row and a real failure left from the last session mark ≡ for the real one only", async () => {
  await appendFailure({ at: 1, context: "recorder-take-cap", message: "m" });
  await appendFailure({ at: 2, context: "save-take", message: "m" });

  await mountAndRead();

  expect(seen()).toBe("2/1");
});

it("a cap row alone left from the last session leaves ≡ plain", async () => {
  await appendFailure({ at: 1, context: "recorder-take-cap", message: "m" });

  await mountAndRead();

  expect(seen()).toBe("1/0");
});
