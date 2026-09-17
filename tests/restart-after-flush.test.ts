import { describe, expect, it, vi } from "vitest";

import { restartAfterFlush } from "@/lib/restart-after-flush";

/**
 * `SaveFailed`'s terminal restart (#458): the same invariant `ErrorBoundary`'s
 * `RestartControl` already keeps for the crash screen — do not unload the
 * document while a failure-log write is in flight — applied to the second
 * full-screen restart this app has.
 *
 * What this can and cannot prove, same limits as `tests/error-boundary.test.ts`:
 * there is no renderer here (`vitest.config.ts` sets `environment: "node"`, no
 * jsdom), so `SaveFailed`'s button click, its `busy` paint and the relabel to
 * `strings.appReloading` are NOT exercised below — only read and stated, not
 * tested. `window.location.reload()` itself has no seam in a Node suite either
 * way. `restartAfterFlush` takes the reload as a plain callback for exactly
 * this reason: the ordering (flush before reload) and the re-entrancy guard (a
 * second tap while one is already in flight) are real logic, independent of
 * the DOM, and are what this file covers.
 */
describe("restartAfterFlush", () => {
  it("awaits the flush before reloading", async () => {
    const order: string[] = [];
    const flush = () =>
      new Promise<void>((resolve) => {
        order.push("flush-start");
        // A microtask delay, not an immediately-resolved promise: if the
        // implementation ever stops awaiting `flush()`, `reload` would land
        // before "flush-end" instead of after it.
        void Promise.resolve().then(() => {
          order.push("flush-end");
          resolve();
        });
      });
    const reloadPage = () => order.push("reload");
    const markRestarting = vi.fn();

    await restartAfterFlush(false, markRestarting, flush, reloadPage);

    expect(order).toEqual(["flush-start", "flush-end", "reload"]);
    expect(markRestarting).toHaveBeenCalledOnce();
  });

  it("does not flush or reload again while a restart is already in flight", async () => {
    const flush = vi.fn().mockResolvedValue(undefined);
    const reloadPage = vi.fn();
    const markRestarting = vi.fn();

    await restartAfterFlush(true, markRestarting, flush, reloadPage);

    expect(flush).not.toHaveBeenCalled();
    expect(reloadPage).not.toHaveBeenCalled();
    expect(markRestarting).not.toHaveBeenCalled();
  });
});
