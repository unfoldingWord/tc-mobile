import "fake-indexeddb/auto";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearFailureLog,
  flushFailureLog,
  installFailureLog,
  readFailureLog,
  useFailureCount,
  useMarkedFailureCount,
} from "@/hooks/failure-log";
import { reportFailure } from "@/hooks/report-failure";
import { lightsFailureMarker } from "@/lib/failure-marker";
import { formatFailureLog } from "@/lib/failure-text";
import * as failuresStore from "@/lib/storage/failures";
import {
  appendFailure,
  countFailures,
  countMarkedFailures,
} from "@/lib/storage/failures";
import { clearAllStores } from "./support";

/**
 * Which failure-log rows light the Books ≡ marker (#1005).
 *
 * DRI decision on #1076, verbatim: "Log it, don't light ≡ (Recommended)". A
 * take sealed at the 20-minute cap writes a `"recorder-take-cap"` row. That
 * row stays in the log and goes out with Send, but it is not a failure, so it
 * alone must not mark the ≡ control. Every other context — including one this
 * build has never heard of, from an older or newer build — still lights it.
 *
 * The rows carry no new field: the exclusion is by context, so rows already
 * on a phone are read exactly as before.
 */

const row = (context: string) => ({ at: 1_000, context, message: "m" });

/** Both hook snapshots from one static render, no effects. */
function snapshot(): { total: number; marked: number } {
  let total = -1;
  let marked = -1;
  renderToStaticMarkup(
    createElement(function Probe() {
      total = useFailureCount();
      marked = useMarkedFailureCount();
      return null;
    })
  );
  return { total, marked };
}

describe("lightsFailureMarker", () => {
  it("a take-cap row does not light the marker", () => {
    expect(lightsFailureMarker("recorder-take-cap")).toBe(false);
  });

  it.each([
    "render",
    "save-take",
    "recorder-stop-flush",
    "",
    "from-a-newer-build",
  ])("any other context (%j) lights it, unknown ones included", (context) => {
    expect(lightsFailureMarker(context)).toBe(true);
  });
});

describe("the store's marked count", () => {
  beforeEach(async () => {
    await clearAllStores();
  });

  it("counts every row except informational ones", async () => {
    await appendFailure(row("recorder-take-cap"));
    expect(await countFailures()).toBe(1);
    expect(await countMarkedFailures()).toBe(0);

    await appendFailure(row("save-take"));
    await appendFailure(row("recorder-take-cap"));
    expect(await countFailures()).toBe(3);
    expect(await countMarkedFailures()).toBe(1);
  });
});

describe("the sink: a take-cap row is logged but does not mark ≡", () => {
  let uninstall: (() => void) | null = null;

  beforeEach(async () => {
    await clearAllStores();
    await clearFailureLog();
    uninstall = installFailureLog();
  });

  afterEach(() => {
    uninstall?.();
    uninstall = null;
    vi.restoreAllMocks();
  });

  it("a cap row alone leaves the marker count at 0 while the log holds it", async () => {
    reportFailure(new Error("cap"), "recorder-take-cap");
    await flushFailureLog();

    expect(snapshot()).toEqual({ total: 1, marked: 0 });
  });

  it("a cap row plus a real failure marks it, for the real failure only", async () => {
    reportFailure(new Error("cap"), "recorder-take-cap");
    reportFailure(new Error("boom"), "save-take");
    await flushFailureLog();

    expect(snapshot()).toEqual({ total: 2, marked: 1 });
  });

  it("the cap row is still in the log Send exports", async () => {
    reportFailure(new Error("cap"), "recorder-take-cap");
    await flushFailureLog();

    const { entries } = await readFailureLog();
    expect(entries.map((e) => e.context)).toEqual(["recorder-take-cap"]);
    expect(formatFailureLog(entries, "0.0.0")).toContain("[recorder-take-cap]");
  });

  it("a clear drops the marker count with the rest", async () => {
    reportFailure(new Error("boom"), "save-take");
    await flushFailureLog();
    expect(snapshot().marked).toBe(1);

    await clearFailureLog();
    expect(snapshot()).toEqual({ total: 0, marked: 0 });
  });

  it("when the post-write re-read fails, the fallback advances the marker only for a row that lights it", async () => {
    vi.spyOn(failuresStore, "countMarkedFailures").mockRejectedValueOnce(
      new Error("connection terminated")
    );
    reportFailure(new Error("cap"), "recorder-take-cap");
    await flushFailureLog();
    expect(snapshot()).toEqual({ total: 1, marked: 0 });

    vi.spyOn(failuresStore, "countMarkedFailures").mockRejectedValueOnce(
      new Error("connection terminated")
    );
    reportFailure(new Error("boom"), "save-take");
    await flushFailureLog();
    expect(snapshot()).toEqual({ total: 2, marked: 1 });
  });
});
