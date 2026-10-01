/**
 * Flush the failure log before reloading (#458, George R9 P2-2).
 *
 * `ErrorBoundary`'s `RestartControl` (`error-boundary.tsx`) already keeps the
 * invariant #440 built the durable log around — do not unload the document
 * while a log write is in flight — but `SaveFailed`'s own terminal restart
 * never picked it up. Nothing that failed to save is at stake here (that
 * recording is RAM-only and this reload was always going to lose it); what a
 * bare reload can still lose is a DIAGNOSTIC row on the SAME lane — this
 * screen's own failure entry, or a `transcode-segment` row the sweep queued
 * behind it (`hooks/finish-transcode.ts`) — which is exactly the record a
 * facilitator reaches this screen needing.
 *
 * Deliberately NOT the fuller `reload()` in `error-boundary.tsx`: that one also
 * checks `renderFailureStored()` / `retryRenderFailureWrite()` and holds for a
 * clearable refusal, because a render-phase throw's OWN row is often the
 * `getDb` open itself and can be refused before it lands. A save failure is not
 * that case — the failure this screen shows already happened after a
 * successful open — so there is nothing here worth holding for, only the lane
 * worth waiting on. `flushFailureLog()` (`hooks/failure-log.ts`) cannot reject
 * (its own docblock: the lane is kept settled by `enqueue`), and there is
 * deliberately no timeout, the same call the DRI made for the crash screen at
 * round 5 (`busy` yes, timeout no): if the lane never settles, the caller stays
 * busy rather than risk the unload losing the row it exists to protect.
 *
 * `alreadyRestarting` guards re-entrancy at the call itself, not only through
 * `Control`'s own busy-disables-`onClick` — closure state read at the tap that
 * arms the caller's busy flag can otherwise race a second tap fired before
 * React commits the re-render, the same defensive shape `RestartControl` uses.
 *
 * Generic and DOM-free on purpose, so it lives in `lib/` rather than beside the
 * one component that calls it today: `flush` and `reloadPage` are both plain
 * callbacks, which is also what makes the ordering testable in Node, where
 * `window` does not exist (see `tests/restart-after-flush.test.ts`).
 * `window.location.reload()` itself has no seam in a Node suite and is not
 * claimed as covered — same limit `error-boundary.tsx`'s `reload()` states for
 * its own call.
 */
export async function restartAfterFlush(
  alreadyRestarting: boolean,
  markRestarting: () => void,
  flush: () => Promise<void>,
  reloadPage: () => void
): Promise<void> {
  if (alreadyRestarting) return;
  markRestarting();
  await flush();
  reloadPage();
}
