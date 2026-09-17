import { useCallback, useEffect, useRef, useState } from "react";

import { BooksScreen, type BooksScreenHandle } from "@/components/books-screen";
import { BuildStamp } from "@/components/build-stamp";
import { Recorder, type RecorderHandle } from "@/components/recorder";
import { SaveFailed } from "@/components/save-failed";
import {
  SegmentsScreen,
  type SegmentsScreenHandle,
} from "@/components/segments-screen";
import { requestTranscodeSweep } from "@/hooks/finish-transcode";
import { warmEncoder } from "@/hooks/mp3-codec";
import { useAudioSession } from "@/hooks/use-audio-session";
import { useSaveTake } from "@/hooks/use-save-take";
import {
  navDirection,
  popAction,
  reconcilePopState,
  screenFor,
} from "@/lib/nav/navigation";
import type { ChapterId, SegmentId } from "@/types/domain";

/**
 * The pivot app: Books → Segments → Recorder (a sheet over Segments).
 *
 *   Books      no chapter selected — the home screen (G2: empty on first run)
 *   Segments   a chapter selected
 *   Recorder   a segment being recorded — layered over the dimmed Segments list
 *
 * This screen holds no audio of its own. Every sound belongs to
 * `useAudioSession`, and every screen change goes through a handler that calls
 * `leave()` first, so "leaving ends what was sounding" is one call in one place
 * — which is also what makes "only one row plays" and "opening the recorder
 * stops playback" fall out for free rather than needing their own stop calls.
 *
 * The unsaved-take machinery (`useSaveTake`) is mounted here, above the sheet
 * that produces a take, so a finished recording survives the recorder closing
 * and the recovery screen has something to render when a save fails.
 */
export function App() {
  const [chapterId, setChapterId] = useState<ChapterId | null>(null);
  const [recorder, setRecorder] = useState<{
    segmentId: SegmentId;
    ordinal: number;
  } | null>(null);

  const segmentsRef = useRef<SegmentsScreenHandle>(null);
  // Books' own overlays (#374) — the hamburger Menu, New Book, the book ≡ menu,
  // the delete confirm — none of which push a history entry of their own.
  const booksRef = useRef<BooksScreenHandle>(null);
  // System-Back handling (#168). The recorder sheet, Segments and Books each
  // push one history entry, so a standalone-PWA Back gesture is a `popstate` we
  // route in-app instead of leaving the app — which on the recorder fired
  // `pagehide` → `leave()` and dropped the in-progress take (#58).
  const recorderRef = useRef<RecorderHandle>(null);
  // A recorder Back is running its async commit (stop → decode → save). While it
  // is, EVERY further popstate re-arms the protective entry instead of routing,
  // so a second Back cannot escape the recorder and drop the uncommitted take
  // (Frank R1 F1). Cleared when the commit settles.
  const committing = useRef(false);
  // George round 1 P2-1 (#393): the SAME shape as `committing`, for the window
  // between `dismiss-screen-overlay` re-arming and Books'/Segments' own
  // overlay-close consume actually landing as a popstate. Without this, a
  // popstate arriving in that window — the resulting consume's own traversal,
  // OR a genuinely new system Back — had nothing marking it as "absorb, don't
  // route": the overlay could already read as closed in React state (`Menu`'s
  // scrim/Close cascade, or the row menu's multi-hop `onMenuOpenChange` before
  // this same PR's fix made it synchronous) while history had not yet caught
  // up, so `popAction` ran `to-books`/`exit-app` on a screen that was mid-
  // dismiss rather than actually left. OR'd into `committing` at the call
  // site below rather than given `popAction` a new parameter: the effect
  // (re-arm, absorb) is identical to an in-flight recorder commit, and the
  // existing `"rearm-during-commit"` row already covers it once this is true.
  // Cleared once `outstandingBacks` (below) fully drains to 0 — NOT on every
  // popstate (George round 3): the gap between this being set and the
  // eventual consume actually being ISSUED (a later, state-dependent event —
  // the screen's own effect noticing `hasOpenOverlay()` went false) can see
  // an unrelated popstate land while `outstandingBacks` is still 0, and
  // clearing this then would let `popAction` stop absorbing before the real
  // consume has even been issued, let alone landed.
  const dismissingOverlay = useRef(false);
  // George round 3 (#393): how many of THIS app's own `history.back()` calls
  // are outstanding — not yet resolved by a landed popstate. Replaces round
  // 1/2's `suppressPop` (a single bit: "ignore exactly the next popstate"),
  // which both George's round 2 AND round 3 review found broken the same way:
  // an overlay consume, `closeRecorder`'s programmatic close, and the
  // on-screen Back can all have a `back()` outstanding at once, and the
  // browser is free to deliver those as SEPARATE popstates or COALESCE them
  // into one popstate whose destination index jumps by more than one level
  // (`goBack`'s own comment, below, already documents that coalescing as
  // fact) — a single bit cannot represent "two are outstanding, one landed"
  // or "the jump was bigger than what was outstanding." `reconcilePopState`
  // (`lib/nav/navigation.ts`) is the pure arithmetic that reconciles this
  // count against a landed popstate's actual displacement; this ref is its
  // one piece of App-side state.
  const outstandingBacks = useRef(0);
  // An in-app Back is in flight (its `history.back()` has not yet come back as a
  // popstate). A synchronous latch so a rapid double-tap on the on-screen Back
  // issues only ONE traversal — the tap-level guard `onClick={close}` used to get
  // from `closing.current` before Back was rerouted through history (George R2
  // G3). Cleared as each popstate lands — NARROWER than it once was (George
  // round 3): with `outstandingBacks` now the general "a programmatic back()
  // is outstanding" guard `goBack` itself checks below, this flag's only
  // remaining job is deduping a double-tap on `goBack` specifically, so
  // clearing it on every popstate (rather than only once `outstandingBacks`
  // drains) is still correct — a repeated on-screen Back tap is a narrower
  // problem than the coalescing class the count above exists to solve.
  const backRequested = useRef(false);
  // The CURRENT entry's depth — 0 at the entry the app loaded on, +1 per real
  // push from there. Updated to ground truth (`event.state.index`) on every
  // landed popstate, so it is always the depth `navDirection` and
  // `reconcilePopState` compare a new destination against (F2).
  //
  // Frank, on 11775a6, #393 (George round 3's `reconcilePopState` follow-up):
  // this used to be stamped from a GLOBALLY monotonic counter (`nextIndex`,
  // incremented on every push and never reset or decremented) rather than
  // this ref's own current value. That made stamped indices non-contiguous
  // across a Back-then-push: push (depth 0→1, stamped `1`) → Back (1→0) →
  // `dismiss-screen-overlay` re-arms with ANOTHER push, which the OLD scheme
  // stamped `2` (the counter kept climbing) even though the real browser
  // stack — `pushState` always truncates the forward entries a Back walked
  // past — is back to exactly ONE level deep, the SAME physical depth as the
  // entry the counter had already used for `1`. `reconcilePopState`'s
  // `delta` (`fromIndex - toIndex`) is only meaningful as a REAL traversal
  // count when indices track actual depth; fed a counter-driven gap instead,
  // a single one-level Back down to root (`2 → 0`) miscounted as TWO levels,
  // manufacturing a phantom `remaining` navigation that routed `exit-app`/
  // `to-books` after an overlay dismiss that should have been a total no-op.
  // Stamping every push from THIS ref's own current value, not a separate
  // ever-climbing counter, keeps every reachable entry's stamped index equal
  // to its actual physical depth, so reused depths after a truncating Back
  // (correctly) reuse the same index value instead of leaving a gap.
  const navIndex = useRef(0);

  const pushRawHistoryEntry = useCallback(() => {
    // A marker entry whose only job is to be there for Back to consume,
    // carrying the depth that tells Back from Forward (`navDirection`) and
    // feeds `reconcilePopState`'s displacement arithmetic. Routing reads live
    // React state for the screen, so the entry needs nothing more than this.
    const index = navIndex.current + 1;
    window.history.pushState({ tc: true, index }, "");
    navIndex.current = index;
  }, []);

  // George round 1 P2-2 (#393, widened from Frank round 1's overlay-only
  // version): `window.history.back()` is asynchronous — its `popstate` lands
  // on a LATER task, not synchronously. ANY push while a `back()` is still
  // outstanding (`outstandingBacks`) lands while the browser's still-pending
  // traversal is no longer guaranteed to target the entry it was issued for —
  // not only an overlay reopening (Frank's original finding), but also
  // `openChapter`/`openRecorder`: closing a Books/Segments overlay and
  // immediately tapping a chapter/Edit, before that close's `back()` lands,
  // used to push the new screen's entry unguarded, leaving the UI on a screen
  // history did not agree it had reached. EVERY push now goes through this ONE
  // guard — a COUNT (George round 3 P3-2, widened from round 1/2's single
  // `pendingPush` bit: two real pushes can be requested in the same
  // outstanding window, and a bit can only remember one), incremented rather
  // than fired immediately whenever a back() is still outstanding; the
  // reconciliation branch below drains all of it, in order, once every
  // outstanding back() has resolved, so a push and a pending consume never
  // overlap. The internal re-arm pushes in the popstate switch below
  // (trap-recovery, rearm-during-commit, commit-close-recorder,
  // dismiss-screen-overlay) all run AFTER that reconciliation, at which point
  // `outstandingBacks.current` is proven 0 (see the handler's own comment),
  // so this guard is a proven no-op for them.
  const queuedPushes = useRef(0);
  const pushHistoryEntry = useCallback(() => {
    // George round 4 P2-1 (#393): REFUSE, not queue, while `goBack`'s own
    // routed `back()` is outstanding (`backRequested`) — checked FIRST,
    // ahead of `outstandingBacks`. Those two latches mean different things:
    // `outstandingBacks` marks a back() this app expects to be fully
    // ABSORBED (its resulting popstate carries no new navigational intent,
    // so queuing a push to replay once it resolves is safe); `backRequested`
    // marks a back() that is a REAL navigation about to be ROUTED
    // (`to-books`/`commit-close-recorder`/...), and which screen it lands on
    // is decided only once that popstate arrives. Queuing a push here (the
    // `outstandingBacks` treatment) would drain it onto whatever screen the
    // route ends up leaving the user on — e.g. after `to-books`, the drain
    // would land a chapter/recorder/overlay entry on the BOOKS shelf, which
    // never asked for it (the coalescing pair `goBack`'s own comment already
    // documents, reached through this door instead of a second `back()`).
    // Refusing instead leaves whatever UI change already ran synchronously
    // before this call (`setRecorder(...)`, `setChapterId(...)`) to be
    // resolved by that SAME routed popstate once it lands —
    // `commit-close-recorder` immediately closing a sheet that never got its
    // own history entry is safe (it never drops a take, only ever commits or
    // leaves it open), just a transient open-then-close UI flicker, not the
    // history desync this guard exists to prevent.
    if (backRequested.current) return;
    if (outstandingBacks.current > 0) {
      queuedPushes.current += 1;
      return;
    }
    pushRawHistoryEntry();
  }, [pushRawHistoryEntry]);

  // The programmatic half of #393/#374's overlay-entry bookkeeping: consume the
  // entry `pushHistoryEntry` pushed for an open Books/Segments overlay OR (George
  // round 2 P2-2, round 3 P2-1) the recorder's own entry, once either closes by
  // a NON-popstate path (a tap on Close/scrim, a successful rename, an
  // erase-on-open, a failed save's `onExit`, an idle commit's own exit) —
  // `closeRecorder` and `commit-close-recorder`'s async exit below both call
  // this now, rather than each issuing its own unguarded `history.back()`,
  // since George found first one, then the other, had drifted from this guard
  // in a different way across two rounds. Also shared by `trap-forward`'s
  // cancel below: mechanically identical (issue a `back()`, track it as
  // outstanding), even though it is not "giving back an entry" in the same
  // sense — reusing this one function is what keeps every raw
  // `history.back()` call site in this file behind the SAME counted guard
  // (George round 3: "fold it in... [so it] cannot race").
  const consumeHistoryEntry = useCallback(() => {
    // Frank round 1 P2 (#393, second pass): a reopen (or any other deferred
    // push) already deferred ITS push (`queuedPushes`, above) because a
    // `back()` was still outstanding when it tried to run — so THIS close has
    // nothing real to consume; the entry it would be undoing was never
    // pushed. Cancel one deferred push and stop: issuing a `back()` here
    // would race whatever back() is still outstanding, and the drain below
    // would then push an entry for an overlay that is already closed again.
    // Chains of further rapid toggles collapse the same way, one
    // cancellation at a time, until an actual push or consume runs. Net-zero
    // stack depth either way — cancelling a push someone else queued has the
    // identical effect on the eventual stack as pushing then immediately
    // consuming would, just without the wasted round trip, which is what
    // makes sharing this one counter across every caller (an overlay's own
    // consume, the recorder's) sound rather than coincidental.
    if (queuedPushes.current > 0) {
      queuedPushes.current -= 1;
      return;
    }
    // George round 3 (#393): no longer refuses when another `back()` is
    // already outstanding (round 2's fix did, as the safest option available
    // to a single-bit model) — `reconcilePopState`'s count-based reconciliation
    // now correctly attributes however many popstates land, in whatever
    // order the browser delivers them, against however many are outstanding,
    // so a second (or third) concurrently outstanding `back()` is handled
    // rather than avoided.
    outstandingBacks.current += 1;
    window.history.back();
  }, []);

  // Stamp the entry the app loaded on, so its index is known (0) and a Back from
  // Segments to it reads as a Back, not an untracked jump.
  useEffect(() => {
    window.history.replaceState({ tc: true, index: 0 }, "");
    navIndex.current = 0;
  }, []);

  const goBack = useCallback(() => {
    // Every in-app Back — the Segments list's, the recorder's on-screen Back —
    // goes through the browser so there is ONE Back path (the popstate handler).
    // That is what gives the on-screen recorder Back the same commit-window
    // protection as the system gesture, and removes the state-transition effects
    // whose async re-arm desynced depth (Frank R1 F1).
    //
    // Latch so a same-frame double-tap issues one traversal, not two — the second
    // `history.back()` would otherwise be coalesced into a single 2→0 jump that
    // mis-shapes the stack (George R2 G3). The latch clears as the popstate lands.
    //
    // George round 3 P2-1 (#393): ALSO refuse while a programmatic `back()` is
    // outstanding (`outstandingBacks`, e.g. an overlay-close consume or the
    // recorder's own exit) — a header/on-screen Back tapped in the async gap
    // before that consume's `popstate` lands is the exact coalescing pair
    // this file already documents above, just from a source `backRequested`
    // alone never covered (only a repeated tap on THIS Back guarded against
    // ITSELF). Refusing here is simplest: the overlay/recorder close already
    // has its own outcome in flight, and this tap's intent (leave the
    // screen) is served once that settles and a later, real Back is tried.
    //
    // George round 4 P2-1 (#393): ALSO refuse while `committing` or
    // `dismissingOverlay` is true — matching the SAME windows `popAction`
    // itself absorbs as `rearm-during-commit` (`committing.current ||
    // dismissingOverlay.current`, the switch below). Without this, a tap
    // here during one of those windows issued its own uncounted `back()`
    // (`outstandingBacks` stays 0, since this path never touches it) that
    // `reconcilePopState` cannot see coming — landing as a dead, silently
    // absorbed tap at best, or stacking as an extra uncounted traversal
    // alongside the commit's/dismiss's own eventual consume at worst, the
    // exact coalescing-pair risk every other fix in this file exists to
    // close. Refusing here means the tap's intent (leave the screen) is
    // served once the commit/dismiss settles and a later, real Back is
    // tried — nothing is lost, only deferred.
    if (
      backRequested.current ||
      outstandingBacks.current > 0 ||
      committing.current ||
      dismissingOverlay.current
    )
      return;
    backRequested.current = true;
    window.history.back();
  }, []);
  // Which segment a held take belongs to, for the recovery screen — captured
  // when the recorder opened, so it survives the sheet closing on a failed
  // save. State, not a ref, because the recovery screen reads it during render.
  const [recordingOrdinal, setRecordingOrdinal] = useState<number | null>(null);
  // The cut/paste clipboard (B5), held here so it survives the recorder sheet
  // remounting per segment — G3: it reaches across a chapter and is lost on
  // close. Cleared on every chapter change so it never carries audio from one
  // chapter into another; lost on page close naturally (never persisted).
  const [clipboard, setClipboard] = useState<Int16Array | null>(null);

  const audio = useAudioSession();
  const { leave, primeAudioContext } = audio;

  // Transcode on Finished (B8, D3) is a background sweep. Each Finished
  // transition asks for one; this catch-all at launch covers anything left over
  // — a sweep the page was discarded in the middle of, or every finished
  // segment on a device that just upgraded to the v4 schema. Idempotent, so
  // asking here costs nothing when there is nothing owed.
  useEffect(() => {
    // Keep the encoder worker warm from launch, while this build's precache
    // still holds its chunk — so a Finished transcode or a Share after a
    // service-worker update does not depend on a purged chunk URL (#182).
    warmEncoder();
    void requestTranscodeSweep();
  }, []);
  const {
    pendingTake,
    saveRecording,
    saveEditedSegment,
    retryPendingTake,
    discardPendingTake,
  } =
    // A landed save leaves the row reading as unrecorded until the screen
    // rebuilds, which is the window a second take is lost in — so reload then.
    useSaveTake({ onSaved: () => segmentsRef.current?.reload() });

  const openChapter = useCallback(
    (id: ChapterId) => {
      leave();
      pushHistoryEntry(); // Books → Segments: a Back now returns here
      setClipboard(null); // chapter-scoped (G3)
      setRecorder(null);
      setChapterId(id);
    },
    [leave, pushHistoryEntry]
  );

  const backToBooks = useCallback(() => {
    leave();
    setClipboard(null); // chapter-scoped (G3)
    setRecorder(null);
    setChapterId(null);
  }, [leave]);

  const openRecorder = useCallback(
    (segmentId: SegmentId, ordinal: number) => {
      // Opening the recorder stops any row that was playing — the same single
      // `leave()` every navigation makes.
      leave();
      pushHistoryEntry(); // Segments → Recorder: Back becomes the commit
      // Resume the audio context in THIS tap (#184): the sheet loads and decodes
      // the segment one commit later, after this gesture's activation is spent,
      // so an iOS `"interrupted"` context would otherwise meet the first decode
      // un-resumed — the very trip the #155/#137 recovery panel exists to soften.
      // Priming it here spares the common transient case that failed open.
      primeAudioContext();
      setRecordingOrdinal(ordinal);
      setRecorder({ segmentId, ordinal });
    },
    [leave, primeAudioContext, pushHistoryEntry]
  );

  const closeRecorder = useCallback(
    (dirty: boolean) => {
      // The recorder has already stopped and committed any take before this
      // fires; `leave()` here only releases the floor and ends playback. Reload
      // only when something actually changed — a take committed or the finished
      // flag toggled — so a look-and-close does not pay for peak recomputation.
      leave();
      if (dirty) segmentsRef.current?.reload();
      setRecorder(null);
      // Keep history in step. A popstate-driven close is `committing`: the
      // browser already popped the entry and the handler pops the protective
      // one it re-armed, so leave history alone. A programmatic close (erase,
      // which calls `onExit` directly with no popstate) still has its entry on
      // the stack — consume it. George round 2 P2-2 (#393): this used to issue
      // its own unguarded `history.back()`, which ignored a still-outstanding
      // overlay-consume traversal (Edit inside a row's overflow menu: closing
      // the row menu, opening the recorder, then an erase-on-open or a failed
      // save closing it again — all before the row menu's own consume popstate
      // landed) and left a phantom recorder entry in the stack. Sharing
      // `consumeHistoryEntry`'s guard fixes this the same way it already
      // protects the overlay case.
      if (!committing.current) consumeHistoryEntry();
    },
    [leave, consumeHistoryEntry]
  );

  // A held take whose save has failed takes over the screen with retry/discard
  // (the `SaveFailed` early return below). Computed here so the popstate handler
  // can see it: that screen is a modal, NOT a navigation level, so Back must not
  // route `to-books` under it (George R2 G2).
  const recovery = pendingTake && pendingTake.attempts > 0 ? pendingTake : null;
  const recovering = recovery !== null;

  // Route the system Back gesture (#168), and its Forward sibling. Every screen
  // pushed one indexed history entry, so a gesture arrives as a `popstate` here
  // instead of exiting the app. The whole decision is the pure `popAction`, so
  // the two rules that matter are unit-tested: Back on the recorder runs the
  // COMMIT path (never a take-dropping unmount, #58), and a second Back during
  // that commit re-arms rather than escaping (Frank R1 F1).
  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      // A Back gesture landed, so an in-flight on-screen Back (if any) is
      // done — release `goBack`'s own double-tap latch (G3). See its own
      // comment for why this narrower flag still clears unconditionally,
      // unlike `dismissingOverlay` below.
      backRequested.current = false;
      const state = event.state as { index?: number } | null;
      const toIndex = state?.index ?? 0;
      // Captured BEFORE any mutation below — `direction` (used only once we
      // decide to ROUTE this popstate, further down) must always be computed
      // against where we were the instant this event arrived, never against
      // an already-updated `navIndex.current` (George round 3: an earlier
      // draft of this fix mutated `navIndex` first and read `navDirection`
      // from the same ref, which made every reconciled-but-still-routed
      // popstate read as "same" instead of "back").
      const fromIndex = navIndex.current;
      const delta = fromIndex - toIndex;
      navIndex.current = toIndex; // ground truth, always, regardless of branch
      // George round 3 (#393, P3-3): the pure reconciliation — see
      // `reconcilePopState`'s own doc for why comparing `delta` (the REAL
      // index displacement) against `outstandingBacks` (a COUNT, not the
      // round 1/2 `suppressPop` bit) is what correctly handles a landed
      // popstate regardless of whether the browser coalesced multiple
      // outstanding `back()`s into one jump or delivered them separately.
      const reconciled = reconcilePopState(outstandingBacks.current, delta);
      if (reconciled) {
        outstandingBacks.current = reconciled.outstandingBacks;
        if (reconciled.outstandingBacks === 0) {
          // Every `back()` this app had outstanding has now landed — ONLY
          // now, not on every popstate the old single-bit `suppressPop`
          // branch ran for, is it safe to consider the overlay-dismiss
          // window over (`dismissingOverlay` — see its own comment for why
          // this must wait for the count, not merely "a popstate landed",
          // since the window it guards can still be open even while
          // `outstandingBacks` reads 0: `dismiss-screen-overlay` sets it
          // BEFORE the eventual consume is even issued).
          dismissingOverlay.current = false;
          // George round 4 P2-3 (#393): do NOT drain unconditionally just
          // because `outstandingBacks` reached 0 — check what this SAME
          // popstate is actually doing first, via `reconciled.queuedPushAction`
          // (the pure decision, see `reconcilePopState`'s doc). Draining here
          // unconditionally (round-3's bug) could materialize a queued push
          // meant for the CURRENT screen even though `remaining > 0` means
          // this popstate is about to route the app AWAY from it below —
          // landing the pushed entry on a screen already being left.
          if (
            reconciled.queuedPushAction === "drain" &&
            queuedPushes.current > 0
          ) {
            const drain = queuedPushes.current;
            queuedPushes.current = 0;
            for (let i = 0; i < drain; i += 1) pushRawHistoryEntry();
          } else if (reconciled.queuedPushAction === "drop") {
            // A genuine extra Back coalesced in beyond what was outstanding
            // — the queued push targeted a screen this same event is now
            // routing past, so it is discarded rather than drained.
            queuedPushes.current = 0;
          }
          // else "hold": more of this app's own back()s are still
          // outstanding (only reachable when `reconciled.outstandingBacks`
          // is itself > 0, so this branch is unreachable here — see the
          // `reconcilePopState` invariant test — kept for clarity, not logic).
        }
        if (reconciled.remaining <= 0) return; // fully absorbed; nothing to route
        // Else: `remaining` genuine backward step(s) coalesced into this SAME
        // popstate as our own outstanding debt (George R3 P2-1's exact
        // scenario) — fall through and route below exactly as if this had
        // landed as its own separate popstate; `navIndex`/`fromIndex` above
        // already reflect the true before/after, so no further adjustment is
        // needed for `direction` or the screen read below.
      }
      const direction = navDirection(fromIndex, toIndex);
      const screen = screenFor(chapterId !== null, recorder !== null);
      // Read the CURRENT screen's own overlay state (#393/#374) — Books' and
      // Segments' own React state, still whatever it was the instant BEFORE
      // this gesture, since nothing here has touched it yet. The recorder's
      // overlays are handled entirely inside `commit-close-recorder` below and
      // never reach this flag (`popAction` itself never checks it for that
      // screen either).
      const screenOverlayOpen =
        screen === "books"
          ? (booksRef.current?.hasOpenOverlay() ?? false)
          : screen === "segments"
            ? (segmentsRef.current?.hasOpenOverlay() ?? false)
            : false;
      switch (
        popAction(
          direction,
          screen,
          // George round 1 P2-1: `dismissingOverlay` OR'd in here, not given
          // `popAction` a new parameter — the effect it needs (re-arm,
          // absorb) is exactly what `"rearm-during-commit"` already does for
          // an in-flight recorder commit, and this is the identical shape for
          // an in-flight overlay-dismiss consume.
          committing.current || dismissingOverlay.current,
          recovering,
          screenOverlayOpen
        )
      ) {
        case "trap-recovery":
          // The `SaveFailed` recovery screen is a modal, not a navigation level
          // (George R2 G2), and the only in-memory copy of the held take lives in
          // React state behind it. RE-ARM to absorb the gesture — the same push
          // `rearm-during-commit` uses — never `history.back()`: the browser has
          // already popped one entry toward root, and a second back() walks toward
          // the document unload that drops the take (Frank R3 G-R3-1). Retry /
          // Discard on the panel are the only ways out.
          pushHistoryEntry();
          return;
        case "rearm-during-commit":
          // A commit owns the stack. The browser just popped the protective
          // entry; re-push it so the recorder stays trapped, and ignore the
          // gesture — the in-flight commit is the only thing that may leave.
          pushHistoryEntry();
          return;
        case "trap-forward":
          // Forward is not a navigation this app redoes; cancel it so the UI
          // stays put and history does not desync (F2). Routed through
          // `consumeHistoryEntry` (George round 3): `outstandingBacks` is
          // proven 0 here (the reconciliation branch above already returned
          // if it were not), so its "cancel a deferred push" branch is
          // structurally dead for this call site — but going through the
          // ONE counted issuer, rather than a bespoke `back()`, is what keeps
          // every raw `history.back()` in this file behind the same guard
          // (the exact audit George asked for after finding two OTHER raw
          // sites drift from it across rounds 2 and 3).
          consumeHistoryEntry();
          return;
        case "ignore":
          return;
        case "commit-close-recorder": {
          const handle = recorderRef.current;
          if (!handle) return;
          // The browser already popped the recorder's entry. Re-arm SYNCHRONOUSLY
          // — before the async commit — so the stop → decode → save window is
          // never a moment with no entry protecting the recorder (F1). Run the
          // same `close()` the on-screen Back runs; on exit consume the single
          // protective entry, on decline leave it (the sheet stays open).
          pushHistoryEntry();
          committing.current = true;
          void handle
            .requestClose()
            .then((exited) => {
              // George round 3 P2-1 (#393): this used to be its own
              // unguarded `suppressPop.current = true; window.history.back()`,
              // outside `consumeHistoryEntry`'s guard entirely. `close()`
              // calls `onExit` (which paints Segments, header live) BEFORE
              // this promise resolves, so a header/system Back tapped in
              // this exact async gap raced this call's own `back()` — the
              // identical coalescing class round 2's fix closed for the
              // overlay consume, just reached through the recorder's OWN
              // exit instead. Sharing `consumeHistoryEntry` here closes it
              // the same way.
              if (exited) consumeHistoryEntry();
            })
            .catch((cause: unknown) => {
              // `close()` never rejects by contract (its own `.catch` still calls
              // `onExit`), but the synchronous prelude or an `onExit` throw could —
              // and if `committing` never cleared, EVERY later Back would re-arm and
              // the recorder would be trapped forever (George R2 G4). Surface it.
              console.error("Recorder close rejected", cause);
            })
            .finally(() => {
              committing.current = false;
            });
          return;
        }
        case "to-books":
          backToBooks();
          return;
        case "exit-app":
          // The Books shelf pushed no entry, so this popstate is the browser
          // already leaving. Nothing to do — and nothing is lost at the shelf.
          return;
        case "dismiss-screen-overlay": {
          // The browser already popped the entry Books'/Segments' own overlay
          // pushed when it opened (#393/#374). Re-arm SYNCHRONOUSLY, the same
          // shape `commit-close-recorder` uses above, so there is no moment
          // with no entry protecting the screen from a second Back — then let
          // the screen dismiss its own overlay exactly the way its scrim/
          // Close would. That state change flips `hasOpenOverlay()` false,
          // which the screen's own effect answers by consuming THIS re-armed
          // entry (`onOverlayClose` → `consumeHistoryEntry`), landing the
          // stack back where it was before the overlay opened.
          //
          // `outstandingBacks.current` is proven 0 here (the reconciliation
          // branch above already returned if it were not), so `pushHistoryEntry`
          // always pushes for real. `dismissingOverlay` (George round 1 P2-1)
          // latches on `dismissOverlay()`'s OWN return value, not
          // unconditionally, so ANY popstate landing before the resulting
          // consume's own — the consume's traversal itself, or a genuinely
          // new system Back arriving in that window — is absorbed as
          // `rearm-during-commit` above rather than routed against an overlay
          // that may already read as closed in React state ahead of history
          // catching up. Cleared once `outstandingBacks` fully drains to 0
          // (George round 3 — see that ref's own comment for why NOT on every
          // popstate), once that consume's own `back()` has actually been
          // issued and landed.
          //
          // The return value matters because a screen's own closer can refuse
          // (Books' `onCancelNewBook`, mid-create) — nothing then closes, so
          // no consume ever follows to clear the latch. Setting it true
          // regardless would strand every later Back on `rearm-during-commit`
          // forever, even once the refusal lifts (Frank, on 25faf3f, #393).
          // The re-armed entry from `pushHistoryEntry()` above still stands
          // guard either way — a refused dismissal just means the NEXT Back
          // re-reads `screenOverlayOpen` (still true) and retries this same
          // case, rather than this one silently trapping it.
          pushHistoryEntry();
          dismissingOverlay.current =
            screen === "books"
              ? (booksRef.current?.dismissOverlay() ?? false)
              : screen === "segments"
                ? (segmentsRef.current?.dismissOverlay() ?? false)
                : false;
          return;
        }
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [
    chapterId,
    recorder,
    recovering,
    backToBooks,
    pushHistoryEntry,
    pushRawHistoryEntry,
    consumeHistoryEntry,
  ]);

  // Ahead of everything: a held take whose save has failed keeps the microphone
  // and any sound off under the modal with no control to reach them. (`recovery`
  // and `recovering` are computed above, so the popstate handler can see them.)
  useEffect(() => {
    if (recovering) leave();
  }, [recovering, leave]);

  if (recovery) {
    return (
      <main className="app-shell grid h-full place-items-center">
        <SaveFailed
          state={recovery.state}
          kind={recovery.kind}
          editOnly={recovery.editOnly}
          ordinal={recordingOrdinal}
          attempts={recovery.attempts}
          onRetry={retryPendingTake}
          onDiscard={discardPendingTake}
        />
      </main>
    );
  }

  return (
    <main className="app-shell mx-auto h-full max-w-md">
      {/* The recorder sheet is aria-modal, but the screen behind it stays
          mounted so close can reload() it. `inert` takes that whole background
          out of the focus and pointer tree while the sheet is open, so an
          AT/keyboard/switch user cannot reach the list's Back or a row's Record
          — both call leave() → cancel(), which silently drops the in-progress
          take with no recovery screen (G8). `display: contents` (the `contents`
          utility) keeps this wrapper layout-transparent; inertness still
          propagates to its flat-tree descendants. */}
      <div className="contents" inert={recorder !== null || undefined}>
        {chapterId === null ? (
          <BooksScreen
            ref={booksRef}
            onOpenChapter={openChapter}
            onOverlayOpen={pushHistoryEntry}
            onOverlayClose={consumeHistoryEntry}
          />
        ) : (
          <SegmentsScreen
            ref={segmentsRef}
            chapterId={chapterId}
            audio={audio}
            onBack={goBack}
            onOpenRecorder={openRecorder}
            onOverlayOpen={pushHistoryEntry}
            onOverlayClose={consumeHistoryEntry}
          />
        )}
      </div>

      {recorder && (
        // Keyed on the segment: opening the sheet on a different segment (via a
        // list Record that was reachable before `inert`, or any future path)
        // must REMOUNT, not reuse the prior segment's loaded `view.samples` —
        // splicing those into the new segment's save would write one segment's
        // audio into another (G8).
        <Recorder
          key={recorder.segmentId}
          ref={recorderRef}
          segmentId={recorder.segmentId}
          audio={audio}
          saveRecording={saveRecording}
          saveEditedSegment={saveEditedSegment}
          clipboard={clipboard}
          onClipboardChange={setClipboard}
          onExit={closeRecorder}
          onRequestBack={goBack}
        />
      )}
      <BuildStamp />
    </main>
  );
}
