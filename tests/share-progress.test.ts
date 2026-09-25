import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  HIDDEN,
  MIN_BUSY_MS,
  OUTCOME_HOLD_MS,
  SHARE_SETTLED,
  type ShareGap,
  type ShareProgress,
  type ShareSettled,
  reduceShareProgress,
  settledFromOutcome,
  shareOverlayOwnsScreen,
  shareProgressWakeAt,
} from "@/hooks/share-progress";
import type { ShareOutcome } from "@/hooks/share-flow";
import { region } from "./support";

/**
 * The share progress timeline (#491): a busy modal held for a MINIMUM time so
 * a fast encode still reads as work, then ONE outcome glyph — handed over,
 * dismissed, nothing, failed — held on its own for a moment, then gone.
 *
 * A tester's share on the Android APK looked exactly like a dismissed sheet:
 * the sheet went away, the menu closed, and nothing on screen said which had
 * happened (#336, the 2026-09-17 report). `send()` set `idle` for both and
 * only its return value knew the difference.
 *
 * The machine takes `now` as DATA. No fake timers here: every transition is a
 * pure function of (state, event), so the hold and the release are pinned to
 * the millisecond without a scheduler in the loop. The hook's `setTimeout`
 * glue is browser boundary and mostly not covered (#197) — `tests/share-flow
 * .test.ts`'s `createProgressDriver` block is the one exception, pinning the
 * clock-monotonicity fix (Frank e915d05 P2) with fake timers and an injected
 * clock.
 */
const T0 = 10_000;

function begin(
  work: "prepare" | "send",
  now = T0,
  from: ShareProgress = HIDDEN
): ShareProgress {
  return reduceShareProgress(from, { type: "begin", work, now });
}

function settle(
  state: ShareProgress,
  settled: ShareSettled | null,
  now: number,
  gap?: ShareGap
): ShareProgress {
  return reduceShareProgress(state, { type: "settle", settled, gap, now });
}

function tick(state: ShareProgress, now: number): ShareProgress {
  return reduceShareProgress(state, { type: "tick", now });
}

describe("the busy hold (#491)", () => {
  it("begin from hidden opens busy at `now`, with nothing pending and nothing to wake for", () => {
    const busy = begin("prepare");
    expect(busy).toEqual({
      phase: "busy",
      work: "prepare",
      since: T0,
      pending: null,
    });
    expect(shareProgressWakeAt(busy)).toBeNull();
  });

  it("a settle that lands before MIN_BUSY_MS is HELD, and the wake is scheduled for the hold's end", () => {
    // The issue's own words: a fast encode must still read as "something is
    // happening". Without the hold a sub-100 ms encode flashes a modal for one
    // frame — which is worse than none, because it looks like a glitch.
    const held = settle(begin("send"), "sent", T0 + MIN_BUSY_MS - 1);
    expect(held.phase).toBe("busy");
    expect(held).toMatchObject({ since: T0, pending: { settled: "sent" } });
    expect(shareProgressWakeAt(held)).toBe(T0 + MIN_BUSY_MS);
  });

  it("the tick at exactly MIN_BUSY_MS releases the held settle; one ms earlier does not", () => {
    const held = settle(begin("send"), "sent", T0 + 10);
    expect(tick(held, T0 + MIN_BUSY_MS - 1)).toBe(held);
    const shown = tick(held, T0 + MIN_BUSY_MS);
    expect(shown).toEqual({
      phase: "outcome",
      settled: "sent",
      since: T0 + MIN_BUSY_MS,
    });
    expect(shareProgressWakeAt(shown)).toBe(T0 + MIN_BUSY_MS + OUTCOME_HOLD_MS);
  });

  it("a settle after MIN_BUSY_MS shows the outcome AT ONCE — a slow encode never pays the hold twice", () => {
    const at = T0 + MIN_BUSY_MS + 5_000;
    expect(settle(begin("prepare"), "nothing", at)).toEqual({
      phase: "outcome",
      settled: "nothing",
      since: at,
    });
  });

  it("a null settle — ready, or a retry that re-armed the File — ends busy with NO outcome", () => {
    // Constraint 2 in #491: a spent activation puts the File back and stays
    // ready. That is not a failure and must not show as one. Both paths: the
    // settle after the hold, and the held settle released by the tick.
    expect(settle(begin("prepare"), null, T0 + MIN_BUSY_MS)).toBe(HIDDEN);
    const held = settle(begin("send"), null, T0 + 1);
    expect(held.phase).toBe("busy");
    expect(tick(held, T0 + MIN_BUSY_MS)).toBe(HIDDEN);
  });

  it("a second begin while busy is ignored — a re-entrant tap must not restart the hold", () => {
    const busy = begin("prepare");
    expect(begin("prepare", T0 + 300, busy)).toBe(busy);
    expect(begin("send", T0 + 300, busy)).toBe(busy);
  });

  it("a send begin is ALSO ignored while prepare's own encode is still running (pending is null, not yet settled)", () => {
    // Distinguishes the still-encoding case above from the completed-hold
    // case below: only a prepare that has ALREADY settled (to nothing-to-show)
    // and is merely waiting out the remainder of the hold makes room for a
    // send tap. `status` cannot read "ready" — and so "Share now" cannot be
    // focused — before that settle has happened, so this shape stays a no-op.
    const stillEncoding = begin("prepare");
    expect(stillEncoding.phase).toBe("busy");
    expect((stillEncoding as { pending: unknown }).pending).toBeNull();
    expect(begin("send", T0 + 10, stillEncoding)).toBe(stillEncoding);
  });

  it("a tick while busy with nothing pending is identity, and nothing is scheduled", () => {
    const busy = begin("prepare");
    expect(tick(busy, T0 + MIN_BUSY_MS + 1)).toBe(busy);
    expect(shareProgressWakeAt(busy)).toBeNull();
  });

  it("a second settle while one is already held is ignored — the first word stands", () => {
    const held = settle(begin("send"), "sent", T0 + 1);
    expect(settle(held, "failed", T0 + 2)).toBe(held);
  });
});

describe("the outcome hold (#491)", () => {
  const shown: ShareProgress = { phase: "outcome", settled: "sent", since: T0 };

  it("stays up until OUTCOME_HOLD_MS, then clears on the tick", () => {
    expect(tick(shown, T0 + OUTCOME_HOLD_MS - 1)).toBe(shown);
    expect(tick(shown, T0 + OUTCOME_HOLD_MS)).toBe(HIDDEN);
    expect(shareProgressWakeAt(shown)).toBe(T0 + OUTCOME_HOLD_MS);
  });

  it("a settle while an outcome is showing is stale and ignored", () => {
    expect(settle(shown, "failed", T0 + 5)).toBe(shown);
  });

  it("a fresh begin replaces a still-showing outcome, so a new run is never announced by the last one", () => {
    // Reachable: after a failed prepare the Share control keeps focus behind
    // the scrim, and Enter starts a new encode while the old glyph is up.
    expect(begin("prepare", T0 + 5, shown)).toEqual({
      phase: "busy",
      work: "prepare",
      since: T0 + 5,
      pending: null,
    });
  });
});

describe("the partial outcome carries its gap (P1, this lane's own review round)", () => {
  // A share that genuinely went out, but with a gap `prepare` counted, must
  // not show the plain `sent` tick — see `share-progress.ts`'s header on
  // `ShareSettled` for why. This pins the gap surviving both the immediate
  // and the held-then-released paths, and that `sent` never carries one.
  const gap: ShareGap = { missing: 2, partial: 0, partialChapters: 0 };

  it("a settle after MIN_BUSY_MS shows partial AT ONCE, with its gap attached", () => {
    const at = T0 + MIN_BUSY_MS + 5_000;
    expect(settle(begin("send"), "partial", at, gap)).toEqual({
      phase: "outcome",
      settled: "partial",
      since: at,
      gap,
    });
  });

  it("a partial settle held for MIN_BUSY_MS carries its gap through the tick that releases it", () => {
    const held = settle(begin("send"), "partial", T0 + 10, gap);
    expect(held).toMatchObject({
      phase: "busy",
      pending: { settled: "partial", gap },
    });
    const shown = tick(held, T0 + MIN_BUSY_MS);
    expect(shown).toEqual({
      phase: "outcome",
      settled: "partial",
      since: T0 + MIN_BUSY_MS,
      gap,
    });
  });

  it("a plain sent settle carries no gap", () => {
    const at = T0 + MIN_BUSY_MS + 1;
    const shown = settle(begin("send"), "sent", at) as {
      gap?: ShareGap;
    };
    expect(shown.gap).toBeUndefined();
  });

  it("partial is in SHARE_SETTLED, distinct from sent", () => {
    expect(SHARE_SETTLED).toContain("partial");
    expect(SHARE_SETTLED).toContain("sent");
  });
});

describe("a send tap landing during prepare's own completed hold (P2, this lane's own review round — Frank)", () => {
  // A fast prepare settles to `null` (ready, nothing to show) well before
  // MIN_BUSY_MS, and is left HELD for the remainder of the hold — see "the
  // busy hold" above. `share-progress.tsx` deliberately leaves focus on the
  // control the busy phase started on rather than moving it under the scrim,
  // and the screen has already put `status: "ready"` on `share` the moment
  // that settle landed — so a translator on Enter, or anyone driving
  // "Share now" by assistive technology, CAN activate it before the hold
  // ends. Before this fix, that real `send` begin was silently discarded
  // (the plain "ignored while busy" rule), and the send's own settle a
  // moment later was ALSO discarded (busy with something already pending) —
  // dropping a genuine send outcome with no glyph, no Notice: the exact
  // silent-success defect (#336/#491) this whole modal exists to close.
  const readyHeld = settle(begin("prepare"), null, T0 + 10);

  it("prepare settling to null before the hold elapses leaves busy/prepare HELD, not hidden", () => {
    expect(readyHeld).toMatchObject({
      phase: "busy",
      work: "prepare",
      since: T0,
      pending: { settled: null },
    });
  });

  it("a send begin during that hold starts a FRESH busy phase for send, at the send tap's own time", () => {
    const sendBusy = begin("send", T0 + 20, readyHeld);
    expect(sendBusy).toEqual({
      phase: "busy",
      work: "send",
      since: T0 + 20,
      pending: null,
    });
  });

  it("the send's own outcome now settles normally — held or shown — instead of being swallowed", () => {
    const sendBusy = begin("send", T0 + 20, readyHeld);
    // Held: the fresh hold has its own MIN_BUSY_MS, measured from the send
    // tap's own `since`, not the stale prepare timestamp.
    const held = settle(sendBusy, "sent", T0 + 20 + 5, {
      missing: 0,
      partial: 0,
      partialChapters: 0,
    });
    expect(held).toMatchObject({ phase: "busy", pending: { settled: "sent" } });
    expect(tick(held, T0 + 20 + MIN_BUSY_MS)).toEqual({
      phase: "outcome",
      settled: "sent",
      since: T0 + 20 + MIN_BUSY_MS,
      gap: { missing: 0, partial: 0, partialChapters: 0 },
    });
  });

  it("a fresh send begin is still ignored once a REAL send is already busy — no restarting an in-flight send", () => {
    const sendBusy = begin("send", T0 + 20, readyHeld);
    expect(begin("send", T0 + 25, sendBusy)).toBe(sendBusy);
    expect(begin("prepare", T0 + 25, sendBusy)).toBe(sendBusy);
  });
});

describe("dismiss and stale events (#491)", () => {
  it("dismiss from every phase goes hidden and cancels any wake", () => {
    // A menu closed mid-encode (scrim, Escape, Back) must not leave the modal
    // up over a screen that has moved on.
    const states: ShareProgress[] = [
      HIDDEN,
      begin("prepare"),
      settle(begin("send"), "sent", T0 + 1),
      { phase: "outcome", settled: "dismissed", since: T0 },
    ];
    for (const state of states) {
      const next = reduceShareProgress(state, { type: "dismiss" });
      expect(next, `dismiss from ${state.phase}`).toBe(HIDDEN);
      expect(shareProgressWakeAt(next)).toBeNull();
    }
  });

  it("a settle or a tick from hidden stays hidden — a stale settle after a reset never re-shows anything", () => {
    // The superseded-run class (George R-B7-book P2): a sheet settling for a
    // run a newer prepare replaced must not flash an outcome over the new
    // run's menu.
    expect(settle(HIDDEN, "sent", T0)).toBe(HIDDEN);
    expect(settle(HIDDEN, "failed", T0)).toBe(HIDDEN);
    expect(tick(HIDDEN, T0)).toBe(HIDDEN);
  });

  it("MIN_BUSY_MS and OUTCOME_HOLD_MS are both real holds", () => {
    // A zero here turns the whole machine into a pass-through and every test
    // above still passes on the equalities; pin that both are positive.
    expect(MIN_BUSY_MS).toBeGreaterThan(0);
    expect(OUTCOME_HOLD_MS).toBeGreaterThan(0);
  });
});

describe("settledFromOutcome — what the hook's send outcome becomes on screen (#491)", () => {
  // A `Record` over the HOOK's union, so widening `ShareOutcome` without
  // deciding what the modal shows for the new member is a compile error here,
  // not a silent default (the #457 mechanism).
  const expected: Record<ShareOutcome, ShareSettled | null> = {
    sent: "sent",
    dismissed: "dismissed",
    // A native Android resolve this platform cannot vouch for (Frank a446708
    // P2) — passes through unchanged, same as sent/dismissed/failed above.
    unproven: "unproven",
    failed: "failed",
    // Activation spent, File put back, still ready: NOT a failure (constraint 2).
    retry: null,
    // A newer run owns the flow; the stale settle shows nothing.
    superseded: null,
  };

  for (const [outcome, settled] of Object.entries(expected) as [
    ShareOutcome,
    ShareSettled | null,
  ][]) {
    it(`${outcome} -> ${String(settled)}`, () => {
      expect(settledFromOutcome(outcome)).toBe(settled);
    });
  }

  it("retry is never an outcome glyph — the File is still armed and the control still says Share now", () => {
    expect(settledFromOutcome("retry")).toBeNull();
    expect(SHARE_SETTLED).not.toContain("retry");
    expect(SHARE_SETTLED).not.toContain("superseded");
  });

  it("the settled list is derived from a Record keyed by the union, not hand-written", () => {
    const source = read("src/hooks/share-progress.ts");
    expect(source).toMatch(/Record<ShareSettled, true>/);
    expect(source).toMatch(/SHARE_SETTLED = Object\.keys\(/);
  });
});

/**
 * `shareOverlayOwnsScreen` — the ONE predicate both screens derive their
 * isolation guards from (George r1 P2 #1/#2). It is deliberately just
 * `phase !== "hidden"`, but pinned by name rather than inlined at every call
 * site: a screen that drifted to checking `phase === "busy"` alone (missing
 * the outcome hold) would reintroduce exactly the window George found —
 * Delete reachable while the outcome glyph is still up.
 */
describe("shareOverlayOwnsScreen (George r1 P2 #1/#2, #491)", () => {
  it("is false only at rest", () => {
    expect(shareOverlayOwnsScreen(HIDDEN)).toBe(false);
  });

  it("is true for the whole busy phase, pending settle or not", () => {
    expect(
      shareOverlayOwnsScreen({
        phase: "busy",
        work: "prepare",
        since: 0,
        pending: null,
      })
    ).toBe(true);
    expect(
      shareOverlayOwnsScreen({
        phase: "busy",
        work: "send",
        since: 0,
        pending: { settled: "sent" },
      })
    ).toBe(true);
  });

  it("is true for the whole outcome hold — the window George found Delete reachable in", () => {
    expect(
      shareOverlayOwnsScreen({
        phase: "outcome",
        settled: "sent",
        since: 0,
      })
    ).toBe(true);
    expect(
      shareOverlayOwnsScreen({
        phase: "outcome",
        settled: "failed",
        since: 0,
      })
    ).toBe(true);
  });
});

/**
 * Source-shape text matches, not checks of wiring: a `readFileSync` read and
 * a string/pattern match confirm the expected text appears in source, not
 * that it executes. These do not run hook effects or gestures.
 */
const read = (rel: string) =>
  readFileSync(path.resolve(import.meta.dirname, "..", rel), "utf8");

describe("the hook drives the machine, and the screens render it (#491)", () => {
  // The knip blind spot AGENTS.md names first: a module imported only by a
  // test looks used. These reads pin that the machine is wired, not merely
  // correct.
  const flow = read("src/hooks/share-flow.ts");

  it("send() begins the busy phase AFTER taking the File and BEFORE the sheet call, with no await between", () => {
    // The iOS activation contract: `navigator.share` must be the first await
    // in the gesture. The begin dispatch is a synchronous state write, so it
    // may sit before the call — but nothing else may.
    const from = flow.indexOf("const armed = handoff.take();");
    const to = flow.indexOf("await navigator.share(");
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    const gesture = flow.slice(from, to);
    expect(gesture).toMatch(/type: "begin",\s*work: "send"/);
    // The only await in that window is the native route's own sheet call.
    // Comments stripped first: the prose around this contract says "await"
    // several times over, and a comment is not a suspension point.
    const code = gesture.replace(/\/\/.*$/gm, "");
    const awaits = code.match(/\bawait\b/g) ?? [];
    expect(awaits).toHaveLength(1);
    expect(code).toMatch(/await nativeShare\.send\(/);
  });

  it("prepare() begins the busy phase beside its `preparing` status", () => {
    expect(flow).toMatch(/type: "begin",\s*work: "prepare"/);
  });

  it("send() only ever settles the modal through settledFromOutcome, never a hand-mapped outcome", () => {
    expect(flow).toMatch(/settledFromOutcome\(outcome\)/);
    expect(flow).not.toMatch(/settled: "retry"/);
  });

  it("reset() and unmount dismiss the modal", () => {
    expect(
      (flow.match(/type: "dismiss"/g) ?? []).length
    ).toBeGreaterThanOrEqual(2);
  });

  for (const [screen, hook] of [
    ["src/components/segments-screen.tsx", "share"],
    ["src/components/books-screen.tsx", "bookShare"],
  ] as const) {
    it(`${screen.split("/").pop()} renders <ShareProgress> from ${hook}.progress, wired to ${hook}.reset directly (George r1 P2 #1/#2)`, () => {
      const source = read(screen);
      expect(source).toMatch(
        new RegExp(`<ShareProgress[\\s\\S]*?progress=\\{${hook}\\.progress\\}`)
      );
      // A long book encode with no pointer cancel is the risk the ORIGINAL
      // plan named — but wiring the modal's cancel to the SCREEN's full menu
      // close (`onCloseChapterMenu`/`onCloseShareMenu`) was itself George r1's
      // finding: that close now refuses to run at all while this overlay is
      // up (see the `shareOverlayOwnsScreen` assertions below), so it can no
      // longer be what a busy-phase cancel goes through. `${hook}.reset`
      // itself already refuses while `handoff.sending` (this lane's prior
      // round), so wiring straight to it keeps the cancel working during
      // PREPARE while still being inert during SEND.
      expect(source).toMatch(new RegExp(`onCancel=\\{${hook}\\.reset\\}`));
      expect(source).not.toMatch(/onCancel=\{onClose(Share|Chapter)Menu\}/);
      expect(source).toMatch(
        new RegExp(`onDismiss=\\{${hook}\\.dismissProgress\\}`)
      );
    });
  }

  /**
   * The CLOSE guard — kept (#491, the DRI's option-A pick on the judgment
   * sheet, issuecomment-5739827376 / issuecomment-5741730440). Every OTHER
   * per-handler `shareOverlayOwnsScreen` guard this menu's controls carried
   * (Rename, `onArmDelete`) was REMOVED in this round, replaced by
   * `<Menu>`'s own `inert` prop — see the block below. This one stays,
   * because `onCloseChapterMenu`/`onCloseShareMenu` are reachable from TWO
   * places `inert` cannot reach: `menu.tsx`'s own `window` Escape listener,
   * and its scrim `onClick` — neither is inside the panel's `inert`
   * subtree, since `inert` scopes to a DOM subtree, not to a global
   * listener or a sibling backdrop.
   */
  /**
   * Books' row differs since #452 PR3, and it is the same claim, tightened.
   *
   * The close is now the STATE half `closeBookMenuState` (`onCloseShareMenu`
   * is it plus the layer deregistration), and its guard reads
   * `bookShare.ownsScreen()` — the flow's LIVE state — rather than
   * `shareOverlayOwnsScreen(bookShare.progress)`, the rendered mirror. Same
   * predicate over the same machine (`ownsScreen` IS
   * `shareOverlayOwnsScreen` over the progress driver's own synchronous
   * state, `share-flow.ts`), one commit fresher. The freshness is
   * load-bearing now that this function is also a `Layer`'s `dismiss()`,
   * reached only when that layer's `busy()` has just read the live value: two
   * copies of the same fact can disagree for one commit, and the
   * disagreement is the bad way round — `busy()` false, this guard true —
   * which is a Back that unregisters the layer and releases the history entry
   * protecting it while the menu stays open.
   *
   * Segments' row moved the same way in #452 PR4, so BOTH rows now name the
   * state half and the live read. The rendered mirror is still what each
   * screen's `listInert` / shelf `inert` reads (asserted separately below) —
   * that is a rendering decision, where last commit's value is the right one;
   * it is only the `popstate`-reachable close that must not use it.
   */
  for (const [screen, hook, closeFn, guard] of [
    [
      "src/components/segments-screen.tsx",
      "share",
      "closeChapterMenuState",
      // Through the local binding `shareOwnsScreen`, which the assertion below
      // pins to `share.ownsScreen` — Segments needs the binding because its
      // `dismissOverlays` feeds `useImperativeHandle`'s dependency array and
      // `exhaustive-deps` would otherwise demand the whole hook object there
      // (#452 PR4's answer to the design's open question 3). Same predicate,
      // same freshness; only the spelling differs from Books'.
      String.raw`if \(shareOwnsScreen\(\)\) return false;`,
    ],
    [
      "src/components/books-screen.tsx",
      "bookShare",
      "closeBookMenuState",
      String.raw`if \(bookShare\.ownsScreen\(\)\) return false;`,
    ],
  ] as const) {
    const name = screen.split("/").pop();

    it(`${name}: ${closeFn} refuses to run while the overlay owns the screen, as its FIRST statement (kept — inert cannot reach Menu's window Escape listener, its scrim click, or the system Back gesture)`, () => {
      const source = read(screen);
      const at = source.indexOf(`const ${closeFn} = useCallback(() => {`);
      expect(at).toBeGreaterThan(-1);
      const body = source.slice(at, source.indexOf("}, [", at));
      const guardRe = new RegExp(guard);
      expect(body).toMatch(guardRe);
      // FIRST statement in the body (skipping only its own leading comment
      // lines) — before any of the teardown it exists to prevent.
      const guardAt = body.search(guardRe);
      const firstStateWrite = body.search(
        /set(ChapterMenuOpen|ShareMenuBookId|RenamingChapter|RenamingBook)\(/
      );
      expect(firstStateWrite).toBeGreaterThan(guardAt);
    });

    it(`${name}: listInert / the shelf's inert includes shareOverlayOwnsScreen(${hook}.progress) — the BACKGROUND list/shelf, a separate concern from the menu panel's own inert below`, () => {
      const source = read(screen);
      expect(source).toMatch(
        new RegExp(`shareOverlayOwnsScreen\\(${hook}\\.progress\\)`)
      );
    });
  }

  /**
   * The binding Segments' guard above goes through, pinned to the hook member
   * it claims to be. Without this, `shareOwnsScreen` in that regex could be any
   * local function — including one built from the RENDERED mirror, which is
   * precisely the shape the guard test exists to rule out. (#452 PR4. Books
   * needs no equivalent: its guard names `bookShare.ownsScreen()` directly.)
   */
  it("segments-screen.tsx: `shareOwnsScreen` IS `share.ownsScreen`, the live flow read — not a local rebuild of the rendered mirror", () => {
    const source = read("src/components/segments-screen.tsx");
    expect(source).toMatch(/const shareOwnsScreen = share\.ownsScreen;/);
  });

  /**
   * The class-level primitive itself (#491, DRI option A): while the overlay
   * owns the screen, `<Menu>`'s own `inert` prop takes over the panel — the
   * header (Close) AND every child, Rename/Delete/Share/Send/the rename
   * field included — as ONE subtree, replacing the per-handler guards those
   * controls carried one round at a time (George r1 P2 #2 for Rename/Delete;
   * Frank at `ec2a148`, still open going into this round, for Share/Send,
   * which had never been guarded at all). Red-first: with `<Menu>`'s own
   * `inert={inert || undefined}` deleted from `menu.tsx`, the first
   * assertion below fails to even find it (`expected -1 to be greater
   * than -1`); with either screen's own `inert={shareOverlayOwnsScreen(...)}`
   * prop deleted from its `<Menu>` call, the corresponding wiring assertion
   * fails the same way.
   */
  it("menu.tsx: `inert` covers the header (Close) AND every child as ONE subtree, positioned inside the aria-modal panel but around neither `liveRegion` (mutation: delete `inert={inert || undefined}` and this test dies)", () => {
    const source = read("src/components/menu.tsx");
    const panelAt = source.indexOf('className="menu-panel"');
    expect(panelAt).toBeGreaterThan(-1);
    const liveRegionAt = source.indexOf("{liveRegion}", panelAt);
    const wrapperAt = source.indexOf("inert={inert || undefined}", panelAt);
    const headerAt = source.indexOf("ref={headerRef}", panelAt);
    // The dismiss control is anchored by its accessible name, not its glyph:
    // the glyph is conditional since #608 (≡ on the global menu, a chevron
    // everywhere else) while `closeLabel` is what it is called in every state.
    const closeControlAt = source.indexOf("label={closeLabel}", panelAt);
    const childrenAt = source.indexOf("{children}", panelAt);
    expect(liveRegionAt).toBeGreaterThan(panelAt);
    // `liveRegion` renders BEFORE (outside) the inert wrapper — deleting the
    // wrapper collapses this to -1, which is not greater than a real index.
    expect(wrapperAt).toBeGreaterThan(liveRegionAt);
    // The header — Close included — opens AFTER (inside) the wrapper.
    expect(headerAt).toBeGreaterThan(wrapperAt);
    expect(closeControlAt).toBeGreaterThan(headerAt);
    // `children` (Rename, Share/Send, Delete, the rename field) closes the
    // same wrapper, after the header.
    expect(childrenAt).toBeGreaterThan(closeControlAt);
  });

  for (const [screen, hook] of [
    ["src/components/segments-screen.tsx", "share"],
    ["src/components/books-screen.tsx", "bookShare"],
  ] as const) {
    const name = screen.split("/").pop();

    it(`${name}: the share ≡ Menu is inert from shareOverlayOwnsScreen(${hook}.progress) — wiring the primitive, not a per-handler guard`, () => {
      const source = read(screen);
      expect(source).toMatch(
        new RegExp(`inert=\\{shareOverlayOwnsScreen\\(${hook}\\.progress\\)\\}`)
      );
    });
  }

  /**
   * Frank's open P2 at `ec2a148`: the Share control itself (`onPrepareShare`/
   * `onSendShare` and their book equivalents) was never guarded by
   * `shareOverlayOwnsScreen` at all — AT gesture navigation could activate it
   * during the outcome hold and start a fresh gather/encode behind the
   * visible glyph. The DRI's fix is that it STAYS unguarded — Share/Send get
   * no fifth per-handler patch — because the panel's `inert` (above) already
   * makes them unreachable for the whole window the guard would have
   * checked. This pins BOTH halves of that claim: no guard was added, and
   * the controls are structurally inside the SAME `<Menu>` that carries
   * `inert`.
   */
  for (const [screen, hook, prepareFn, sendFn, prepareClick, sendClick] of [
    [
      "src/components/segments-screen.tsx",
      "share",
      "onPrepareShare",
      "onSendShare",
      "onPrepare={onPrepareShare}",
      "onSend={onSendShare}",
    ],
    [
      "src/components/books-screen.tsx",
      "bookShare",
      "onPrepareBookShare",
      "onSendBookShare",
      "onPrepare={onPrepareBookShare}",
      "onSend={onSendBookShare}",
    ],
  ] as const) {
    const name = screen.split("/").pop();

    it(`${name}: ${prepareFn}/${sendFn} carry no shareOverlayOwnsScreen guard of their own (Frank ec2a148 P2 — closed by the primitive)`, () => {
      const source = read(screen);
      const prepareAt = source.indexOf(`const ${prepareFn} = useCallback`);
      expect(prepareAt).toBeGreaterThan(-1);
      const prepareBody = source.slice(
        prepareAt,
        source.indexOf("}, [", prepareAt)
      );
      expect(prepareBody).not.toMatch(/shareOverlayOwnsScreen/);
      const sendAt = source.indexOf(`const ${sendFn} = useCallback`);
      expect(sendAt).toBeGreaterThan(-1);
      const sendBody = source.slice(sendAt, source.indexOf("}, [", sendAt));
      expect(sendBody).not.toMatch(/shareOverlayOwnsScreen/);
    });

    it(`${name}: Share/Send render inside the SAME <Menu> that carries inert={shareOverlayOwnsScreen(${hook}.progress)}`, () => {
      const source = read(screen);
      const menuInertAt = source.indexOf(
        `inert={shareOverlayOwnsScreen(${hook}.progress)}`
      );
      expect(menuInertAt).toBeGreaterThan(-1);
      const menuCloseAt = source.indexOf("</Menu>", menuInertAt);
      const prepareUseAt = source.indexOf(prepareClick, menuInertAt);
      const sendUseAt = source.indexOf(sendClick, menuInertAt);
      expect(prepareUseAt).toBeGreaterThan(menuInertAt);
      expect(prepareUseAt).toBeLessThan(menuCloseAt);
      expect(sendUseAt).toBeGreaterThan(menuInertAt);
      expect(sendUseAt).toBeLessThan(menuCloseAt);
    });
  }

  /**
   * The ternary's own half of the #96/#97 contract, asserted ONCE now that
   * both menus render the same rows (#160, L-15).
   *
   * This got stronger in the move rather than weaker: it used to be the same
   * property checked separately in two files that had to stay in step by
   * hand. A `fallback` ref must be attached to EVERY branch, so it survives
   * the ternary remounting the originally captured trigger out from under it
   * — "Share chapter"/"Share book" swapping for "Share now" before the
   * overlay has shown anything.
   */
  it("share-menu-section.tsx: the controlRef is attached to every branch of the Share/Send ternary", () => {
    const source = read("src/components/share-menu-section.tsx");
    const occurrences = source.split("ref={controlRef}").length - 1;
    // Exactly two: the "ready" (Share now) branch and the "not ready"
    // (Share chapter/book, including preparing) branch.
    expect(occurrences).toBe(2);
  });

  /**
   * The two guards George r1 P2 #2 added (Rename's `onClick`, books'
   * `onArmDelete`) were REMOVED in that round, not just left in place beside
   * `inert` — a per-handler check that can silently drift out of sync with
   * the primitive is worse than no check at all (it looks like coverage
   * without proving it). Both controls are inside the SAME `inert` subtree
   * pinned above, so removing the guard did not reopen George r1 P2 #2.
   *
   * `onArmDelete`'s guard is BACK, though (#517 item 1, George r3 P3 on
   * #508) — not because that reasoning was wrong, but as defense in depth
   * for the specific case `inert` itself does not hold: unlike Rename
   * (entering an in-menu edit mode), an unguarded `onArmDelete` still runs
   * `setDeleteTargetId` even when the immediately-preceding
   * `onCloseShareMenu()` call refuses to close, arming a destructive confirm
   * that would paint under the share glyph at the same z-index. Rename's own
   * guard stays removed — this is a scoped reversal of one case, not the
   * whole round.
   */
  it("segments-screen.tsx: Rename's onClick carries no shareOverlayOwnsScreen guard of its own any more", () => {
    const source = read("src/components/segments-screen.tsx");
    expect(source).toMatch(/onClick=\{\(\) => setRenamingChapter\(true\)\}/);
  });

  it("books-screen.tsx: Rename's onClick carries no shareOverlayOwnsScreen guard of its own any more", () => {
    const source = read("src/components/books-screen.tsx");
    expect(source).toMatch(/onClick=\{\(\) => setRenamingBook\(true\)\}/);
  });

  it("books-screen.tsx: onArmDelete carries its own shareOverlayOwnsScreen guard again, as defense in depth (#517 item 1)", () => {
    const source = read("src/components/books-screen.tsx");
    const armAt = source.indexOf("const onArmDelete = useCallback(() => {");
    expect(armAt).toBeGreaterThan(-1);
    const armBody = source.slice(armAt, source.indexOf("}, [", armAt));
    expect(armBody).toMatch(
      /if \(shareOverlayOwnsScreen\(bookShare\.progress\)\) return;/
    );
  });

  /**
   * George r1 P2 #3: the outcome text mirrored in a live region that
   * descends from the `Menu`'s own `aria-modal` dialog, since `<ShareProgress
   * >` itself is a sibling portal Chromium/WebKit hide from AT focused inside
   * a DIFFERENT `aria-modal`. Moved from a `children` entry to `<Menu>`'s own
   * `liveRegion` PROP in an earlier round (#491, DRI option A): `inert`
   * removes a subtree from the accessibility tree entirely, so a live region
   * nested inside the now-inert `children` would go silent exactly when it
   * needs to speak — see `menu.tsx`'s `liveRegion` docblock.
   *
   * George r3 P2-1 (#491): that earlier round mounted `liveRegion` only on
   * `phase === "outcome"`, but the in-menu `tone="busy"` Notice — the busy
   * phase's OWN announcement — is `children`, so it goes `inert` for the
   * whole encode too. The DRI's one-line pick (issuecomment-5742423578)
   * widens the guard to `shareOverlayOwnsScreen(progress)`
   * (`phase !== "hidden"`), covering busy and outcome alike.
   */
  for (const [screen, hook, scope] of [
    ["src/components/segments-screen.tsx", "share", "chapter"],
    ["src/components/books-screen.tsx", "bookShare", "book"],
  ] as const) {
    it(`${screen.split("/").pop()}: passes shareProgressText as <Menu>'s liveRegion PROP, not a child — outside inert, inside the aria-modal panel`, () => {
      const source = read(screen);
      const liveRegionPropRe = new RegExp(
        `liveRegion=\\{\\s*shareOverlayOwnsScreen\\(${hook}\\.progress\\) && \\(\\s*<span className="sr-only" role="status" aria-live="polite">\\s*\\{shareProgressText\\(${hook}\\.progress, "${scope}"\\)\\}`
      );
      expect(source).toMatch(liveRegionPropRe);
      // A PROP of <Menu ...>, so it appears before `children` starts —
      // found by the ternary that opens the stale/rename/action-list split.
      const menuOpenAt = source.indexOf(
        `title={strings.${scope === "chapter" ? "chapterMenuTitle" : "bookMenuTitle"}}`
      );
      expect(menuOpenAt).toBeGreaterThan(-1);
      const childrenStartAt = source.indexOf(
        scope === "chapter"
          ? "{staleTarget ? ("
          : "{renamingBook && shareMenuBook ? (",
        menuOpenAt
      );
      expect(childrenStartAt).toBeGreaterThan(-1);
      const liveRegionAt = source.search(liveRegionPropRe);
      expect(liveRegionAt).toBeGreaterThan(menuOpenAt);
      expect(liveRegionAt).toBeLessThan(childrenStartAt);
    });
  }

  /**
   * George r3 P2-1 (#491), the DRI's fix itself: during the BUSY phase —
   * while the panel's `children` (including the in-menu `tone="busy"`
   * Notice) are `inert` and therefore invisible to the accessibility tree —
   * the `liveRegion` prop must still exist, sit outside the `inert` wrapper,
   * inside the `aria-modal` panel, and carry the busy-phase text
   * (`shareProgressText`'s `"busy"` case: `sharePreparing`/
   * `shareBookPreparing` for prepare-work, `shareHandingOver` for
   * send-work) — not just the outcome text. `shareOverlayOwnsScreen`
   * (`phase !== "hidden"`) must keep the live region present during both
   * busy and outcome phases.
   */
  for (const [screen, hook, scope] of [
    ["src/components/segments-screen.tsx", "share", "chapter"],
    ["src/components/books-screen.tsx", "bookShare", "book"],
  ] as const) {
    it(`${screen.split("/").pop()}: liveRegion mounts during the BUSY phase too, not just outcome — the in-menu busy Notice goes inert for the whole encode`, () => {
      const source = read(screen);
      // The guard must be the class-level `shareOverlayOwnsScreen` primitive
      // (phase !== "hidden"), not a phase === "outcome" comparison — a
      // narrower guard (even `phase === "busy" || phase === "outcome"`)
      // would still pass the OLD test above accidentally if written
      // carelessly, so this pins the exact primitive DRI picked.
      const liveRegionPropRe = new RegExp(
        `liveRegion=\\{\\s*shareOverlayOwnsScreen\\(${hook}\\.progress\\) && \\(\\s*<span className="sr-only" role="status" aria-live="polite">\\s*\\{shareProgressText\\(${hook}\\.progress, "${scope}"\\)\\}`
      );
      expect(source).toMatch(liveRegionPropRe);
      expect(source).not.toMatch(
        new RegExp(`liveRegion=\\{\\s*${hook}\\.progress\\.phase === "outcome"`)
      );
      // Structural placement holds for the busy phase exactly as it does for
      // outcome: outside `inert`, inside the `aria-modal` panel (the `inert`
      // prop itself — same guard, `shareOverlayOwnsScreen` — is what makes
      // `children` (the busy Notice) go inert; `liveRegion` sits before it).
      const inertPropAt = source.indexOf(
        `inert={shareOverlayOwnsScreen(${hook}.progress)}`
      );
      expect(inertPropAt).toBeGreaterThan(-1);
      const liveRegionAt = source.search(liveRegionPropRe);
      expect(liveRegionAt).toBeGreaterThan(inertPropAt);
    });
  }

  it("the modal takes its ARIA role from the tone table, never from the caller", () => {
    const modal = read("src/components/share-progress.tsx");
    expect(modal).toMatch(/noticePresentation\(/);
    expect(modal).not.toMatch(/role="dialog"/);
  });

  /**
   * Frank round 2 P2 gave `share-progress.tsx` its own capture/restore pair:
   * save `document.activeElement` at the same edge the panel grabs focus,
   * restore it (if still connected) going hidden. George r2 P2-1 (#491)
   * found that this component-local version raced `inert`: the capture ran
   * in a PASSIVE `useEffect` keyed on `visible`, but this round's `inert`
   * primitive now applies in the SAME commit the overlay becomes visible,
   * and `inert` blurs the real trigger to `document.body` during React's
   * mutation phase — before any passive effect can read
   * `document.activeElement`. So the capture here read `body`, not the
   * trigger. Removed, in favour of the #96/#97 contract
   * (`lib/a11y/focus-restore.ts`/`hooks/use-focus-restore.ts`) wired from the
   * SCREENS instead — see the "focus-restore wiring" describe block below.
   * This component's OWN remaining job is grabbing focus onto its own panel
   * only; it must not resurrect a capture/restore pair of its own.
   */
  it("share-progress.tsx no longer captures/restores the trigger itself — that moved to the screens (George r2 P2-1)", () => {
    const modal = read("src/components/share-progress.tsx");
    expect(modal).not.toMatch(/returnFocusRef/);
    // `useLayoutEffect`, not `useEffect`, as of #517 item 4 (George r3 P3 on
    // #508) — see `tests/share-progress-overlay-layout-effects.test.ts` for
    // why. This locator only needs the CURRENT hook spelling to find the
    // effect; that file is what pins the spelling itself.
    const at = modal.indexOf("useLayoutEffect(() => {\n    if (visible)");
    expect(at).toBeGreaterThan(-1);
    const effectEnd = modal.indexOf("}, [visible]);", at);
    const body = modal.slice(at, effectEnd);
    expect(body).toMatch(/panelRef\.current\?\.focus\(\);/);
    // The old shape captured `document.activeElement` in this same effect —
    // confirms the capture, not just the ref name, is gone from it.
    expect(body).not.toMatch(/document\.activeElement/);
  });

  /**
   * The #96/#97 contract (`lib/a11y/focus-restore.ts`,
   * `hooks/use-focus-restore.ts`), wired from the screens (George r2 P2-1,
   * #491): `capture()` must run SYNCHRONOUSLY inside the opening gesture's
   * own handler — before `<Menu inert={...}>` can apply `inert` in the same
   * render, never from an effect — and `restore()` must run from a
   * `useLayoutEffect` keyed on the overlay no longer owning the screen, after
   * `inert` has lifted. A `fallback` ref is attached to EVERY branch of the
   * status-driven Share/Send ternary, so it survives that ternary remounting
   * the originally captured trigger out from under it — e.g. "Share
   * chapter"/"Share book" swapping for "Share now" before the overlay has
   * shown anything.
   */
  for (const [screen, hook, prepareFn, sendFn, controlRefName] of [
    [
      "src/components/segments-screen.tsx",
      "share",
      "onPrepareShare",
      "onSendShare",
      "shareControlRef",
    ],
    [
      "src/components/books-screen.tsx",
      "bookShare",
      "onPrepareBookShare",
      "onSendBookShare",
      "shareControlRef",
    ],
  ] as const) {
    const name = screen.split("/").pop();

    it(`${name}: calls useFocusRestore() and captures synchronously before any other work in ${prepareFn}/${sendFn}`, () => {
      const source = read(screen);
      expect(source).toMatch(
        /import \{ useFocusRestore \} from "@\/hooks\/use-focus-restore";/
      );
      expect(source).toMatch(/const focusRestore = useFocusRestore\(\);/);
      for (const fn of [prepareFn, sendFn]) {
        const fnAt = source.indexOf(`const ${fn} = useCallback(() => {`);
        expect(fnAt, `${fn} not found`).toBeGreaterThan(-1);
        const bodyStart = source.indexOf("{", fnAt) + 1;
        const statements = source
          .slice(bodyStart, bodyStart + 300)
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
        // At most ONE leading statement is tolerated ahead of the capture,
        // and only a pure early-return bail (books-screen's "no book, no
        // menu to arm a share for") — never a mutation, never audio
        // teardown, never a session bump: those still must not outrun the
        // capture, which is the property this test exists to pin.
        const [first, second] = statements;
        const captureAt = first === "focusRestore.capture();" ? first : second;
        expect(
          captureAt,
          `${fn}'s statements began with ${JSON.stringify(statements.slice(0, 2))}`
        ).toBe("focusRestore.capture();");
        if (first !== "focusRestore.capture();") {
          expect(first, `${fn}'s leading statement before capture`).toMatch(
            /^if \([^)]+\) return;$/
          );
        }
      }
    });

    it(`${name}: restores focus from a useLayoutEffect keyed on the overlay no longer owning the screen`, () => {
      const source = read(screen);
      expect(source).toMatch(/useLayoutEffect,/); // imported from "react"
      const restoreAt = source.indexOf("useLayoutEffect(() => {");
      expect(restoreAt).toBeGreaterThan(-1);
      const effectEnd = source.indexOf("}, [", restoreAt);
      const body = source.slice(restoreAt, effectEnd);
      expect(body).toMatch(
        new RegExp(
          `if \\(shareOverlayOwnsScreen\\(${hook}\\.progress\\)\\) return;`
        )
      );
      expect(body).toMatch(/focusRestore\.restore\(\{/);
      expect(body).toMatch(/suppressed: false,/);
      expect(body).toMatch(
        new RegExp(`fallback: ${controlRefName}\\.current,`)
      );
    });

    it(`${name}: declares the ${controlRefName} and hands it to the shared Share rows`, () => {
      // The ternary itself moved into `ShareMenuSection` (#160, L-15), so this
      // half is now "the screen owns the ref and passes it in" — the next case
      // is "the section attaches it to BOTH branches", once, for both screens.
      const source = read(screen);
      expect(
        source.indexOf(
          `const ${controlRefName} = useRef<HTMLButtonElement | null>(null);`
        )
      ).toBeGreaterThan(-1);
      expect(source).toContain(`controlRef={${controlRefName}}`);
    });
  }

  it("control.tsx forwards its ref to the underlying <button> (#491, focus-restore's fallback landmark)", () => {
    const source = read("src/components/control.tsx");
    expect(source).toMatch(/import \{ forwardRef \} from "react";/);
    expect(source).toMatch(
      /export const Control = forwardRef<HTMLButtonElement, ControlProps>\(/
    );
    // The real JSX open tag, not the `` `<button>` `` mention in this file's
    // own docblock a plain `indexOf("<button")` would match first — the JSX
    // tag is always followed by whitespace before its first attribute, the
    // prose mention never is.
    const buttonAt = source.search(/<button\s/);
    expect(buttonAt).toBeGreaterThan(-1);
    const buttonTagEnd = source.indexOf(">", buttonAt);
    expect(source.slice(buttonAt, buttonTagEnd)).toMatch(/ref=\{ref\}/);
  });

  /**
   * George r2 P2-2 (#491): `sendUnconfirmed` must actually be READ and fed to
   * `shareControlAffordance` and the idle label — the state this field exists
   * to carry is invisible unless both wire it through.
   *
   * Split in two since #160's L-15 moved the rows into `ShareMenuSection`: the
   * screens hand the flag and their own copy in, and the section does the
   * wiring. The section half is asserted ONCE for both menus, which is the
   * improvement — it was the same property checked separately in two files.
   */
  for (const [screen, hook, unconfirmedString, scopeValue, hasGapExpr] of [
    [
      "src/components/segments-screen.tsx",
      "share",
      "shareChapterUnconfirmed",
      "chapter",
      "share.missing > 0",
    ],
    [
      "src/components/books-screen.tsx",
      "bookShare",
      "shareBookUnconfirmed",
      "book",
      "bookShareHasGap",
    ],
  ] as const) {
    const name = screen.split("/").pop();

    it(`${name}: hands ${hook}.sendUnconfirmed and its own unconfirmed copy to the Share rows`, () => {
      const source = read(screen);
      // End-of-tag boundary (#720): a bare `indexOf("<ShareMenuSection")`
      // also matches a hypothetical `<ShareMenuSectionXX`, the same prefix
      // hole `share-outcome-glyph.test.ts` closed for its own copy of this
      // tag search during #670 — this file was the second site of the same
      // class, left behind when the first was fixed.
      const at = source.search(/<ShareMenuSection[\s/>]/);
      expect(at, "no <ShareMenuSection> in this screen").toBeGreaterThan(-1);
      const tag = source.slice(at, source.indexOf("/>", at));
      expect(tag).toContain(`sendUnconfirmed={${hook}.sendUnconfirmed}`);
      expect(tag).toContain(`unconfirmedLabel={strings.${unconfirmedString}}`);
      // The two props that actually differ between Books and Segments
      // (#720 item 2): nothing pinned either before, so a call site could
      // swap scope="book" for scope="chapter" — changing the share-error
      // copy a translator reads — and every assertion above would stay
      // green.
      expect(tag).toContain(`scope="${scopeValue}"`);
      expect(tag).toContain(`hasGap={${hasGapExpr}}`);
    });
  }

  it("share-menu-section.tsx: feeds sendUnconfirmed to shareControlAffordance as its third argument", () => {
    const source = read("src/components/share-menu-section.tsx");
    const at = source.indexOf("shareControlAffordance(");
    expect(at).toBeGreaterThan(-1);
    const call = source.slice(at, source.indexOf(");", at));
    expect(call).toMatch(/sendUnconfirmed/);
  });

  it("share-menu-section.tsx: the idle label switches on sendUnconfirmed, and that control is never disabled", () => {
    const source = read("src/components/share-menu-section.tsx");
    // Isolate the NOT-ready branch by its own handler, then walk back to its
    // opening tag — `lastIndexOf` from the handler, so the ready branch's
    // `<Control>` above it can never be the one measured. The window runs to
    // the tag's own closing `/>` (#720), not just up to the handler: ending
    // at `prepareAt` left anything placed AFTER `onClick={onPrepare}` — a
    // `disabled`, or a dropped `busy` moved past it — outside the span this
    // test claims to cover.
    const prepareAt = source.indexOf("onClick={onPrepare}");
    expect(prepareAt).toBeGreaterThan(-1);
    const controlStart = source.lastIndexOf("<Control", prepareAt);
    const controlEnd = source.indexOf("/>", prepareAt);
    // region() throws if the lastIndexOf walk-back found no preceding
    // <Control at all (#533's "unfloored lastIndexOf" finding), not just if
    // the forward search for the closing /> came up empty.
    const control = region(source, { from: controlStart, to: controlEnd });

    // The label is a three-way: preparing, then unconfirmed, then idle.
    expect(control).toMatch(/label=\{/);
    expect(control).toMatch(/preparingLabel/);
    expect(control).toMatch(/sendUnconfirmed/);
    expect(control).toMatch(/unconfirmedLabel/);
    expect(control).toMatch(/idleLabel/);

    // Not disabled — a second Share must remain genuinely possible (the
    // brief's own constraint), never gated behind `disabled`. `busy` is what
    // paints and reads the wait instead (#354), and it also keeps the control
    // inside Menu's FOCUSABLE set so the Tab trap holds (George R-B7).
    expect(control).not.toMatch(/\bdisabled\b/);
    expect(control).toMatch(/busy=\{affordance\.busy\}/);
  });

  /**
   * Frank at `9832a8b` P2: the ref-sync effect that feeds the capture-phase
   * keydown listener (`busyRef`/`onCancelRef`/`onDismissRef`) was a PASSIVE
   * `useEffect`, scheduled to run in a macrotask after the browser paints —
   * a keydown queued in that window could fire against stale refs, reading
   * the PREVIOUS phase's `busy`/`onCancel`/`onDismiss` values. Concretely: a
   * prepare failing renders the outcome in the same commit that would
   * otherwise flip `busyRef` to `false`; an Escape landing before the
   * passive effect runs would still call `onCancel` (`reset()`), clearing
   * the failure Notice the outcome exists to hold up. `useLayoutEffect`
   * closes it: it runs synchronously right after the DOM mutation, before
   * the browser paints or dispatches any queued event.
   */
  it("share-progress.tsx syncs busyRef/onCancelRef/onDismissRef in a LAYOUT effect, not a passive one (Frank 9832a8b P2)", () => {
    const modal = read("src/components/share-progress.tsx");
    // No bare `useEffect` any more, as of #517 item 4 (George r3 P3 on
    // #508): the focus grab and the Escape/Tab capture listener, this
    // component's other two effects, are also `useLayoutEffect` now — see
    // `tests/share-progress-overlay-layout-effects.test.ts`.
    expect(modal).toMatch(/import \{ useLayoutEffect, useRef \}/);
    const at = modal.indexOf("const busyRef = useRef(busy);");
    expect(at).toBeGreaterThan(-1);
    const effectAt = modal.indexOf("useLayoutEffect(() => {", at);
    expect(effectAt).toBeGreaterThan(at);
    const effectEnd = modal.indexOf("});", effectAt);
    const body = modal.slice(effectAt, effectEnd);
    expect(body).toMatch(/busyRef\.current = busy;/);
    expect(body).toMatch(/onCancelRef\.current = onCancel;/);
    expect(body).toMatch(/onDismissRef\.current = onDismiss;/);
    // Not the OTHER shape — a plain `useEffect` immediately after the refs.
    expect(modal).not.toMatch(
      /const onDismissRef = useRef\(onDismiss\);\s*useEffect\(\(\) => \{/
    );
  });

  it("the stylesheet inks busy and every settled outcome, with layer-2 roles only", () => {
    const css = read("src/app/styles/3-components.css");
    for (const key of ["busy", ...SHARE_SETTLED]) {
      const rule = new RegExp(
        `\\.share-scrim\\[data-outcome="${key}"\\][^{]*\\{[^}]*color:\\s*var\\(--s-`
      );
      expect(css, `no glyph ink for "${key}"`).toMatch(rule);
    }
    // No colour primitive anywhere in the block: every ink, fill and edge is a
    // layer-2 role, or a theme cannot switch it. Spacing and radius primitives
    // are the same ones `.confirm-panel` uses and are not the leak this guards.
    const start = css.indexOf(".share-scrim");
    const block = css.slice(start, css.indexOf("@layer components", start));
    const declarations = [
      ...block.matchAll(/(color|background|border(?:-color)?):\s*([^;]+);/g),
    ];
    expect(declarations.length).toBeGreaterThanOrEqual(8);
    for (const [, prop, value] of declarations)
      expect(value, `${prop} reaches past layer 2`).not.toMatch(/--p-/);
  });

  it("the platform is read from Capacitor, never the user-agent string", () => {
    for (const file of [
      "src/hooks/share-target.ts",
      "src/components/control-affordance.ts",
      "src/components/segments-screen.tsx",
      "src/components/books-screen.tsx",
      "src/components/failure-log-panel.tsx",
      "src/components/recorder.tsx",
    ]) {
      expect(read(file), `${file} reads the user agent`).not.toMatch(
        /userAgent/
      );
    }
    expect(read("src/hooks/share-target.ts")).toMatch(
      /Capacitor\.getPlatform\(\)/
    );
  });
});
