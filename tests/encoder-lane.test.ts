import { describe, expect, it } from "vitest";

import { withEncoder } from "@/hooks/mp3-codec";

/**
 * The single encoder lane (B8, round-1 George G1).
 *
 * `withEncoder` is browser glue around a Web Worker, but the property that
 * matters — no two encode-bearing jobs run at once, whatever aborts — is plain
 * promise sequencing and is testable here with work that never touches the
 * codec. The worker round-trip itself is verified in a browser, not here.
 */

/** A job that records when it runs and holds the lane until told to let go. */
function job(log: string[], name: string) {
  let finish!: () => void;
  const done = new Promise<void>((r) => {
    finish = r;
  });
  const started = new Promise<void>((startedResolve) => {
    void withEncoder(undefined, async () => {
      log.push(`${name}:start`);
      startedResolve();
      await done;
      log.push(`${name}:end`);
    });
  });
  return { started, finish };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("withEncoder — the single lane", () => {
  it("runs jobs one at a time, in order", async () => {
    const log: string[] = [];
    const a = job(log, "a");
    const b = job(log, "b");
    await a.started;
    await tick();
    // b must not have started while a holds the lane.
    expect(log).toEqual(["a:start"]);
    a.finish();
    await b.started;
    expect(log).toEqual(["a:start", "a:end", "b:start"]);
    b.finish();
    await tick();
    expect(log).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  it("rejects a job aborted while it waits, without letting it in", async () => {
    const log: string[] = [];
    const a = job(log, "a");
    await a.started;
    const controller = new AbortController();
    const waiting = withEncoder(controller.signal, async () => {
      log.push("aborted-job:start");
    });
    controller.abort(new Error("dismissed"));
    await expect(waiting).rejects.toThrow("dismissed");
    a.finish();
    await tick();
    // The aborted job never ran, and the lane is intact for the next one.
    expect(log).toEqual(["a:start", "a:end"]);
    const c = job(log, "c");
    await c.started;
    c.finish();
    await tick();
    expect(log.at(-1)).toBe("c:end");
  });

  it("does not hand the lane to the next job when a WAITING job aborts", async () => {
    // The release-ordering guard: an aborted waiter must release only after the
    // job ahead of it has finished, or the job behind it would run alongside
    // the encode still in flight.
    const log: string[] = [];
    const a = job(log, "a");
    await a.started;
    const controller = new AbortController();
    const aborted = withEncoder(controller.signal, async () => {
      log.push("aborted:start");
    });
    const c = job(log, "c");
    controller.abort();
    await aborted.catch(() => {});
    await tick();
    expect(log).toEqual(["a:start"]); // c is still waiting on a
    a.finish();
    await c.started;
    expect(log).toEqual(["a:start", "a:end", "c:start"]);
    c.finish();
  });

  it("rejects immediately on an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      withEncoder(controller.signal, async () => "ran")
    ).rejects.toBeInstanceOf(DOMException);
  });

  it("propagates the work's rejection and frees the lane", async () => {
    await expect(
      withEncoder(undefined, async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(await withEncoder(undefined, async () => "next")).toBe("next");
  });
});
