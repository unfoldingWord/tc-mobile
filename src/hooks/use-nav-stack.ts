import { App } from "@capacitor/app";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

import {
  deferWrite,
  historyWriteDecision,
  outstandingConsume,
  replayDecision,
  type DeferredWrite,
  type HistoryWrite,
  type HistoryWriteDecision,
} from "@/lib/nav/history-latch";
import {
  floorArmedOnResume,
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
  type PopAction,
} from "@/lib/nav/navigation";
import {
  beginBack,
  initialTravelGuardState,
  settleOutstanding,
  type TravelGuardState,
} from "@/lib/nav/travel-guard";
import type { ChapterId, SegmentId } from "@/types/domain";

import { reportFailure } from "./report-failure";

/**
 * The history adapter for the pivot's system-Back model (#452 PR2,
 * docs/design/back-navigation.md "PR split" item 2). It is the ONE file that
 * touches `window.history` / `window.popstate` — and, inside the Capacitor
 * shell, the native Back button (`attachNativeBack`, #374) — the pure
 * decisions it composes
 * (`popAction`, `navDirection`, `screenFor`, `resumeNavIndex`, `beginBack` /
 * `settleOutstanding`, `routeBackToLayer` via `popAction`) all live, tested, in
 * `src/lib/nav`. Extracting App.tsx's inline refs/effects here is what lets the
 * onion keep the routing logic Node-testable while the browser wiring stays in
 * one reviewable place. The static render harness does not drive this hook's
 * effects or browser history. `e2e/back-navigation.spec.ts` targets the DOM
 * paths against the shipped `dist/` build in Chromium; it does not establish
 * behavior on iOS Safari or Android WebView. Two
 * things that spec does NOT reach, and which stay device items: the recorder's
 * commit path ITSELF (`requestClose` → re-arm push → `transitionInFlight` →
 * the consuming back()) is not observably distinct from a bare sheet-close in
 * the idle, no-microphone spec — case (b) asserts the sheet-close and the
 * Segments landing, not that `requestClose` ran; and the ms-window
 * commit-close RACE (the refused-commit-close absorb else-branch below) is not
 * reachable from a headless spec at all — its exact end state stays a device
 * item (see the commit-close case below).
 *
 * What the adapter owns (its refs):
 *   - `navIndex` / `nextIndex` — the monotonic depth stamp (invariant 9). Both
 *     seed from `resumeNavIndex` on mount (Amendment B): a reload mid-stack
 *     ADOPTS the entry already there rather than rewriting it to 0.
 *   - `layerStack` — the screen-scoped overlay stack (invariant 1/3).
 *   - `floorArmed` / `atFloor` — Amendment G (#452 PR3). Books pushes no entry
 *     of its own, so a Back without a protective entry can leave the document
 *     without an in-app `popstate`; the layer stack cannot intercept that.
 *     While the floor screen has an open layer, the adapter holds ONE
 *     protective entry so that Back becomes a
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
 *   - `deferredWrites` — the history writes (`enterScreen`, the floor arm)
 *     requested while one of the Backs above had not yet landed (#435). No
 *     write is issued under a pending traversal; `lib/nav/history-latch.ts`
 *     decides whether it is written, deferred to the landing, or refused, and
 *     every landing replays what was deferred.
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

/**
 * The slice of `@capacitor/app` the shell's Back leg needs (#374), as an
 * injected boundary so the dispatch is testable in plain Node
 * (`tests/native-back.test.ts`) — the same split `share-target.ts` makes for
 * the Share plugin. `App` satisfies it structurally.
 */
export interface NativeBackPlugin {
  addListener(
    eventName: "backButton",
    listener: (event: { canGoBack: boolean }) => void
  ): Promise<PluginListenerHandle>;
  exitApp(): Promise<void>;
  /** Android only — iOS resolves this with `unimplemented`, so it is gated. */
  toggleBackButtonHandler(options: { enabled: boolean }): Promise<void>;
}

export interface NativeBackRoute {
  /** What a Back would do right now — `popAction` over the adapter's live refs. */
  decide(): PopAction;
  /** The one in-app Back path (`goBack`). */
  goBack(): void;
}

/**
 * The most recent `attachNativeBack` call's id, so attaches are ordered and a
 * draining listener can tell a newer one from itself (#674). Module scope
 * because the successor is a separate call — a remount — with nothing else
 * shared between the two.
 */
let latestNativeBackAttach = 0;

/**
 * The newest attach whose own ENABLE has resolved while it was still live —
 * the first point a successor can be shown to take a press. Beginning an
 * attach proves nothing: `addListener`'s handle resolves once the call is
 * posted, not once the plugin thread has registered it, and a successor whose
 * `addListener` rejected, or that detached before its handle, never takes one.
 * Its enable is posted after its `addListener`, so (inference, from the plugin
 * thread running calls in order; not observed on a device) the enable
 * resolving follows the registration.
 */
let operationalNativeBackAttach = 0;

/**
 * Route a hardware Back inside the Capacitor shell (#374, design Amendment F).
 *
 * In a browser, system Back IS a history pop: the `popstate` handler below
 * sees it and routes it. Inside the shell nothing pops on its own —
 * `@capacitor/android` 8.5.2's bridge carries no Back handling at all, and
 * `@capacitor/app`'s `AppPlugin` hands the press to whoever listens for
 * `backButton` — so a Back with a Books menu open left the app instead of
 * closing the menu. This is the shell's leg of the same model, and it adds no
 * routing of its own: it asks the SAME `popAction` the `popstate` handler
 * consults, and then does one of three things —
 *
 *   - the WebView has an entry to pop → `goBack()`, whatever the route said.
 *     The press becomes the `popstate` the handler already routes (layer
 *     dismissal, re-arms, the recorder's commit-close), through the same travel
 *     guard the on-screen Back uses. That includes the routes the handler
 *     settles SILENTLY — the floor entry left standing by an overlay closed
 *     with its own control (Amendment G, #535), and the deeper index a reload
 *     adopts above the shelf — where `popAction` says `"exit-app"` but the
 *     recorded contract is that this press stays: only the one that lands on
 *     physical depth 0 leaves. `popAction` cannot tell those from a bare shelf;
 *     `canGoBack` can, so it is read first.
 *   - nothing to pop, and the route says `"exit-app"` → `exitApp()`. The shelf
 *     with nothing open and nothing beneath it is the one place Back leaves.
 *   - nothing to pop, anything else → hold. Only a global trap on the bare
 *     shelf reaches here (`popAction` returns the trap before it ever reads the
 *     screen), and a `history.back()` there would be a no-op by spec: no
 *     `popstate`, so `goBack`'s guard would never settle and every later Back
 *     would be refused for the session (#494 item 2's shape). The way out of a
 *     trap is the modal's own control, which is what the trap means.
 *
 * `canGoBack` is the WebView's own answer to "will `history.back()` do
 * anything", read from the event the plugin delivers, rather than re-derived
 * here from `floorArmed` — one source of truth for the physical stack.
 *
 * The plugin's Android `OnBackPressedCallback` is enabled only while this
 * listener is registered. It ships DISABLED (`capacitor.config.ts`,
 * `disableBackButtonHandler`), because an enabled callback with no listener
 * consumes a root Back and does nothing — the crash screen, which unmounts
 * this hook, would lose Back as its exit, and so would the window before the
 * first paint's effects. `toggleAndroidHandler` flips it on once the plugin
 * has the listener (not before: a press in between would reach the plugin's
 * no-listener branch), and off again on detach so the press falls through to
 * the activity default. iOS has no such callback and reports the method as
 * unimplemented, so the toggle is gated on the platform, not attempted.
 *
 * Every plugin promise has a channel: a rejection anywhere here would
 * otherwise be an unhandled rejection with no context, so each is routed to
 * `reportFailure` under its own name. A rejected `remove()` is also the one
 * failure that leaves state behind — the callback stays registered — so the
 * listener checks its own phase and does nothing once the detach completes.
 *
 * Returns the detach. The plugin resolves its listener handle asynchronously,
 * so a detach that runs first marks the handle for removal the moment it lands.
 *
 * The disable is a bridge round trip (#674), and until it is applied the
 * Android callback is still enabled, so a Back in that window still reaches
 * this listener. Going inert there would swallow the press; routing it in-app
 * would too, because the detach runs as the hook unmounts — the crash screen
 * is the reachable case — and the `popstate` router goes with it. So the
 * detach has two steps. While the disable is in flight the listener is
 * DRAINING: a press gets what it would get a moment later from the activity
 * default once the disable lands, which is leaving (`exitApp()`), whatever
 * the WebView could pop. Only after the disable has settled — resolved or
 * rejected, since a refused disable is reported and there is nothing further
 * to wait for — does the listener go inert and the remove get posted. The
 * remove therefore still follows the disable, as #634 round 3 relied on.
 * Draining exists only where the window does: on Android, after the enable
 * was posted (that is, once the handle resolved). Earlier, or off Android,
 * the callback is not enabled and the detach is inert at once.
 *
 * A draining press leaves unless a newer attach is OPERATIONAL
 * (`operationalNativeBackAttach`). `exitApp()` beside a successor that takes
 * the same press would finish the activity under a running app — the variant
 * #634 round 3 rejected — so then the draining listener is inert instead. A
 * successor that has merely begun cannot take the press yet, so going inert
 * beside it would swallow the press again (#674).
 */
export function attachNativeBack(
  plugin: NativeBackPlugin,
  route: NativeBackRoute,
  toggleAndroidHandler = false
): () => void {
  const attach = ++latestNativeBackAttach;
  let phase: "live" | "draining" | "detached" = "live";
  let handle: PluginListenerHandle | undefined;
  const setHandler = (enabled: boolean): Promise<void> => {
    if (!toggleAndroidHandler) return Promise.resolve();
    return plugin
      .toggleBackButtonHandler({ enabled })
      .catch((cause: unknown) => reportFailure(cause, "native-back-handler"));
  };
  const exitApp = (): void => {
    plugin
      .exitApp()
      .catch((cause: unknown) => reportFailure(cause, "native-back-exit"));
  };
  const release = (): void => {
    phase = "detached";
    handle
      ?.remove()
      .catch((cause: unknown) => reportFailure(cause, "native-back-remove"));
  };
  plugin
    .addListener("backButton", ({ canGoBack }) => {
      // Inert once detached, whatever the plugin did with `remove()`: a
      // removal that rejected leaves this callback registered, and the next
      // mount registers a second one — one press must not route twice.
      if (phase === "detached") return;
      if (phase === "draining") {
        if (operationalNativeBackAttach <= attach) exitApp();
        return;
      }
      const action = route.decide();
      if (canGoBack) {
        route.goBack();
        return;
      }
      if (action === "exit-app") exitApp();
    })
    .then((resolved) => {
      if (phase !== "live") {
        resolved
          .remove()
          .catch((cause: unknown) =>
            reportFailure(cause, "native-back-remove")
          );
        return;
      }
      handle = resolved;
      if (!toggleAndroidHandler) return;
      plugin.toggleBackButtonHandler({ enabled: true }).then(
        () => {
          if (phase === "live" && attach > operationalNativeBackAttach) {
            operationalNativeBackAttach = attach;
          }
        },
        (cause: unknown) => reportFailure(cause, "native-back-handler")
      );
    })
    .catch((cause: unknown) => reportFailure(cause, "native-back-listener"));
  return () => {
    const disabling = setHandler(false);
    if (!toggleAndroidHandler || handle === undefined) {
      release();
      return;
    }
    phase = "draining";
    // `finally`: release even if the report threw; the throw stays visible.
    void disabling.finally(release);
  };
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
  // Screen-scoped overlay stack (invariant 1/3).
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
  // The any-outstanding travel guard (Amendment A). Replaces `backRequested`.
  const travelGuard = useRef<TravelGuardState>(initialTravelGuardState);
  // The recorder-commit-close in-flight absorber (invariant 7; was `committing`).
  const transitionInFlight = useRef(false);
  // "This popstate is one WE caused — do not route it" (kept from develop).
  const suppressPop = useRef(false);
  // History writes waiting for an outstanding Back to land (#435), in request
  // order, once per screen entry (`deferWrite`). Replayed by the `popstate`
  // handler at the end of every landing.
  const deferredWrites = useRef<DeferredWrite[]>([]);

  // Latest-ref the state-half callbacks (menu.tsx onCloseRef pattern) so the
  // returned commands can be identity-stable — recorder.tsx:2213 rebuilds its
  // imperative handle on any `onExit` identity change, so `commitCloseRecorder`
  // and `goBack` MUST NOT churn.
  const onOpenChapterRef = useRef(params.onOpenChapter);
  const onOpenRecorderRef = useRef(params.onOpenRecorder);
  const onRecorderClosedRef = useRef(params.onRecorderClosed);
  const getRecorderHandleRef = useRef(params.getRecorderHandle);
  const screen = screenFor(params.hasChapter, params.recorderOpen);
  // The remaining four values `onPopState` used to read from its CLOSURE
  // (George R1 P2 on PR #531). See the popstate effect for why a closure is
  // the wrong home for any of them; they live here so that EVERY value that
  // handler reads is a ref written in the layout phase, with no exceptions
  // left to reason about individually.
  const screenRef = useRef(screen);
  const recoveringRef = useRef(params.recovering);
  const databasePanelRef = useRef(params.databasePanel);
  const onLeaveToBooksRef = useRef(params.onLeaveToBooks);
  // `useLayoutEffect`, NOT `useEffect` (Frank R4 P2 on PR #531; widened to the
  // whole popstate closure by George R1 P2). A passive effect is flushed in a
  // scheduler macrotask AFTER the commit, and a `popstate` is a macrotask too,
  // so anything refreshed passively can be read pre-commit by a Back that
  // lands in between. A layout effect runs synchronously inside the commit
  // task, before paint and before any macrotask, which closes that window
  // rather than narrowing it.
  //
  // THE RULE THIS ENCODES, stated once so the next value added does not have
  // to rediscover it: **every value `onPopState` reads is a ref written here.**
  // Round 5 moved `atFloor` for exactly this reason and left `screen`,
  // `recovering`, `databasePanel` and `onLeaveToBooks` on the passive
  // re-subscribe path — the fix was narrower than the class it claimed to
  // close, which is what George's P2 found. The boundary is not "things named
  // latest-ref"; it is the handler's whole closure.
  //
  // This also makes the bootstrap effect's ordering dependency below stronger
  // than declaration order alone: layout effects run before passive ones, so
  // `atFloor.current` is resolved by PHASE before the adopt reads it.
  useLayoutEffect(() => {
    onOpenChapterRef.current = params.onOpenChapter;
    onOpenRecorderRef.current = params.onOpenRecorder;
    onRecorderClosedRef.current = params.onRecorderClosed;
    getRecorderHandleRef.current = params.getRecorderHandle;
    screenRef.current = screen;
    recoveringRef.current = params.recovering;
    databasePanelRef.current = params.databasePanel;
    onLeaveToBooksRef.current = params.onLeaveToBooks;
    // Amendment G. Derived from `backEffectFor`, not from `screen === "books"`,
    // so "the floor" stays one definition: the screen whose Back leaves the app
    // because it pushed nothing of its own.
    atFloor.current = backEffectFor(screen) === "exit-app";
  });

  const pushHistoryEntry = useCallback(() => {
    // A marker entry whose only job is to be there for Back to consume, carrying
    // the monotonic index that tells Back from Forward (invariant 9).
    //
    // `floor` records the entry's KIND for a later page life to read back
    // (Amendment G, `floorArmedOnResume`; Frank R3 P2). Every call site here is
    // either the floor's arm or a re-arm of the entry the `popstate` just
    // consumed at the CURRENT screen's depth — so "was the current screen the
    // floor when this entry was pushed" is exactly the right question, and
    // `atFloor.current` is exactly its answer. `enterScreen` is the one push
    // that is a SCREEN entry by definition and does not go through here.
    const index = ++nextIndex.current;
    window.history.pushState({ tc: true, index, floor: atFloor.current }, "");
    navIndex.current = index;
  }, []);

  /**
   * The push a SCREEN TRANSITION makes (`openChapter` / `openRecorder`), as
   * opposed to the re-arms above.
   *
   * It differs in one case and only one: the shelf may still be holding a
   * floor entry armed for an overlay that was closed by its own control
   * (Amendment G). That entry already sits at exactly the depth this screen's
   * entry wants, so it is RE-STAMPED rather than stacked on top of — one entry
   * per screen depth (invariant 2), and no traversal to undo an extra level.
   *
   * The re-arm sites must NOT use this. They run from the `popstate` handler
   * AFTER the browser has already popped the entry they are restoring, so at
   * the floor a `replaceState` there would overwrite the app's own root entry
   * instead of putting the popped one back.
   */
  const enterScreen = useCallback(() => {
    const index = ++nextIndex.current;
    if (floorArmed.current) {
      floorArmed.current = false;
      window.history.replaceState({ tc: true, index }, "");
    } else {
      window.history.pushState({ tc: true, index }, "");
    }
    navIndex.current = index;
  }, []);

  /**
   * Amendment G's arm, re-derived from the state at the moment it is written
   * rather than at the moment it was asked for: a deferred arm (#435) replays
   * after a landing that may already have dismissed the overlay it was for, or
   * armed the entry itself.
   */
  const armFloor = useCallback(() => {
    const action = floorEntryForLayerChange({
      atFloor: atFloor.current,
      armed: floorArmed.current,
      open: layerStack.current.length,
    });
    if (action === "arm") {
      floorArmed.current = true;
      pushHistoryEntry();
    }
  }, [pushHistoryEntry]);

  // The "consume outstanding" latch (#435, `lib/nav/history-latch.ts`). Every
  // history write a UI command makes goes through here; the re-arms inside the
  // `popstate` handler do not, because they run at a landing after the travel
  // guard is settled and with `suppressPop` false (a suppressed landing returns
  // before it routes), which is when nothing is outstanding.
  const decideWrite = useCallback(
    (write: HistoryWrite): HistoryWriteDecision =>
      historyWriteDecision(
        write,
        outstandingConsume(suppressPop.current, travelGuard.current)
      ),
    []
  );
  const performWrite = useCallback(
    (write: DeferredWrite, decision: HistoryWriteDecision) => {
      if (decision === "defer") {
        deferredWrites.current = deferWrite(deferredWrites.current, write);
        return;
      }
      if (decision !== "write") return;
      if (write === "arm-floor") armFloor();
      else enterScreen();
    },
    [enterScreen, armFloor]
  );
  // Called at the end of every landing. Each write is re-decided, never
  // refused (`replayDecision`), so one whose landing issued another Back of
  // its own waits for that one as well.
  const replayDeferredWrites = useCallback(() => {
    const queued = deferredWrites.current;
    deferredWrites.current = [];
    for (const write of queued) {
      performWrite(
        write,
        replayDecision(
          outstandingConsume(suppressPop.current, travelGuard.current)
        )
      );
    }
  }, [performWrite]);

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
      floor?: unknown;
    } | null;
    const resumed = resumeNavIndex(raw);
    navIndex.current = resumed;
    nextIndex.current = resumed;
    const adoptable = raw?.tc === true && raw.index === resumed;
    if (!adoptable) {
      window.history.replaceState({ tc: true, index: 0 }, "");
      return;
    }
    // Amendment G's half of the adopt (Frank R3 P2). The ENTRY survives a
    // reload; `floorArmed` is a ref and does not, so without this the adapter
    // comes back having forgotten an entry that is still on the stack and the
    // next overlay arms a second one — unbounded across reload → open cycles.
    // Reading the kind the push wrote, rather than inferring it from the depth,
    // is what keeps a Segments entry that outlived its screen from being
    // adopted as the floor's; `floorArmedOnResume` has the full argument.
    //
    // Ordering: `atFloor.current` must already be resolved for the screen being
    // resumed on when this runs. It is, by PHASE rather than by declaration
    // order alone — the latest-ref effect above is a `useLayoutEffect` (Frank
    // R4 P2) and React flushes every layout effect before any passive one, so
    // this passive effect cannot observe a pre-commit `atFloor`. Declaration
    // order still holds too; it is simply no longer the only thing holding it.
    floorArmed.current = floorArmedOnResume({
      marked: raw.floor === true,
      atFloor: atFloor.current,
    });
  }, []);

  const goBack = useCallback(() => {
    // One Back path (#168): route through the browser so the on-screen Back gets
    // the same commit-window protection as the system gesture. `beginBack` is
    // the pure form of the old `backRequested` double-tap latch: on refusal
    // (a back() already outstanding) do NOTHING — no history.back(), no push.
    //
    // A SUPPRESSED traversal is outstanding too, and `beginBack` cannot see
    // it: the raw issuers outside the guard (`commitCloseRecorder`,
    // `trap-forward`'s cancel) set `suppressPop` and call `history.back()`
    // themselves, and the header Back is disabled for exactly that window
    // (`recorder.tsx`) so it could never land here. The hardware Back (#374)
    // can — the plugin posts it from the Android UI thread, not behind the
    // pending `popstate` task — and a second `history.back()` before the
    // first lands is the coalescing hazard `travel-guard.ts` exists to rule
    // out (#493). That press is already the Back in flight; issue nothing.
    if (suppressPop.current) return;
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
      // The latch is asked FIRST (#435): a refusal means a routed Back is
      // outstanding and owns the next screen, so neither half runs. Otherwise
      // the state half, then the protective push (Books → Segments) or its
      // deferral. The push is a synchronous window.history call and the state
      // half only enqueues React state, so their relative order is not
      // observable — when nothing is outstanding, the entry is on the stack
      // before this gesture returns either way.
      const decision = decideWrite("enter-screen");
      if (decision === "refuse") return;
      onOpenChapterRef.current(id);
      performWrite("enter-segments", decision);
    },
    [decideWrite, performWrite]
  );

  const openRecorder = useCallback(
    (segmentId: SegmentId, ordinal: number) => {
      const decision = decideWrite("enter-screen");
      if (decision === "refuse") return;
      onOpenRecorderRef.current(segmentId, ordinal);
      performWrite("enter-recorder", decision);
    },
    [decideWrite, performWrite]
  );

  const pushLayer = useCallback(
    (layer: Layer) => {
      layerStack.current = [...layerStack.current, layer];
      // Amendment G's DOM half, and the ONLY half: the floor entry is armed
      // here and never handed back by a traversal. `floorEntryForLayerChange`
      // has the whole argument for why there is no release — two review
      // findings in two places, both of them about one existing.
      //
      // The layer is registered whatever the latch says — the overlay opened
      // in this same click handler — so only the arm can wait (#435). The
      // latch never refuses `"arm-floor"`.
      const action = floorEntryForLayerChange({
        atFloor: atFloor.current,
        armed: floorArmed.current,
        open: layerStack.current.length,
      });
      if (action === "arm") {
        performWrite("arm-floor", decideWrite("arm-floor"));
      }
    },
    [decideWrite, performWrite]
  );

  const popLayer = useCallback((id: string) => {
    // Idempotent: removing an id that is not present is a no-op. It touches
    // history not at all — closing an overlay leaves the floor entry standing
    // for whichever comes first, a Back that consumes it or a screen
    // transition that re-stamps it (`enterScreen`).
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
  // round-6 P1 class), and it has no non-primitive member at all: Frank's R1
  // P2 fix briefly added one (`settleFloorEntry`), and R2 P1 removed both that
  // callback and the release it settled. Nothing was put back in its place,
  // and nothing should be — a callback here would be the first way back into
  // R2 P1's race (George R1 P3-4, which found this sentence still claiming the
  // callback exists).
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
  // It deliberately leaves `floorArmed` and its entry alone on BOTH trap edges,
  // and with no release to schedule there is nothing to schedule (Frank R1 P2
  // and R2 P1 on PR #531 were both about a release existing — see
  // `floorEntryForLayerChange`). On engage, the entry is exactly what
  // `"trap-database-panel"` re-arms against. On clear, the shelf comes back
  // holding it, and it is consumed by whichever comes first: a Back (routing
  // `"exit-app"`, which clears the flag below) or a screen transition
  // (`enterScreen` re-stamps it). This effect is byte-for-byte PR2's.
  useEffect(() => {
    layerStack.current = [];
  }, [screen, params.recovering, params.databasePanel]);

  // Route the system Back gesture and its Forward sibling (#168). The whole
  // decision is the pure `popAction`; this effect only performs the DOM side of
  // the tag it names.
  //
  // This effect subscribes ONCE (George R1 P2). It used to mirror App.tsx's
  // original popstate effect and re-subscribe on the current-render primitives
  // plus `onLeaveToBooks`, which looked safe because the cleanup is only
  // `removeEventListener` — but "safe to re-subscribe" is not "fresh": between
  // a commit and this PASSIVE effect re-running, the listener in place was the
  // previous render's, closing over the previous render's trap flags. Every
  // value the handler reads is now a ref written in the layout effect above.
  useEffect(() => {
    const land = (event: PopStateEvent) => {
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
      // Every argument is a ref read at CALL time (George R1 P2). None of
      // these may go back to being a closure variable: this handler is
      // subscribed once and runs from a macrotask, so a closure here is a
      // snapshot of whatever render last re-subscribed, which for the trap
      // flags is the difference between routing `"trap-database-panel"` and
      // routing a layer dismissal that clears the floor entry underneath a
      // panel the translator cannot leave.
      const action = popAction(
        direction,
        screenRef.current,
        transitionInFlight.current,
        recoveringRef.current,
        databasePanelRef.current,
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
          // remains beneath this dismissal. `floorArmed` is cleared BEFORE
          // `dismiss()` because the layer's own close handler normally calls
          // `popLayer` as well, and the flag must already read "nothing held"
          // by the time that re-entrant path runs.
          //
          // NO TRAP GUARD HERE, and this is deliberate rather than an omission
          // (George R1 P2 proposed one: "if either trap flag is set, do not
          // take the non-rearm path"). It would be dead code. `popAction`
          // returns `"trap-recovery"` / `"trap-database-panel"` BEFORE it ever
          // reaches layer routing (`navigation.ts:195`, `:210`), so reaching
          // this branch already proves both flags were false — and since the
          // P2 fix above they are the SAME refs, read microseconds earlier in
          // this same synchronous task, with no commit able to interleave. A
          // guard here could never fire. That is the identical objection this
          // file already records for `rearm-layer-busy`: a call whose answer
          // is constant by construction is a branch no test could kill.
          //
          // The ref fix is what actually closes George's scenario; the guard
          // was a second reader of the staleness rather than a fix for it.
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
          onLeaveToBooksRef.current();
          return;
        case "exit-app":
          // The Books shelf pushed no entry, so this popstate is the browser
          // already leaving. Nothing to do — and nothing is lost at the shelf.
          //
          // UNLESS a floor entry was still armed (Amendment G): an overlay was
          // opened and closed by its own control, so this Back consumed THAT
          // entry rather than walking out of the app. Clear the flag — the
          // entry is gone, and the next overlay open must arm a fresh one or
          // its Back would exit. This gesture does nothing visible and a second
          // one leaves; that one silent Back is Amendment G's accepted cost
          // (#535, DRI 2026-09-20),
          // and it cannot be forwarded away here (`history.back()` at the app's
          // first entry is a no-op by spec, so an installed PWA would not
          // leave). See `floorEntryForLayerChange` for the full accounting.
          floorArmed.current = false;
          return;
        default: {
          // Exhaustiveness (repo idiom, share-error-copy.ts:33): a new PopAction
          // member without a case fails to narrow to `never` here.
          const _exhaustive: never = action;
          return _exhaustive;
        }
      }
    };
    // Every landing — suppressed or routed, whichever branch returned — ends
    // by replaying the writes deferred behind it (#435). After the routing,
    // not before: a routed landing may dismiss the overlay a deferred floor
    // arm was for, and the replay re-derives the arm from what is left.
    const onPopState = (event: PopStateEvent) => {
      land(event);
      replayDeferredWrites();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
    // `screen`, `recovering`, `databasePanel` and `onLeaveToBooks` are GONE
    // from this array on purpose (George R1 P2): they are read through
    // layout-written refs above, so re-subscribing on them bought nothing and
    // cost correctness. The listener was only ever as fresh as its last
    // re-subscribe, and that re-subscribe is a PASSIVE effect — so a Back
    // landing between a trap's commit and this effect re-running was routed by
    // the previous render's listener, with `databasePanel` still `false`.
    //
    // The three that remain never change identity: `pushHistoryEntry` and
    // `popLayer` are `useCallback([])`, and `replayDeferredWrites` is built
    // only from callbacks that are (#435). This handler subscribes ONCE for
    // the hook's life. That is the property to preserve — a dependency that
    // can change identity would silently reintroduce the re-subscribe window,
    // so a new value belongs in the layout effect above, not in this array.
  }, [pushHistoryEntry, popLayer, replayDeferredWrites]);

  // The shell's leg of the same model (#374): a hardware Back arrives as the
  // App plugin's `backButton` event, not as a `popstate`. Registered only
  // inside the Capacitor shell — in a browser the gesture is already a history
  // pop and this would be a second listener for the same press. `decide` reads
  // the same layout-written refs the popstate handler does, and only those;
  // `goBack` is `useCallback([])`, so this subscribes once for the hook's life.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    return attachNativeBack(
      App,
      {
        decide: () =>
          popAction(
            "back",
            screenRef.current,
            transitionInFlight.current,
            recoveringRef.current,
            databasePanelRef.current,
            layerStack.current
          ),
        goBack,
      },
      Capacitor.getPlatform() === "android"
    );
  }, [goBack]);

  return {
    pushLayer,
    popLayer,
    openChapter,
    openRecorder,
    goBack,
    commitCloseRecorder,
  };
}
