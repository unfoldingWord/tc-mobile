/**
 * The "consume outstanding" latch (#435): no history WRITE is issued while an
 * app-issued `history.back()` has not yet landed.
 *
 * Every `history.back()` this app issues lands a task later, as a `popstate`.
 * Until it does, the screen it is leaving is still showing and still live, so
 * a tap in that window can reach a command that writes history — `enterScreen`
 * (`openChapter` / `openRecorder`) or the floor arm (`pushLayer`). This file
 * does not depend on what a platform does with a `pushState` or
 * `replaceState` issued while a traversal is pending; it removes the overlap,
 * so the app never has to know. If the Back lands somewhere the app's refs
 * did not expect, the screen stack and the history stack disagree, and a
 * later Back can leave the document from a screen that should have had an
 * entry beneath it (the #58 class). The adapter reaches this state only when
 * a second tap arrives before a `popstate` does — a defensive invariant, not
 * an observed field failure. This file decides what such a write does
 * instead.
 *
 * Two kinds of outstanding Back, because their landings do different things
 * (the adapter's `popstate` handler, `hooks/use-nav-stack.ts`):
 *
 * - `"absorbed"` — `suppressPop` is set. The landing is one the app caused to
 *   consume or cancel an entry (the programmatic recorder close, the
 *   `trap-forward` cancel, the commit-close settle); it routes nothing and
 *   leaves the screen as it is. A write requested now is still wanted after
 *   it, for the same screen, so it is DEFERRED and replayed at the landing.
 * - `"routed"` — a `goBack` is outstanding (`TravelGuardState`) and nothing
 *   suppresses its landing, so that landing is routed through `popAction` and
 *   decides the next screen. A screen transition requested now is for the
 *   screen that Back is leaving: running it would move the screen out from
 *   under the routing (a recorder opened over Segments is then what the Back
 *   routes as `"commit-close-recorder"`), and replaying it after the landing would open
 *   it over whatever screen the Back lands on. So `"enter-screen"` is REFUSED —
 *   the whole transition, state half included, the same as `beginBack`'s
 *   refusal does nothing. The floor arm is different only because it cannot
 *   be refused: the overlay it protects has already opened in the same click
 *   handler (invariant 6), so the arm is deferred and re-derived at the
 *   landing, where the routing may have dismissed that overlay already.
 *
 * `suppressPop` is checked first. The commit-close settle sets it while a
 * `goBack` is still outstanding (the refused-settle branch), and then that
 * `goBack`'s landing is the one absorbed — so both being set reads `"absorbed"`.
 *
 * Replaying at the landing goes back through this same decision, so a write
 * whose landing issued another Back of its own (`trap-forward`) is deferred
 * again rather than written under it. Each replay re-derives what it writes
 * from the state at that moment rather than from the state at request time;
 * that half is the adapter's (`enterScreen` reads `floorArmed`, the arm reads
 * `floorEntryForLayerChange`).
 *
 * `goBack` is not a write and is not routed through here: it is a traversal,
 * and its own refusal already covers both kinds (`beginBack` for a routed
 * Back, its `suppressPop` check for an absorbed one). `backToBooks` writes no
 * history at all — it runs from a landing (`"to-books"`).
 *
 * Pure: no DOM, no `window`, no React (AGENTS.md — `lib/` stays DOM-free).
 */

import type { TravelGuardState } from "@/lib/nav/travel-guard";

/** The history writes a UI command can request. */
export type HistoryWrite =
  /** `enterScreen`: the protective entry for Segments or the Recorder. */
  | "enter-screen"
  /** The floor screen's one protective entry, armed by `pushLayer`. */
  | "arm-floor";

/** Whether an app-issued `history.back()` is still waiting to land, and how. */
export type OutstandingConsume = "none" | "absorbed" | "routed";

export function outstandingConsume(
  suppressPop: boolean,
  guard: TravelGuardState
): OutstandingConsume {
  if (suppressPop) return "absorbed";
  if (guard.goBackOutstanding || guard.commitCloseOutstanding) return "routed";
  return "none";
}

/**
 * - `"write"` — nothing is outstanding; issue the write now.
 * - `"defer"` — hold it and replay it when the outstanding Back lands.
 * - `"refuse"` — do not perform the command at all (neither half).
 */
export type HistoryWriteDecision = "write" | "defer" | "refuse";

export function historyWriteDecision(
  write: HistoryWrite,
  outstanding: OutstandingConsume
): HistoryWriteDecision {
  switch (outstanding) {
    case "none":
      return "write";
    case "absorbed":
      return "defer";
    case "routed":
      return write === "enter-screen" ? "refuse" : "defer";
  }
}

/**
 * What a DEFERRED write does when it is replayed at a landing. Never a
 * refusal: a deferred `"enter-screen"` already ran its state half, so the
 * screen it protects is showing, and dropping its entry now would leave that
 * screen with nothing beneath it. If another Back is outstanding by then, the
 * write waits for that one too.
 */
export function replayDecision(
  outstanding: OutstandingConsume
): Exclude<HistoryWriteDecision, "refuse"> {
  return outstanding === "none" ? "write" : "defer";
}
