import { describe, expect, it } from "vitest";

import {
  allocationSteps,
  errorName,
  parseBreadcrumb,
  reloadedResult,
  runAllocationSteps,
  serializeBreadcrumb,
  type AllocationBreadcrumb,
} from "@/lib/phone-check/allocation";

/**
 * #1009 — the memory ceiling's step loop and its reload breadcrumb.
 *
 * The contract pinned here: the breadcrumb is written BEFORE each step and
 * names the total about to be tried and the last total that succeeded; every
 * returning path clears it; the reported number is the last total that
 * SUCCEEDED (#1009: "Report the last size that succeeded").
 */

function harness(failAtCall: number | null) {
  const writes: (AllocationBreadcrumb | null)[] = [];
  const allocated: number[] = [];
  let calls = 0;
  return {
    writes,
    allocated,
    deps: {
      allocate(mb: number) {
        calls += 1;
        if (calls === failAtCall)
          throw new RangeError("Array buffer allocation failed");
        allocated.push(mb);
      },
      writeBreadcrumb: (crumb: AllocationBreadcrumb | null) => {
        writes.push(crumb);
      },
      yieldTurn: () => Promise.resolve(),
    },
  };
}

describe("allocationSteps", () => {
  it("is 25 MB steps from 25 to 400 inclusive", () => {
    const steps = allocationSteps();
    expect(steps[0]).toBe(25);
    expect(steps.at(-1)).toBe(400);
    expect(steps).toHaveLength(16);
    expect(steps.every((mb, i) => mb === 25 * (i + 1))).toBe(true);
  });
});

describe("the breadcrumb", () => {
  it("round-trips", () => {
    const crumb = { attemptingMb: 175, lastOkMb: 150 };
    expect(parseBreadcrumb(serializeBreadcrumb(crumb))).toEqual(crumb);
  });

  it.each([
    null,
    "",
    "not json",
    "null",
    "42",
    '{"attemptingMb":"175","lastOkMb":150}',
    '{"attemptingMb":175}',
    '{"attemptingMb":-25,"lastOkMb":0}',
  ])("reads %j as no prior attempt rather than throwing", (raw) => {
    expect(parseBreadcrumb(raw)).toBeNull();
  });

  it("becomes a reloaded result carrying both numbers", () => {
    expect(reloadedResult({ attemptingMb: 175, lastOkMb: 150 })).toEqual({
      kind: "reloaded",
      lastOkMb: 150,
      attemptingMb: 175,
    });
  });
});

describe("runAllocationSteps", () => {
  it("writes the breadcrumb before every step, then clears it", async () => {
    const h = harness(null);
    const result = await runAllocationSteps({ ...h.deps, steps: [25, 50, 75] });
    expect(result).toEqual({ kind: "completed", lastOkMb: 75 });
    expect(h.writes).toEqual([
      { attemptingMb: 25, lastOkMb: 0 },
      { attemptingMb: 50, lastOkMb: 25 },
      { attemptingMb: 75, lastOkMb: 50 },
      null,
    ]);
    // Each step adds only the difference, so the total held is the step total.
    expect(h.allocated).toEqual([25, 25, 25]);
  });

  it("orders each write before its allocation, so a page killed mid-step leaves it", async () => {
    const order: string[] = [];
    await runAllocationSteps({
      steps: [25, 50],
      allocate: (mb) => order.push(`allocate ${mb}`),
      writeBreadcrumb: (crumb) =>
        order.push(crumb ? `crumb ${crumb.attemptingMb}` : "clear"),
      yieldTurn: () => Promise.resolve(),
    });
    expect(order).toEqual([
      "crumb 25",
      "allocate 25",
      "crumb 50",
      "allocate 25",
      "clear",
    ]);
  });

  it("reports the last total that succeeded when a step throws, and clears the breadcrumb", async () => {
    const h = harness(3);
    const result = await runAllocationSteps({
      ...h.deps,
      steps: [25, 50, 75, 100],
    });
    expect(result).toEqual({
      kind: "failed",
      lastOkMb: 50,
      failedAtMb: 75,
      errorName: "RangeError",
    });
    expect(h.writes.at(-1)).toBeNull();
  });

  it("reports zero succeeded when the very first step fails", async () => {
    const h = harness(1);
    const result = await runAllocationSteps({ ...h.deps, steps: [25, 50] });
    expect(result).toMatchObject({
      kind: "failed",
      lastOkMb: 0,
      failedAtMb: 25,
    });
  });
});

describe("errorName", () => {
  it("is the thrown object's name, or a fixed stand-in", () => {
    expect(errorName(new RangeError("x"))).toBe("RangeError");
    expect(errorName("a string")).toBe("unknown error");
    expect(errorName({ name: "" })).toBe("unknown error");
  });
});
