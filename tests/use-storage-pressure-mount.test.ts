// @vitest-environment jsdom
import {
  act,
  createElement,
  createRef,
  forwardRef,
  useImperativeHandle,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  bumpStoragePressure,
  useStoragePressure,
} from "@/hooks/use-storage-pressure";
import type { StoragePressureMarker } from "@/lib/storage/pressure";

/**
 * Mounts the real `useStoragePressure` (`src/hooks/use-storage-pressure.ts`)
 * in the jsdom hook-mount shape `tests/use-segment-editor-mount.test.ts`
 * already uses for a different hook (wrapper component, `createRoot`, `act`),
 * over a stubbed `navigator.storage.estimate()`.
 *
 * #843 item 2: `useStoragePressure`'s effect used to list `generationValue`
 * (the module-scope bump counter, `bumpStoragePressure`'s own docblock) as a
 * dependency purely to force a re-run on a bump, with nothing in the effect
 * body reading the value — a shape no test in this repo could catch a
 * "this dependency looks unused" cleanup removing, because nothing mounted
 * this effect at all. The hook now reads that value (see its own docblock),
 * and this file is what mounts it: the one assertion below that matters for
 * item 2 is that a bump makes `estimate()` get asked again and the returned
 * marker reflect the new answer — remove `generationValue` from that effect's
 * dependency array and this is the test that goes red, because the second
 * `estimate()` call, and the marker update that depends on it, never happen.
 *
 * What this does NOT establish: the `requestGeneration`-vs-`cancelled`
 * distinction inside the effect (see that effect's own comment) — `act()`
 * flushes this effect's cleanup before this harness's next assertion runs
 * either way, so both guards read as equivalent here. That gap is real-browser
 * timing and stays review/on-device surface, not claimed as tested by this
 * file.
 */

interface HarnessHandle {
  readonly marker: StoragePressureMarker | null;
}

const Harness = forwardRef<HarnessHandle>(function Harness(_props, ref) {
  const marker = useStoragePressure();
  useImperativeHandle(ref, () => ({ marker }), [marker]);
  return null;
});

let root: Root;
let container: HTMLDivElement;
let estimate: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  estimate = vi.fn();
  // Same pattern `tests/use-recorder-release-refs.test.ts` uses for
  // `navigator.mediaDevices`: jsdom's own `navigator` has no `storage`, so
  // this defines it for the duration of one test and removes it after.
  Object.defineProperty(navigator, "storage", {
    value: { estimate },
    configurable: true,
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  delete (navigator as unknown as { storage?: unknown }).storage;
});

async function mount(): Promise<() => HarnessHandle> {
  const ref = createRef<HarnessHandle>();
  await act(async () => {
    root.render(createElement(Harness, { ref }));
  });
  return () => {
    if (!ref.current) {
      throw new Error("Harness did not mount useStoragePressure");
    }
    return ref.current;
  };
}

/** Drains the microtask queue enough for the effect's `readStorageEstimate(
 * ...).then(...)` chain to settle, the same shape
 * `tests/use-audio-session-harness.ts`'s `flush` uses for a different hook's
 * awaited chain. */
async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

describe("useStoragePressure mounted", () => {
  it("re-reads estimate() after a bump, and the marker reflects the new answer (#843 item 2)", async () => {
    // 975 MB used of 1 GB: 25 MB (2.5%) free, under both the critical byte
    // floor (30 MB) and the critical percent floor (5%).
    estimate.mockResolvedValueOnce({
      usage: 975_000_000,
      quota: 1_000_000_000,
    });
    const api = await mount();
    await flush();
    expect(estimate).toHaveBeenCalledTimes(1);
    expect(api().marker).toBe("critical");

    // 100 MB used of 1 GB: 90% free, clear of every floor — a different band,
    // so this assertion cannot pass on a stale first reading replayed by
    // coincidence.
    estimate.mockResolvedValueOnce({
      usage: 100_000_000,
      quota: 1_000_000_000,
    });
    await act(async () => {
      bumpStoragePressure();
    });
    await flush();

    // The dependency this test exists to pin: without `generationValue` in
    // the effect's dependency array, this second call never happens and the
    // assertion below fails on the count alone.
    expect(estimate).toHaveBeenCalledTimes(2);
    expect(api().marker).toBeNull();
  });
});
