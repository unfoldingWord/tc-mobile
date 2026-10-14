import { describe, expect, it } from "vitest";

import { withEncoder } from "@/hooks/mp3-codec";
import { isAbortCause } from "@/hooks/phone-check-probes";

/**
 * #1379 item 1: the rejection the REAL encoder lane gives an aborted signal is
 * the signal's own reason, so identity recognises it as the abort's. Only the
 * lane's wait-for-turn path runs here; no worker is started.
 */

async function laneRejection(signal: AbortSignal): Promise<unknown> {
  try {
    await withEncoder(signal, (codec) => codec.encodeMp3(new Int16Array(8)));
  } catch (cause) {
    return cause;
  }
  throw new Error("withEncoder did not reject");
}

describe("withEncoder with an aborted signal", () => {
  it("rejects with the signal's reason after a no-argument abort", async () => {
    const run = new AbortController();
    run.abort();
    const cause = await laneRejection(run.signal);
    expect(cause).toBe(run.signal.reason);
    expect(isAbortCause(cause, run.signal)).toBe(true);
  });

  it("rejects with the custom reason after abort(customReason)", async () => {
    const run = new AbortController();
    run.abort(new Error("custom reason"));
    const cause = await laneRejection(run.signal);
    expect(cause).toBe(run.signal.reason);
    expect(isAbortCause(cause, run.signal)).toBe(true);
  });
});
