import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { PhoneCheckView } from "@/components/phone-check-screen";
import { copyText } from "@/hooks/copy-text";
import type { PhoneCheckState } from "@/hooks/use-phone-check";
import {
  REVEAL_TAPS,
  REVEAL_WINDOW_MS,
  registerTap,
} from "@/lib/phone-check/reveal";
import { strings } from "@/lib/strings";

import { one, render } from "./render";

/**
 * #1009 — the ways into the phone check, what it shows before anything runs,
 * and the Copy button's fallback.
 *
 * The render half is one static render (tests/render.ts): no effects, no
 * events. So the tap gesture and the copy are tested as the pure functions
 * the components call, and the render asserts only what the markup carries.
 */

describe("the build-stamp reveal gesture", () => {
  it(`opens on the ${REVEAL_TAPS}th tap inside the window`, () => {
    let taps: readonly number[] = [];
    const reveals: boolean[] = [];
    for (let i = 0; i < REVEAL_TAPS; i++) {
      const next = registerTap(taps, 1000 + i * 100);
      taps = next.taps;
      reveals.push(next.reveal);
    }
    expect(reveals).toEqual([
      ...Array<boolean>(REVEAL_TAPS - 1).fill(false),
      true,
    ]);
    expect(taps).toEqual([]);
  });

  it("does not open for taps spread wider than the window", () => {
    let taps: readonly number[] = [];
    let revealed = false;
    for (let i = 0; i < REVEAL_TAPS * 3; i++) {
      const next = registerTap(
        taps,
        i * (REVEAL_WINDOW_MS / (REVEAL_TAPS - 1))
      );
      taps = next.taps;
      revealed ||= next.reveal;
    }
    expect(revealed).toBe(false);
  });
});

const IDLE: PhoneCheckState = {
  device: null,
  encode: null,
  storage: null,
  allocation: null,
  activity: null,
};

const noop = () => {};

function view(state: PhoneCheckState): Element {
  return render(
    createElement(PhoneCheckView, {
      state,
      version: "0.2.12",
      sha: "abc1234",
      onStart: noop,
      onStartMemory: noop,
      onClose: noop,
    })
  );
}

describe("PhoneCheckView", () => {
  it("shows the Start controls and a not-run report before anything runs", () => {
    const root = view(IDLE);
    expect(one(root, '[data-phone-check="start"]').textContent).toBe(
      strings.phoneCheckStart
    );
    const memory = one(root, '[data-phone-check="memory"]');
    expect(memory.hasAttribute("disabled")).toBe(false);
    // The warning is tied to the memory control, not merely nearby.
    const warning = one(
      root,
      `#${memory.getAttribute("aria-describedby") ?? "missing"}`
    );
    expect(warning.textContent).toBe(strings.phoneCheckMemoryWarning);
    const report = one(root, '[data-phone-check="report"]');
    expect(report.hasAttribute("readonly")).toBe(true);
    expect(report.textContent).toContain("build v0.2.12 · abc1234");
    expect(report.textContent).toContain("Memory ceiling\n- not run");
  });

  it("disables both Starts while a probe runs, so two cannot overlap", () => {
    const root = view({ ...IDLE, activity: { kind: "memory", mb: 75 } });
    expect(
      one(root, '[data-phone-check="start"]').hasAttribute("disabled")
    ).toBe(true);
    expect(
      one(root, '[data-phone-check="memory"]').hasAttribute("disabled")
    ).toBe(true);
    expect(root.textContent).toContain(strings.phoneCheckMemoryStep(75));
  });

  // Closing mid-run would put Books back on screen while the memory ceiling
  // keeps allocating, or the 5-minute encode keeps the encoder lane, under a
  // translator who can then start a take. So Close waits for the run.
  it("disables Close while a probe runs, and enables it when idle", () => {
    const close = (root: Element) =>
      one(root, '[data-phone-check="close"]').hasAttribute("disabled");
    expect(close(view(IDLE))).toBe(false);
    for (const activity of [
      { kind: "waiting" },
      { kind: "device" },
      { kind: "encode" },
      { kind: "storage" },
      { kind: "memory", mb: 25 },
    ] as const) {
      expect(close(view({ ...IDLE, activity }))).toBe(true);
    }
  });

  it("shows a reload recovered from the breadcrumb in the report", () => {
    const root = view({
      ...IDLE,
      allocation: { kind: "reloaded", lastOkMb: 150, attemptingMb: 175 },
    });
    expect(one(root, '[data-phone-check="report"]').textContent).toContain(
      "- Last succeeded: 150 MB\n- The page reloaded while trying 175 MB"
    );
  });
});

describe("copyText", () => {
  it("prefers the Clipboard API and does not select", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    const select = vi.fn();
    await expect(copyText("report", { writeText }, select)).resolves.toBe(
      "copied"
    );
    expect(writeText).toHaveBeenCalledWith("report");
    expect(select).not.toHaveBeenCalled();
  });

  it("calls writeText synchronously, inside the tap", () => {
    const writeText = vi.fn(() => Promise.resolve());
    void copyText("report", { writeText }, vi.fn());
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it("selects when the Clipboard API rejects", async () => {
    const select = vi.fn();
    await expect(
      copyText(
        "report",
        { writeText: () => Promise.reject(new Error("denied")) },
        select
      )
    ).resolves.toBe("selected");
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("selects when the Clipboard API throws synchronously", async () => {
    const select = vi.fn();
    await expect(
      copyText(
        "report",
        {
          writeText: () => {
            throw new Error("not allowed");
          },
        },
        select
      )
    ).resolves.toBe("selected");
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("selects when there is no Clipboard API", async () => {
    const select = vi.fn();
    await expect(copyText("report", undefined, select)).resolves.toBe(
      "selected"
    );
    expect(select).toHaveBeenCalledTimes(1);
  });
});
