// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({ clear: vi.fn() }));
vi.mock("@/lib/storage/takes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage/takes")>()),
  clearSegmentTake: storage.clear,
}));

import {
  useEraseSegment,
  type UseEraseSegment,
} from "@/hooks/use-erase-segment";
import type { SegmentId } from "@/types/domain";

/**
 * The in-flight guard of the ONE shared erase (#160, L-12).
 *
 * Until the lift there were two instances of this hook — one per screen — so
 * "two erases cannot overlap" held only because the recorder sheet is modal,
 * the same unwritten premise #642 records for the finished flag. With a single
 * instance the guard is what holds it, which makes it load-bearing, and it had
 * never been tested: `tests/use-erase-segment.test.ts` covers `performErase`
 * and says the guard is review-and-device surface because there was no
 * renderer. There is one now.
 *
 * What is covered is the guard and the refusal contract. Whether each SCREEN
 * then paints the right thing is still component surface.
 */

let root: Root;
let host: HTMLDivElement;
let api: UseEraseSegment;
const seg = (n: number) => `segment-${n}` as SegmentId;

function Harness({ onCommit }: { onCommit: (a: UseEraseSegment) => void }) {
  const erase = useEraseSegment();
  useEffect(() => {
    onCommit(erase);
  });
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  storage.clear.mockReset();
  storage.clear.mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root.render(createElement(Harness, { onCommit: (a) => (api = a) }));
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("useEraseSegment's in-flight guard", () => {
  it("refuses a second erase while the first is still running", async () => {
    // The shape a double-tap makes, and — now that ONE instance serves both
    // screens — the shape two screens would make if both were reachable.
    let finish!: () => void;
    storage.clear.mockImplementation(
      () => new Promise<void>((resolve) => (finish = resolve))
    );

    let first!: Promise<string>;
    let second!: string;
    await act(async () => {
      first = api.erase(seg(1));
      second = await api.erase(seg(2));
    });

    expect(second).toBe("busy");
    // And the SECOND segment was never touched: the refusal happens before any
    // store call, so a refused tap cannot clear audio.
    expect(storage.clear).toHaveBeenCalledTimes(1);
    expect(storage.clear).toHaveBeenCalledWith(seg(1));

    await act(async () => {
      finish();
      await first;
    });
  });

  it("reads as in flight SYNCHRONOUSLY, before any render", async () => {
    // `Layer.busy()` is called from a popstate with no render in between, so a
    // state value would answer for the previous frame and let a system Back
    // tear a dialog down over a committing `clearSegmentTake`.
    let finish!: () => void;
    storage.clear.mockImplementation(
      () => new Promise<void>((resolve) => (finish = resolve))
    );

    expect(api.isErasing()).toBe(false);
    let running!: Promise<string>;
    act(() => {
      running = api.erase(seg(1));
      // INSIDE the act callback, before React flushes. That placement is the
      // whole assertion: `erasing` state is still last frame's `false` here,
      // so a state-backed `isErasing` reads false and this line fails. The
      // same expect AFTER the act block passes either way, because the flush
      // has happened and the harness has republished `api` by then — which is
      // what it used to do (George r8).
      expect(api.isErasing()).toBe(true);
    });
    expect(api.isErasing()).toBe(true);

    await act(async () => {
      finish();
      await running;
    });
    expect(api.isErasing()).toBe(false);
  });

  it("releases the guard after a FAILED erase, so a retry is possible", async () => {
    // A guard left set by a rejection would lock out every later erase — the
    // reason the release is in a `finally`.
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    storage.clear.mockRejectedValue(new Error("no space"));

    let outcome!: string;
    await act(async () => {
      outcome = await api.erase(seg(1));
    });

    expect(outcome).toBe("failed");
    expect(api.isErasing()).toBe(false);

    storage.clear.mockResolvedValue(undefined);
    await act(async () => {
      outcome = await api.erase(seg(1));
    });
    expect(outcome).toBe("ok");
    consoleError.mockRestore();
  });

  it("carries no error of its own — the caller owns whose failure it was", () => {
    // The field that made one shared instance unsafe. Both screens only ever
    // read it as a boolean and rendered a constant, while SHARING it would have
    // painted a list erase's failure inside the recorder sheet.
    expect(Object.keys(api).sort()).toEqual(["erase", "erasing", "isErasing"]);
  });
});
