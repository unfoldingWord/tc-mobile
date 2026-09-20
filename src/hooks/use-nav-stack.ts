import { useCallback, useEffect, useRef } from "react";

import {
  floorEntryForLayerChange,
  rearmAfterLayerBack,
  topLayer,
  type Layer,
} from "@/lib/nav/layer-stack";
import {
  backEffectFor,
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
 * one reviewable place. The Vitest suite has no renderer (AGENTS.md: no jsdom),
 * so it covers only the pure decisions this composes; the DOM paths themselves
 * — `popstate` routing, the reload adopt, the sheet-close-and-land, and the
 * double-Back guard — are exercised in real Chromium by
 * `e2e/back-navigation.spec.ts` (Playwright, against the shipped `dist/`
 * build) and remain an on-device item for iOS Safari and Android WebView. Two
 * things that spec does NOT reach, and which stay device items: the recorder's
 * commit path ITSELF (`requestClose` → re-arm push → `transitionInFlight` →
 * the consuming back()) is not observably distinct from a bare sheet-close in
 * the idle, no-microphone spec — case (b) asserts the sheet-close and the
 * Segments landing, not that `requestClose` ran; and the ms-window
 * commit-close RACE (the refused-commit-close absorb else-branch below) is not
 * reachable from a headless spec at all — its exact end state stays a device
 * item (see the commit-close case below).
 *
 * What the adapter owns (six refs):
 *   - `navIndex` / `nextIndex` — the monotonic depth stamp (invariant 9). Both
 *     seed from `resumeNavIndex` on mount (Amendment B): a reload mid-stack
 *     ADOPTS the entry already there rather than rewriting it to 0.
 *   - `layerStack` — the screen-scoped overlay stack (invariant 1/3). Books'
 *     five overlays register here as of PR3 (#374); Segments' follow in PR4, so
 *     above the floor the two layer tags are still unreachable-by-construction
 *     and every Back there routes exactly as `develop` does today.
 *   - `floorArmed` / `atFloor` — Amendment G (#452 PR3). Books pushes no entry
 *     of its own, so before PR3 a Back with a Books overlay open was a document
 *     navigation with NO `popstate` — measured, see
 *     `e2e/back-navigation.spec.ts`'s PR3 header — and the layer stack was
 *     never consulted. While (and only while) the floor screen has any layer
 *     open, the adapter holds ONE protective entry, so that Back becomes a
 *     `popstate` the stack can absorb. The pure decisions are
 *     `floorEntryForLayerChange` / `rearmAfterLayerBack` (`lib/nav/layer-stack.ts`).
 *   - `travelGuard` — the any-outstanding guard (Amendment A). `goBack` and the
 *     commit-close settle call `beginBack`; every popstate landing clears it
 *     with `settleOutstanding` (issuer-blind, mirroring `develop`'s
 *     `backRequested` clear at the top of the handler). This REPLACES the
 *     `backRequested` double-tap latch — not `suppressPop`, which is kept.
 *   - `transitionInFlight` — the recorder-commit-close in-flight absorber
 *     (renamed from `committing`, invariant 7). While set, every popstate
 *     re-arms instead of routing (the #58/#168 data-loss guard).
 *   - `suppressPop` — KEPT verbatim (travel-guard.ts, the CORRECTED (George R1
 *     P2-3) paragraph): the "this popstate
 *     is one WE caused, do not route it" flag, set at three sites — the
 *     programmatic close (`commitCloseRecorder`), `trap-forward`'s cancel, and
 *     the commit-close settle. The commit-close settle sets it in BOTH its
 *     branches: when it issues its own `history.back()` (guard clear), and when
 *     `beginBack("commit-close")` is REFUSED because a `goBack` is still
 *     outstanding — there it absorbs that outstanding `goBack`'s own landing
 *     rather than issue a second traversal (see the popstate handler's
 *     commit-close case). `commitCloseRecorder`'s own raw `history.back()` is a
 *     THIRD raw issuer OUTSIDE `TravelGuardState`, suppressed rather than
 *     arbitrated; it is never fed to `beginBack`.
 *
 * Amendment C is a centrally-owned cleanup effect (dep array `[screen,
 * recovering, databasePanel]`, primitives only — invariant 6) that clears the
 * whole layer stack when the screen changes or a global trap engages. Inert in
 * PR2 (empty stack).
 *
 * The re-arm/settle contract, verbatim, so a reader does not have to re-derive
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
  /**
   * Register an open overlay, from the SAME click handler that flips its own
   * `open` state (invariant 6 — never from an effect). At the floor screen this
   * also arms the protective entry the Back it absorbs will consume
   * (Amendment G).
   */
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
  // Screen-scoped overlay stack (invariant 1/3). Books' overlays push onto it
  // as of PR3; Segments' follow in PR4.
  const layerStack = useRef<Layer[]>([]);
  // Amendment G (#452 PR3): whether this adapter is holding the FLOOR screen's
  // protective entry. At most one, for as long as the floor screen has any
  // layer open — see `floorEntryForLayerChange` for why the floor needs one at
  // all and why an always-on entry was the wrong shape.
  const floorArmed = useRef(false);
  // `backEffectFor(screen) === "exit-app"` as of the last commit, read by
  // `pushLayer`/`popLayer` (both called from click handlers, never during
  // render). A ref rather than a dep, because both commands must stay
  // identity-stable for the same reason `goBack` does.
  const atFloor = useRef(false);
  // Whether a global trap owns the screen, same freshness and for the same
  // reason. The floor entry does not move while one is up — see
  // `floorEntryForLayerChange`.
  const trapped = useRef(false);
  // The any-outstanding travel guard (Amendment A). Replaces `backRequested`.
  const travelGuard = useRef<TravelGuardState>(initialTravelGuardState);
  // The recorder-commit-close in-flight absorber (invariant 7; was `committing`).
  const transitionInFlight = useRef(false);
  // "This popstate is one WE caused — do not route it" (kept from develop).
  const suppressPop = useRef(false);

  // Latest-ref the state-half callbacks (menu.tsx onCloseRef pattern) so the
  // returned commands can be identity-stable — recorder.tsx:2213 rebuilds its
  // imperative handle on any `onExit` identity change, so `commitCloseRecorder`
  // and `goBack` MUST NOT churn.
  const onOpenChapterRef = useRef(params.onOpenChapter);
  const onOpenRecorderRef = useRef(params.onOpenRecorder);
  const onRecorderClosedRef = useRef(params.onRecorderClosed);
  const getRecorderHandleRef = useRef(params.getRecorderHandle);
  const screen = screenFor(params.hasChapter, params.recorderOpen);
  useEffect(() => {
    onOpenChapterRef.current = params.onOpenChapter;
    onOpenRecorderRef.current = params.onOpenRecorder;
    onRecorderClosedRef.current = params.onRecorderClosed;
    getRecorderHandleRef.current = params.getRecorderHandle;
    // Amendment G. Derived from `backEffectFor`, not from `screen === "books"`,
    // so "the floor" stays one definition: the screen whose Back leaves the app
    // because it pushed nothing of its own.
    atFloor.current = backEffectFor(screen) === "exit-app";
    trapped.current = params.recovering || params.databasePanel;
    // Declaration order is load-bearing: React runs effects in the order they
    // are declared, and this one is FIRST, so Amendment C's cleanup effect
    // below already sees this render's values when a trap engages or clears.
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
    // guard — suppressPop-guarded, never fed to beginBack (travel-guard.ts, the
    // THIRD raw issuer paragraph).
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

  /**
   * Amendment G's DOM half: perform the arm/release the pure
   * `floorEntryForLayerChange` names for a stack that just went `before` →
   * `after`. Called from `pushLayer`/`popLayer` only, i.e. always from the
   * overlay's own click handler — so the entry is on (or off) the stack before
   * the opening gesture returns, exactly like `openChapter`'s own push.
   *
   * The release is a raw `window.history.back()`, suppressPop-guarded, and so
   * is a FOURTH raw issuer alongside `commitCloseRecorder`'s programmatic close
   * (travel-guard.ts, the THIRD raw issuer paragraph). It is deliberately NOT
   * fed to `beginBack`, for the same reason that one is not: its `popstate`
   * never reaches `popAction`, so there is nothing for the any-outstanding
   * guard to arbitrate. It also cannot contend with `goBack`, which is the one
   * issuer that could plausibly overlap it: `goBack` is reached only from the
   * Segments header Back and the recorder (`App.tsx`'s `onBack`/
   * `onRequestBack`), and this release fires only while `atFloor` — the shelf,
   * which carries no Back control at all. The two are unreachable together.
   */
  const settleFloorEntry = useCallback(
    (open: number) => {
      const action = floorEntryForLayerChange({
        atFloor: atFloor.current,
        trapped: trapped.current,
        armed: floorArmed.current,
        open,
      });
      if (action === "arm") {
        floorArmed.current = true;
        pushHistoryEntry();
        return;
      }
      if (action === "release") {
        floorArmed.current = false;
        suppressPop.current = true;
        window.history.back();
      }
    },
    [pushHistoryEntry]
  );

  const pushLayer = useCallback(
    (layer: Layer) => {
      layerStack.current = [...layerStack.current, layer];
      settleFloorEntry(layerStack.current.length);
    },
    [settleFloorEntry]
  );

  const popLayer = useCallback(
    (id: string) => {
      // Idempotent: removing an id that is not present is a no-op — and because
      // the floor settle reads the resulting stack size against `floorArmed`
      // rather than the call itself, a repeat `popLayer(id)` (the
      // `rearm-layer-dismiss` path calls it, and the layer's own `dismiss()`
      // usually calls it too) settles nothing the first one did not.
      layerStack.current = layerStack.current.filter((l) => l.id !== id);
      settleFloorEntry(layerStack.current.length);
    },
    [settleFloorEntry]
  );

  // Amendment C — the centrally-owned unmount safety net. Clears the WHOLE
  // layer stack whenever the screen identity changes or either global trap
  // engages: a single per-screen stack is wholly stale on a screen change or a
  // trap that unmounts the owning screen (App.tsx's early returns). Layer
  // carries no `screen` field (layer-stack.ts), so the faithful cleanup is a
  // whole-stack clear, NOT a per-layer screen filter (which would require adding
  // a screen tag to lib/nav — out of scope). Dep array is primitives only, so
  // no unmemoized hook-returned object can destabilise it (invariant 6, the
  // round-6 P1 class). `settleFloorEntry` joined the array with Frank's R1 P2
  // fix below and does not weaken that: it is a `useCallback` declared in THIS
  // hook over `pushHistoryEntry`, itself a `useCallback([])` here — nothing in
  // the chain is another hook's return value, which is what the round-6 P1
  // actually was.
  //
  // #452 PR3 kept this effect EXACTLY as PR2 wrote it, and recorded why next to
  // Amendment C (issue #452): of George R4 P3-1's two options it takes (b) —
  // keep the whole-stack clear and make the screen's own overlay state agree
  // with it — rather than (a), narrowing the clear so a covered screen's layers
  // survive. `popAction` consults the stack BEFORE `backEffectFor(screen)`
  // (navigation.ts) and `Layer` carries no screen tag, so a surviving Segments
  // layer would shadow `"commit-close-recorder"` on the sheet above it. Books
  // needs nothing here either way — App.tsx's ternary UNMOUNTS `BooksScreen` on
  // the Books↔Segments swap, so clearing is already right for it. PR4 owns (b)'s
  // other half for Segments; see the #452 comment for the full argument.
  //
  // It settles the FLOOR entry against the now-empty stack rather than leaving
  // it wherever it was (Frank R1 P2 on PR #531). Both edges matter and they
  // differ, which is why `floorEntryForLayerChange` is told whether a trap is
  // up rather than being asked to infer it:
  //   - trap ENGAGES over an open Books menu: the entry must SURVIVE — it is
  //     what `"trap-database-panel"` re-arms against, and releasing it would
  //     let a Back walk out of the app from under the panel.
  //   - trap CLEARS (a `blocked` panel self-dismisses when the other tab
  //     closes, `database-panel.tsx`): Books remounts with no overlay and
  //     nothing will ever call `pushLayer`/`popLayer` again on its own, so a
  //     retained entry would sit under a bare shelf and cost a second Back to
  //     leave. It is released here.
  // A screen change settles the same way, and at a non-floor screen the pure
  // function answers `"none"` for every input, so this is inert above Books.
  useEffect(() => {
    layerStack.current = [];
    settleFloorEntry(0);
  }, [screen, params.recovering, params.databasePanel, settleFloorEntry]);

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
      // Our own history.back() (programmatic close, trap-forward, or the
      // commit-close settle) fired this, OR this is the outstanding goBack's
      // landing that a refused commit-close settle chose to absorb; either way
      // the move is already accounted for. Keep the index truthful and do not
      // route it.
      if (suppressPop.current) {
        suppressPop.current = false;
        navIndex.current = toIndex;
        return;
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
          //
          // `rearm-layer-busy` is grouped here and NOT routed through
          // Amendment G's `rearmAfterLayerBack`, deliberately: a refused layer
          // is not popped, so the stack is still non-empty, and that function
          // is `true` for a non-empty stack at EVERY depth, floor included. A
          // call whose answer is constant by construction is a branch no test
          // could kill; the constant itself is pinned by
          // `rearmAfterLayerBack(true, >=1) === true` in
          // `tests/nav-layer-stack.test.ts`.
          pushHistoryEntry();
          return;
        case "rearm-layer-dismiss": {
          // Non-busy top layer: re-arm AND dismiss it, then UNREGISTER it
          // (popLayer by id, #494 item 3) so a later Back is not trapped
          // re-selecting the same layer with a no-op dismiss().
          const top = topLayer(layerStack.current);
          if (!top) {
            // Unreachable: `popAction` only names this tag for a non-empty
            // stack. Absorbed rather than dropped, for the same reason the
            // missing-recorder-handle case below absorbs — the browser has
            // already popped the entry, so returning without a re-arm would
            // strand the app one level below the screen it is showing.
            pushHistoryEntry();
            return;
          }
          // Amendment G: above the floor the consumed entry is the SCREEN's own
          // and always comes back. AT the floor it is the floor entry, which
          // exists only while a layer does — so it comes back only if one
          // remains beneath this dismissal. Clearing `floorArmed` BEFORE
          // `dismiss()` is what keeps the two paths from double-consuming: the
          // layer's own close handler normally calls `popLayer` too, and
          // `settleFloorEntry` must see the entry as already gone.
          if (
            rearmAfterLayerBack(atFloor.current, layerStack.current.length - 1)
          ) {
            pushHistoryEntry();
          } else {
            floorArmed.current = false;
          }
          top.dismiss();
          popLayer(top.id);
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
          if (!handle) {
            // No recorder handle even though `screenFor` returned "recorder":
            // a mount the adapter expected is gone. The one known path to it is
            // the commit-to-passive-effect gap during a recorder UNMOUNT
            // (inference, never observed): `screen` is derived synchronously
            // from `params.recorderOpen`, but the recorder clears its imperative
            // handle in a passive cleanup effect, so a Back that lands after that
            // cleanup has run but before this effect's `screen`/deps re-resolve
            // can see `screenFor` still "recorder" with the handle already null.
            // The re-arm below is the intended ABSORB for that gap — the browser
            // has ALREADY popped the screen-depth entry, so re-arm it here like
            // every other non-screen intercept in this switch (George R1 P2-2):
            // returning without the re-arm would strand the app one physical
            // level below the screen it is showing (invariant 2). Surface the
            // missed mount — it should be vanishingly rare, never nominal.
            console.error("commit-close-recorder: no recorder handle on Back");
            pushHistoryEntry();
            return;
          }
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
              // The commit-close settle now flows through the any-outstanding
              // guard. Guard clear: issue the consuming back() (suppressPop so
              // its own landing does not route). REFUSED (a goBack is still
              // outstanding in the rare window where requestClose resolved before
              // that goBack's popstate landed): do NOT issue a second traversal.
              // The outstanding goBack's own history.back() is already consuming
              // the same protective entry this settle would have; absorb THAT
              // landing (suppressPop) instead. Issuing a second back() here would
              // pop a further real level and strand the app one entry below the
              // screen it is showing (invariant 2's "one entry per screen depth")
              // — the exact non-root-exit class the whole guard exists to stop.
              // Absorbing converges the race to the SAME end state as an
              // un-raced commit-close (the recorder's screen, one level below
              // it), which is invariant 7's intent: a second Back during an
              // in-flight commit is absorbed, never escaped. Review-only (no
              // renderer); the trace is from the code. The reachability of the
              // ms window is NOT the recorder header Back — this PR disables
              // that control through the close window (the header Close
              // control's `disabled={heldTake !== null || isClosing}`), so do
              // not re-enable header Close believing this absorb depends on
              // it. The `onRequestBack` issuers still live during close are
              // `LoadErrorPanel`'s and `PermissionPanel`'s
              // `onBack={onRequestBack}`.
              const begun = beginBack(travelGuard.current, "commit-close");
              if (begun.ok) {
                travelGuard.current = begun.next;
                suppressPop.current = true;
                window.history.back();
              } else {
                suppressPop.current = true;
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
