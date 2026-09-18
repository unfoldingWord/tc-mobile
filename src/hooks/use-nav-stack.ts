import { useCallback, useEffect, useRef } from "react";

import { topLayer, type Layer } from "@/lib/nav/layer-stack";
import {
  navDirection,
  popAction,
  resumeNavIndex,
  screenFor,
} from "@/lib/nav/navigation";
import {
  beginBack,
  initialTravelGuardState,
  settleOutstanding,
  type TravelGuardState,
} from "@/lib/nav/travel-guard";
import type { ChapterId, SegmentId } from "@/types/domain";

/**
 * The history adapter for the pivot's system-Back model (#452 PR2,
 * docs/design/back-navigation.md "PR split" item 2). It is the ONE file that
 * touches `window.history` / `window.popstate` — the pure decisions it composes
 * (`popAction`, `navDirection`, `screenFor`, `resumeNavIndex`, `beginBack` /
 * `settleOutstanding`, `routeBackToLayer` via `popAction`) all live, tested, in
 * `src/lib/nav`. Extracting App.tsx's inline refs/effects here is what lets the
 * onion keep the routing logic Node-testable while the browser wiring stays in
 * one reviewable place (AGENTS.md: no jsdom/renderer here, so this file is
 * review-only + on-device for its DOM paths).
 *
 * What the adapter owns (six refs + one drain slot):
 *   - `navIndex` / `nextIndex` — the monotonic depth stamp (invariant 9). Both
 *     seed from `resumeNavIndex` on mount (Amendment B): a reload mid-stack
 *     ADOPTS the entry already there rather than rewriting it to 0.
 *   - `layerStack` — the screen-scoped overlay stack (invariant 1/3). EMPTY in
 *     PR2: nothing calls `pushLayer` until Books'/Segments' overlays convert in
 *     PR3/PR4, so the two layer tags are unreachable-by-construction and every
 *     Back routes exactly as `develop` does today. Not a stub — a functional,
 *     empty stack with its full API, per the design's "an empty layer stack is
 *     fine, a half-built overlay conversion is not".
 *   - `travelGuard` — the any-outstanding guard (Amendment A). `goBack` and the
 *     commit-close settle call `beginBack`; every popstate landing clears it
 *     with `settleOutstanding` (issuer-blind, mirroring `develop`'s
 *     `backRequested` clear at the top of the handler). This REPLACES the
 *     `backRequested` double-tap latch — not `suppressPop`, which is kept.
 *   - `transitionInFlight` — the recorder-commit-close in-flight absorber
 *     (renamed from `committing`, invariant 7). While set, every popstate
 *     re-arms instead of routing (the #58/#168 data-loss guard).
 *   - `suppressPop` — KEPT verbatim (travel-guard.ts:15-32): the "this popstate
 *     is one WE caused, do not route it" flag, set at three sites — the
 *     programmatic close (`commitCloseRecorder`), `trap-forward`'s cancel, and
 *     the commit-close settle. `commitCloseRecorder`'s own raw `history.back()`
 *     is a THIRD raw issuer OUTSIDE `TravelGuardState`, suppressed rather than
 *     arbitrated; it is never fed to `beginBack`.
 *   - `pendingCommitClose` — a one-slot drain (invariant 8, latest-wins) for
 *     the rare race where the commit-close settle's `beginBack("commit-close")`
 *     is REFUSED because a `goBack` is still outstanding. See the popstate
 *     handler.
 *
 * Amendment C is a centrally-owned cleanup effect (dep array `[screen,
 * recovering, databasePanel]`, primitives only — invariant 6) that clears the
 * whole layer stack when the screen changes or a global trap engages. Inert in
 * PR2 (empty stack).
 *
 * The re-arm/settle contract, verbatim, so App.tsx does not have to re-derive
 * it: every non-screen popstate intercept (`trap-*` / `rearm-*`) re-arms the
 * screen-depth entry the browser already popped; `goBack` proceeds only when
 * the guard is clear and does NOTHING on refusal; `settleOutstanding` clears
 * the guard at the top of every landing.
 */

/**
 * The slice of the recorder's imperative handle this adapter needs. Declared
 * here — NOT imported from `@/components/recorder` — because a hook may not
 * import a component (the onion rule, enforced by `no-restricted-imports`).
 * `RecorderHandle` is structurally a superset, so `() => recorderRef.current`
 * satisfies this getter.
 */
interface RecorderCloseHandle {
  requestClose: () => Promise<boolean>;
}

export interface UseNavStackParams {
  /** `chapterId !== null` — the popstate handler and Amendment C read this. */
  readonly hasChapter: boolean;
  /** `recorder !== null`. */
  readonly recorderOpen: boolean;
  /** The `SaveFailed` modal is up — outranks screen routing (George R2 G2). */
  readonly recovering: boolean;
  /** The database panel modal is up — outranks screen routing (George R3 P3). */
  readonly databasePanel: boolean;
  /**
   * The recorder's close handle at the moment a commit-close Back lands, or
   * `null` if the sheet is gone. `() => recorderRef.current`.
   */
  readonly getRecorderHandle: () => RecorderCloseHandle | null;
  /** Books → Segments state half (App's `openChapter` minus the history push). */
  readonly onOpenChapter: (id: ChapterId) => void;
  /** Segments → Recorder state half (App's `openRecorder` minus the push). */
  readonly onOpenRecorder: (segmentId: SegmentId, ordinal: number) => void;
  /** Segments → Books (App's `backToBooks`; no push — the browser already popped). */
  readonly onLeaveToBooks: () => void;
  /** Recorder close state half (App's `closeRecorder` minus the history tail). */
  readonly onRecorderClosed: (dirty: boolean) => void;
}

export interface UseNavStack {
  /** Register an overlay (PR3/PR4 click handlers; unused in PR2). */
  readonly pushLayer: (layer: Layer) => void;
  /** Unregister an overlay by id, idempotent (the rearm-layer-dismiss case). */
  readonly popLayer: (id: string) => void;
  /** Books → Segments: the state half plus the protective push. */
  readonly openChapter: (id: ChapterId) => void;
  /** Segments → Recorder: the state half plus the protective push. */
  readonly openRecorder: (segmentId: SegmentId, ordinal: number) => void;
  /** One Back path (#168). `beginBack("go-back")`; on refusal, does nothing. */
  readonly goBack: () => void;
  /** The programmatic recorder close (erase's `onExit`); suppressPop-guarded. */
  readonly commitCloseRecorder: (dirty: boolean) => void;
}

export function useNavStack(params: UseNavStackParams): UseNavStack {
  // Monotonic depth stamp (invariant 9). Seeded on mount by Amendment B.
  const navIndex = useRef(0);
  const nextIndex = useRef(0);
  // Screen-scoped overlay stack (invariant 1/3). Empty in PR2.
  const layerStack = useRef<Layer[]>([]);
  // The any-outstanding travel guard (Amendment A). Replaces `backRequested`.
  const travelGuard = useRef<TravelGuardState>(initialTravelGuardState);
  // The recorder-commit-close in-flight absorber (invariant 7; was `committing`).
  const transitionInFlight = useRef(false);
  // "This popstate is one WE caused — do not route it" (kept from develop).
  const suppressPop = useRef(false);
  // One-slot drain for a commit-close settle refused by the any-outstanding
  // rule (latest-wins, invariant 8). Drained on the next landing.
  const pendingCommitClose = useRef(false);

  // Latest-ref the state-half callbacks (menu.tsx onCloseRef pattern) so the
  // returned commands can be identity-stable — recorder.tsx:2213 rebuilds its
  // imperative handle on any `onExit` identity change, so `commitCloseRecorder`
  // and `goBack` MUST NOT churn.
  const onOpenChapterRef = useRef(params.onOpenChapter);
  const onOpenRecorderRef = useRef(params.onOpenRecorder);
  const onLeaveToBooksRef = useRef(params.onLeaveToBooks);
  const onRecorderClosedRef = useRef(params.onRecorderClosed);
  const getRecorderHandleRef = useRef(params.getRecorderHandle);
  useEffect(() => {
    onOpenChapterRef.current = params.onOpenChapter;
    onOpenRecorderRef.current = params.onOpenRecorder;
    onLeaveToBooksRef.current = params.onLeaveToBooks;
    onRecorderClosedRef.current = params.onRecorderClosed;
    getRecorderHandleRef.current = params.getRecorderHandle;
  });

  const pushHistoryEntry = useCallback(() => {
    // A marker entry whose only job is to be there for Back to consume, carrying
    // the monotonic index that tells Back from Forward (invariant 9).
    const index = ++nextIndex.current;
    window.history.pushState({ tc: true, index }, "");
    navIndex.current = index;
  }, []);

  // Amendment B (reload/bootstrap safety) — declared BEFORE the popstate effect
  // so it runs first on mount. Instead of `develop`'s unconditional
  // `replaceState({index:0})` + reset, ADOPT an app-shaped entry already on the
  // stack (a reload mid-stack) into BOTH refs (George R2 P2-2: pushHistoryEntry
  // stamps from `++nextIndex` alone, so adopting only navIndex reintroduces F3
  // one push later). Only stamp a fresh index:0 when there is nothing valid to
  // adopt — a first load, or foreign/malformed state this app never wrote.
  // `resumeNavIndex` returns 0 for BOTH a genuine index:0 entry and un-adoptable
  // state, so the entry is "adoptable" exactly when it is app-marked AND its own
  // index survived validation unchanged (StrictMode's second mount then re-reads
  // the {tc:true,index:0} the first stamped and adopts 0 — idempotent).
  useEffect(() => {
    const raw = window.history.state as {
      tc?: unknown;
      index?: unknown;
    } | null;
    const resumed = resumeNavIndex(raw);
    navIndex.current = resumed;
    nextIndex.current = resumed;
    const adoptable = raw?.tc === true && raw.index === resumed;
    if (!adoptable) {
      window.history.replaceState({ tc: true, index: 0 }, "");
    }
  }, []);

  const goBack = useCallback(() => {
    // One Back path (#168): route through the browser so the on-screen Back gets
    // the same commit-window protection as the system gesture. `beginBack` is
    // the pure form of the old `backRequested` double-tap latch: on refusal
    // (a back() already outstanding) do NOTHING — no history.back(), no push.
    const begun = beginBack(travelGuard.current, "go-back");
    if (!begun.ok) return;
    travelGuard.current = begun.next;
    window.history.back();
  }, []);

  const commitCloseRecorder = useCallback((dirty: boolean) => {
    // The recorder's own `onExit` — a PROGRAMMATIC close (erase), with no
    // popstate involved. The state half runs, then the history tail: a
    // popstate-driven close is `transitionInFlight` (the browser already popped
    // and the handler re-armed, so leave history alone); a programmatic close
    // still has its entry on the stack, so consume it, suppressing the popstate
    // that back() fires. This raw back() is the THIRD issuer OUTSIDE the travel
    // guard — suppressPop-guarded, never fed to beginBack (travel-guard.ts:34-45).
    onRecorderClosedRef.current(dirty);
    if (!transitionInFlight.current) {
      suppressPop.current = true;
      window.history.back();
    }
  }, []);

  const openChapter = useCallback(
    (id: ChapterId) => {
      // State half then the protective push (Books → Segments). The push is a
      // synchronous window.history call and the state half only enqueues React
      // state, so their relative order is not observable — the entry is on the
      // stack before this gesture returns either way.
      onOpenChapterRef.current(id);
      pushHistoryEntry();
    },
    [pushHistoryEntry]
  );

  const openRecorder = useCallback(
    (segmentId: SegmentId, ordinal: number) => {
      onOpenRecorderRef.current(segmentId, ordinal);
      pushHistoryEntry();
    },
    [pushHistoryEntry]
  );

  const pushLayer = useCallback((layer: Layer) => {
    layerStack.current = [...layerStack.current, layer];
  }, []);

  const popLayer = useCallback((id: string) => {
    // Idempotent: removing an id that is not present is a no-op.
    layerStack.current = layerStack.current.filter((l) => l.id !== id);
  }, []);

  // Amendment C — the centrally-owned unmount safety net. Clears the WHOLE
  // layer stack whenever the screen identity changes or either global trap
  // engages: a single per-screen stack is wholly stale on a screen change or a
  // trap that unmounts the owning screen (App.tsx's early returns). Layer
  // carries no `screen` field (layer-stack.ts), so the faithful cleanup is a
  // whole-stack clear, NOT a per-layer screen filter (which would require adding
  // a screen tag to lib/nav — out of scope). Dep array is primitives only, so
  // no unmemoized hook-returned object can destabilise it (invariant 6, the
  // round-6 P1 class). Inert in PR2 (the stack is always empty).
  const screen = screenFor(params.hasChapter, params.recorderOpen);
  useEffect(() => {
    layerStack.current = [];
  }, [screen, params.recovering, params.databasePanel]);

  // Route the system Back gesture and its Forward sibling (#168). The whole
  // decision is the pure `popAction`; this effect only performs the DOM side of
  // the tag it names. Deps mirror App.tsx's original popstate effect — the
  // current-render primitives plus `onLeaveToBooks` — and re-subscription is
  // safe because the cleanup is only removeEventListener (unlike Amendment C's
  // effect, which stays primitive-only). The recorder handle and the other
  // state-half callbacks are read through latest-refs, so they are not deps.
  const { recovering, databasePanel, onLeaveToBooks } = params;
  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      // Settle the guard at the top of EVERY landing, issuer-blind — the exact
      // spot develop clears `backRequested`, before the suppressPop early
      // return. `settleOutstanding`, NOT a per-issuer settle: always clearing
      // `goBackOutstanding` here would leave `commitCloseOutstanding` stuck
      // after a recorder Back and kill on-screen Back for the session
      // (#494 item 2).
      travelGuard.current = settleOutstanding(travelGuard.current);
      const state = event.state as { index?: number } | null;
      const toIndex = state?.index ?? 0;
      // Our own history.back() (programmatic close, trap-forward, commit-close
      // settle, or the drain below) fired this; the move is already accounted
      // for. Keep the index truthful and do not route it.
      if (suppressPop.current) {
        suppressPop.current = false;
        navIndex.current = toIndex;
        return;
      }
      // Drain a refused commit-close consume (the rare race: a goBack was
      // outstanding when requestClose resolved, so beginBack("commit-close")
      // was refused rather than issuing its settle back()). The guard is clear
      // now (settleOutstanding above), so re-validate and re-issue the settle,
      // reproducing develop's two-traversal end state. This landing is spent on
      // the drain; the gesture that caused it is the goBack whose settle this
      // completes. Review-only (no renderer); the beginBack-after-settle
      // sequence is pinned pure in tests/nav-travel-guard.test.ts.
      if (pendingCommitClose.current) {
        pendingCommitClose.current = false;
        const begun = beginBack(travelGuard.current, "commit-close");
        if (begun.ok) {
          travelGuard.current = begun.next;
          navIndex.current = toIndex;
          suppressPop.current = true;
          window.history.back();
          return;
        }
      }
      const direction = navDirection(navIndex.current, toIndex);
      navIndex.current = toIndex;
      const action = popAction(
        direction,
        screen,
        transitionInFlight.current,
        recovering,
        databasePanel,
        layerStack.current
      );
      switch (action) {
        case "trap-database-panel":
        case "trap-recovery":
        case "rearm-transition-busy":
        case "rearm-layer-busy":
          // Every global trap and the busy-layer refusal re-arm the screen-depth
          // entry the browser already popped, and route nothing (the modal /
          // busy write / in-flight commit is the only thing that may leave).
          pushHistoryEntry();
          return;
        case "rearm-layer-dismiss": {
          // Non-busy top layer: re-arm AND dismiss it, then UNREGISTER it
          // (popLayer by id, #494 item 3) so a later Back is not trapped
          // re-selecting the same layer with a no-op dismiss(). Inert in PR2
          // (empty stack).
          pushHistoryEntry();
          const top = topLayer(layerStack.current);
          if (top) {
            top.dismiss();
            popLayer(top.id);
          }
          return;
        }
        case "trap-forward":
          // Forward is not a navigation this app redoes; cancel it (F2). The
          // cancelling back() is ours, so suppress its popstate.
          suppressPop.current = true;
          window.history.back();
          return;
        case "ignore":
          return;
        case "commit-close-recorder": {
          const handle = getRecorderHandleRef.current();
          if (!handle) return;
          // Re-arm SYNCHRONOUSLY — before the async commit — so the stop →
          // decode → save window is never a moment with no entry protecting the
          // recorder (F1). Run the same close() the on-screen Back runs; on exit
          // consume the single protective entry through the travel guard, on
          // decline leave it (the sheet stays open).
          pushHistoryEntry();
          transitionInFlight.current = true;
          void handle
            .requestClose()
            .then((exited) => {
              if (!exited) return;
              // The commit-close settle (App.tsx:358-360) now flows through the
              // any-outstanding guard. If a goBack is outstanding in the rare
              // window where requestClose resolved before that goBack's popstate
              // landed, this is REFUSED — record a one-slot pending consume and
              // drain it on the next landing (above), never drop it.
              const begun = beginBack(travelGuard.current, "commit-close");
              if (begun.ok) {
                travelGuard.current = begun.next;
                suppressPop.current = true;
                window.history.back();
              } else {
                pendingCommitClose.current = true;
              }
            })
            .catch((cause: unknown) => {
              // close() never rejects by contract (its own .catch still calls
              // onExit), but the synchronous prelude or an onExit throw could —
              // and if transitionInFlight never cleared, EVERY later Back would
              // re-arm and the recorder would be trapped forever (George R2 G4).
              // Surface it. The .finally below is load-bearing for the same
              // reason — do not drop it.
              console.error("Recorder close rejected", cause);
            })
            .finally(() => {
              transitionInFlight.current = false;
            });
          return;
        }
        case "to-books":
          onLeaveToBooks();
          return;
        case "exit-app":
          // The Books shelf pushed no entry, so this popstate is the browser
          // already leaving. Nothing to do — and nothing is lost at the shelf.
          return;
        default: {
          // Exhaustiveness (repo idiom, share-error-copy.ts:33): a new PopAction
          // member without a case fails to narrow to `never` here.
          const _exhaustive: never = action;
          return _exhaustive;
        }
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [
    screen,
    recovering,
    databasePanel,
    onLeaveToBooks,
    pushHistoryEntry,
    popLayer,
  ]);

  return {
    pushLayer,
    popLayer,
    openChapter,
    openRecorder,
    goBack,
    commitCloseRecorder,
  };
}
