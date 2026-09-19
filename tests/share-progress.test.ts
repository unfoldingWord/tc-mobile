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
  shareProgressWakeAt,
} from "@/hooks/share-progress";
import type { ShareOutcome } from "@/hooks/share-flow";

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
 * glue is browser boundary and is not covered (#197).
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
  const gap: ShareGap = { missing: 2, partial: 0 };

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
    });
    expect(held).toMatchObject({ phase: "busy", pending: { settled: "sent" } });
    expect(tick(held, T0 + 20 + MIN_BUSY_MS)).toEqual({
      phase: "outcome",
      settled: "sent",
      since: T0 + 20 + MIN_BUSY_MS,
      gap: { missing: 0, partial: 0 },
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

/** Source-shape reads, because there is no renderer here (#197). */
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
    it(`${screen.split("/").pop()} renders <ShareProgress> from ${hook}.progress, with both taps wired`, () => {
      const source = read(screen);
      expect(source).toMatch(
        new RegExp(`<ShareProgress[\\s\\S]*?progress=\\{${hook}\\.progress\\}`)
      );
      // A long book encode with no pointer cancel is the risk the plan names:
      // the modal scrim now covers the menu scrim, so the cancel must be
      // re-wired onto the modal.
      expect(source).toMatch(/onCancel=\{onClose(Share|Chapter)Menu\}/);
      expect(source).toMatch(
        new RegExp(`onDismiss=\\{${hook}\\.dismissProgress\\}`)
      );
    });
  }

  it("the modal takes its ARIA role from the tone table, never from the caller", () => {
    const modal = read("src/components/share-progress.tsx");
    expect(modal).toMatch(/noticePresentation\(/);
    expect(modal).not.toMatch(/role="dialog"/);
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
