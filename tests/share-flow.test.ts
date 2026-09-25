import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type Clock,
  chainsToSend,
  classifyShareError,
  createProgressDriver,
  resolveSendOutcome,
  sentGap,
} from "@/hooks/share-flow";
import {
  MIN_BUSY_MS,
  OUTCOME_HOLD_MS,
  type ShareProgress,
} from "@/hooks/share-progress";

/** Source-shape reads; these assertions do not mount the hook. */
const read = (rel: string) =>
  readFileSync(path.resolve(import.meta.dirname, "..", rel), "utf8");

/**
 * B7 Share (chapter + book) — the share-rejection classifier.
 *
 * These rows exercise the pure rejection classifier, not the hook's two-gesture
 * flow or the browser's share handoff. The classifier decides whether a
 * translator sees a failure, gets a retry, or the flow simply ends.
 *
 * A NotAllowedError without live activation keeps the encoded File armed for
 * a fresh tap, avoiding another encode when the gesture window has expired.
 */
describe("classifyShareError", () => {
  it("treats a dismissed sheet (AbortError) as dismissed, whatever the activation", () => {
    const abort = new DOMException("user cancelled", "AbortError");
    expect(classifyShareError(abort, false)).toBe("dismissed");
    expect(classifyShareError(abort, true)).toBe("dismissed");
  });

  it("treats NotAllowedError with NO live activation as retry, keeping the File", () => {
    // The tap's activation was spent; a fresh tap can still hand over the File.
    const notAllowed = new DOMException("permission denied", "NotAllowedError");
    expect(classifyShareError(notAllowed, false)).toBe("retry");
  });

  it("treats NotAllowedError WITH live activation as a real failure, not a loop", () => {
    // Activation was live and share still refused: a standing block (Permissions
    // Policy), so surface an error rather than a "Share now" that never works.
    const notAllowed = new DOMException("blocked by policy", "NotAllowedError");
    expect(classifyShareError(notAllowed, true)).toBe("failed");
  });

  it("treats any other DOMException as a real failure", () => {
    const other = new DOMException("boom", "DataError");
    expect(classifyShareError(other, false)).toBe("failed");
    expect(classifyShareError(other, true)).toBe("failed");
  });

  it("treats a plain Error as a real failure", () => {
    expect(classifyShareError(new Error("network"), false)).toBe("failed");
  });

  it("treats a non-error throw as a real failure", () => {
    expect(classifyShareError("nope", false)).toBe("failed");
    expect(classifyShareError(undefined, true)).toBe("failed");
  });
});

/**
 * `chainsToSend` (#860) — whether `prepare()` should chain straight into
 * `send()` once armed, rather than leaving the flow at `ready` for a second
 * tap. Testers on Android read the ready state's checkmark as "done" and
 * never made that second tap; the fix is to skip it entirely on the route
 * that does not need a live gesture to open the chooser.
 *
 * A pure, one-line decision — like `classifyShareError` and
 * `resolveSendOutcome` above — so the branch it drives in `prepare()` is
 * provable without mounting the hook: flip the comparison in
 * `chainsToSend`'s own body to `route === "web"` and every row below dies.
 */
describe("chainsToSend", () => {
  it("chains on the native route — the plugin needs no user activation", () => {
    expect(chainsToSend("native")).toBe(true);
  });

  it("does NOT chain on the web route — navigator.share needs the tap's own activation, which a continuation after the encode does not carry", () => {
    expect(chainsToSend("web")).toBe(false);
  });

  it("does NOT chain when the route is unsupported — prepare() never reaches this call on that route, but the function must not claim otherwise", () => {
    expect(chainsToSend("unsupported")).toBe(false);
  });
});

/**
 * `sentGap` (P1, this lane's own review round) — the pure decision that picks
 * `sent` vs `partial` at `send()`'s own settle, node-testable for the same
 * reason `classifyShareError` above is.
 *
 * The defect this closes: a chapter/book share that went out with segments or
 * chapters missing wore the SAME plain success tick a whole share gets — the
 * gap Notice on screen a moment earlier vanished with no trace once the sheet
 * closed, so a facilitator reading only the glyph collected an incomplete
 * chapter believing it whole. `share-progress.ts`'s header on `ShareSettled`
 * names the exact same collision this is #178's own fix shape recreates one
 * screen later, which is why this reuses the mark rather than adding a
 * fourth.
 */
describe("sentGap", () => {
  it("no gap when both counts are zero", () => {
    expect(
      sentGap({ missing: 0, partial: 0, partialChapters: 0 })
    ).toBeUndefined();
  });

  it("a gap from `missing` alone (a chapter's own left-out segments, or a book's whole missing chapters)", () => {
    expect(sentGap({ missing: 1, partial: 0, partialChapters: 0 })).toEqual({
      missing: 1,
      partial: 0,
      partialChapters: 0,
    });
  });

  it("a gap from `partial` alone (segments missing inside a book chapter that DID ship)", () => {
    expect(sentGap({ missing: 0, partial: 2, partialChapters: 1 })).toEqual({
      missing: 0,
      partial: 2,
      partialChapters: 1,
    });
  });

  it("a gap from both at once — a book can carry both", () => {
    expect(sentGap({ missing: 1, partial: 2, partialChapters: 2 })).toEqual({
      missing: 1,
      partial: 2,
      partialChapters: 2,
    });
  });

  it("carries the distinct-chapter count through unchanged, so the outcome copy can name it (#446)", () => {
    // Same `missing`/`partial` pair, different `partialChapters`: the gap the
    // modal shows must keep them apart, or its copy falls back to guessing.
    expect(
      sentGap({ missing: 1, partial: 2, partialChapters: 1 })?.partialChapters
    ).toBe(1);
    expect(
      sentGap({ missing: 1, partial: 2, partialChapters: 2 })?.partialChapters
    ).toBe(2);
  });
});

/**
 * `resolveSendOutcome` (Frank a446708 P2, #491) — what a RESOLVED send
 * settles to once `resolveProvesDelivery` says whether this route/platform
 * can vouch for it. Before this fix every resolve settled `sent`/`partial`
 * unconditionally, which on native Android can be the plugin's documented
 * false-success path (a chooser dismissed with Back after the activity
 * merely stopped) — the new outcome UI (#491) then drew an affirmative tick
 * for it, worse than the silence #336 originally reported.
 */
describe("resolveSendOutcome", () => {
  it("a proven send with no gap settles sent", () => {
    expect(resolveSendOutcome(true, undefined)).toBe("sent");
  });

  it("a proven send with a gap settles partial", () => {
    expect(
      resolveSendOutcome(true, { missing: 1, partial: 0, partialChapters: 0 })
    ).toBe("partial");
  });

  it("an UNPROVEN send settles unproven regardless of any gap — delivery itself is what's in question", () => {
    expect(resolveSendOutcome(false, undefined)).toBe("unproven");
    expect(
      resolveSendOutcome(false, { missing: 2, partial: 1, partialChapters: 1 })
    ).toBe("unproven");
  });
});

/**
 * The wiring pins the state machine alone cannot prove: that `send()` reads
 * ITS gap off the ARMED value (not off `missing`/`partial` state, which the
 * same transition already zeroes), that a scrim tap cannot discard an
 * irreversibly in-flight send (P2), and that the guard-hole branch settles
 * the modal like every other outcome (P3) — all three from this lane's own
 * review round. `tests/share-progress.test.ts` already pins the busy/outcome
 * machine and the iOS activation-window shape; this file adds only what
 * changed here.
 */
describe("the wiring around sentGap and the reset guard (this lane's own review round)", () => {
  it("an abort during stage arms nothing — the stale run discards and returns before handoff.arm (#365 residual)", () => {
    const flow = read("src/hooks/share-flow.ts");
    const stageAt = flow.indexOf(
      'const staged =\n          route === "native"'
    );
    expect(stageAt).toBeGreaterThan(-1);
    const staleAt = flow.indexOf("if (!current()) {", stageAt);
    const armAt = flow.indexOf("handoff.arm({", stageAt);
    expect(staleAt).toBeGreaterThan(stageAt);
    expect(armAt).toBeGreaterThan(staleAt);
    const staleBlock = flow.slice(stageAt, armAt);
    expect(staleBlock).toMatch(
      /if \(staged !== null\) void nativeShare\.discard\(staged\);\s*return null;/
    );
  });

  const flow = read("src/hooks/share-flow.ts");

  it("prepare() arms the gap counts alongside the File, not just in useState", () => {
    expect(flow).toMatch(
      /handoff\.arm\(\{\s*file,\s*staged,\s*missing:\s*prepared\.missing,\s*partial:\s*prepared\.partial \?\? 0,\s*partialChapters:\s*prepared\.partialChapters \?\? 0,?\s*\}\)/
    );
  });

  it("send() decides sent vs partial vs unproven through resolveSendOutcome(proven, gap), never a hand-rolled comparison at the call site (Frank a446708 P2)", () => {
    const from = flow.indexOf('modal.dispatch({ type: "begin", work: "send"');
    const settleSite = flow.indexOf("const gap = sentGap(armed);", from);
    expect(settleSite).toBeGreaterThan(from);
    expect(flow).toMatch(/const settled = resolveSendOutcome\(proven, gap\);/);
  });

  it("the settle site reads proven from resolveProvesDelivery against the route this send actually took and the CURRENT platform, before deciding settled", () => {
    const settleSiteAt = flow.indexOf("const gap = sentGap(armed);");
    const provenAt = flow.indexOf(
      "const proven = resolveProvesDelivery(",
      settleSiteAt
    );
    const settledAt = flow.indexOf(
      "const settled = resolveSendOutcome(",
      settleSiteAt
    );
    expect(provenAt).toBeGreaterThan(settleSiteAt);
    expect(settledAt).toBeGreaterThan(provenAt);
    expect(flow).toMatch(
      /resolveProvesDelivery\(\s*armed\.staged !== null \? "native" : "web",\s*readSharePlatform\(\)\s*\)/
    );
  });

  it("send()'s return value is `unproven` on its own, not folded into `sent` — so the screens' close-on-sent/dismissed does not fire on a resolve the platform cannot vouch for", () => {
    expect(flow).toMatch(
      /return settled === "unproven" \? "unproven" : "sent";/
    );
  });

  it("reset() refuses to run while a send is irreversibly in flight (P2)", () => {
    // The scrim's onCancel and the menu's Close/Escape all funnel through
    // reset(); without this guard, any of them can bump the run token under
    // a send that has already asked the OS for a chooser, turning a genuine
    // success into a dropped "superseded" outcome — reproducing #336/#491
    // inside the very modal built to fix it.
    const resetFn = flow.slice(
      flow.indexOf("const reset = useCallback"),
      flow.indexOf("}, [handoff, modal]);", flow.indexOf("const reset ="))
    );
    expect(resetFn).toMatch(/if \(handoff\.sending\) return;/);
    // The guard must be the FIRST statement in the body — before the token
    // bump it exists to prevent.
    const guardAt = resetFn.indexOf("if (handoff.sending) return;");
    const bumpAt = resetFn.indexOf("runIdRef.current += 1;");
    expect(guardAt).toBeGreaterThan(-1);
    expect(bumpAt).toBeGreaterThan(guardAt);
  });

  it("the guard-hole branch (armed === null) settles the modal like every other outcome (P3)", () => {
    const holeAt = flow.indexOf("if (armed === null) {");
    const holeEnd = flow.indexOf('return "failed";', holeAt);
    const hole = flow.slice(holeAt, holeEnd);
    expect(hole).toMatch(/type: "begin",\s*work: "send"/);
    expect(hole).toMatch(/type: "settle",\s*settled: "failed"/);
  });
});

/**
 * The native one-tap chain (#860): `prepare()` calls `send()` itself once
 * armed, on the native route only, rather than leaving the flow at `ready`
 * for a second tap. These are source-shape pins on the exact call site —
 * `chainsToSend`'s own describe block above pins the decision it reads; this
 * pins that `prepare()` actually consults it, in the right spot (AFTER the
 * ready transition, so the modal and `status` are already what every other
 * `ready` settle leaves them, and the chain is additive rather than a
 * parallel path) and returns what it resolves to, rather than firing it and
 * discarding the result (which would leave a caller unable to close its menu
 * on a chained `sent`/`dismissed` the way it already does for the web
 * route's own second tap).
 */
describe("the native one-tap chain in prepare() (#860)", () => {
  const flow = read("src/hooks/share-flow.ts");

  it('prepare() checks chainsToSend(route) — not a hand-rolled route === "native" — right after the ready settle, and awaits send()', () => {
    const readySettleAt = flow.indexOf(
      "// Ready is not an outcome: the busy phase ends"
    );
    expect(readySettleAt).toBeGreaterThan(-1);
    const chainAt = flow.indexOf("if (chainsToSend(route))", readySettleAt);
    expect(chainAt).toBeGreaterThan(readySettleAt);
    expect(flow.slice(chainAt, chainAt + 80)).toMatch(
      /if \(chainsToSend\(route\)\) return await send\(\);/
    );
  });

  it("the non-chained fallback right after it is a plain `return null;` — never a bare `return;`, which would type as `undefined`", () => {
    const chainAt = flow.indexOf(
      "if (chainsToSend(route)) return await send();"
    );
    expect(chainAt).toBeGreaterThan(-1);
    const after = flow.slice(chainAt, chainAt + 120);
    expect(after).toMatch(/return null;/);
  });

  it("prepare()'s declared return type is ShareOutcome | null, not void — the chained outcome must reach the caller", () => {
    expect(flow).toMatch(
      /async \(build: BuildShareFile\): Promise<ShareOutcome \| null> => \{/
    );
  });

  it("prepare()'s useCallback depends on send — the value it calls from inside the native branch", () => {
    const prepareAt = flow.indexOf("const prepare = useCallback(");
    expect(prepareAt).toBeGreaterThan(-1);
    const depsAt = flow.indexOf("[handoff, modal, send]", prepareAt);
    expect(depsAt).toBeGreaterThan(prepareAt);
  });

  it("every OTHER exit from prepare()'s try/catch also returns null, not a bare return — the function has exactly one non-null return, the chained one", () => {
    const prepareAt = flow.indexOf("const prepare = useCallback(");
    const prepareEnd = flow.indexOf("[handoff, modal, send]", prepareAt);
    const body = flow.slice(prepareAt, prepareEnd);
    // Every bare `return;` inside prepare() was replaced — none should remain.
    expect(body).not.toMatch(/\breturn;/);
  });
});

/**
 * `sendUnconfirmed` (George r2 P2-2, #491): before this, an `unproven` send's
 * success branch returned `status` to `idle` and cleared `missing`/`partial`
 * exactly like a confirmed one, and once the outcome glyph's own hold
 * ({@link OUTCOME_HOLD_MS} in `share-progress.ts`) ended, an idle Share
 * control read exactly like a fresh, never-tried one — risking a genuine
 * duplicate send if a translator, unable to tell the two states apart,
 * tapped Share again.
 *
 * These source assertions pin the flag's wiring, not the rendered control
 * or the browser's handoff.
 */
describe("sendUnconfirmed (George r2 P2-2, #491)", () => {
  const flow = read("src/hooks/share-flow.ts");

  it("UseShareFlow exposes sendUnconfirmed", () => {
    expect(flow).toMatch(/readonly sendUnconfirmed: boolean;/);
  });

  it("send()'s success branch sets it true ONLY on an unproven settle, right beside where `settled` is decided", () => {
    const settledAt = flow.indexOf("const settled = resolveSendOutcome(");
    expect(settledAt).toBeGreaterThan(-1);
    const setAt = flow.indexOf(
      'if (settled === "unproven") setSendUnconfirmed(true);',
      settledAt
    );
    const dispatchAt = flow.indexOf("modal.dispatch({", settledAt);
    expect(setAt).toBeGreaterThan(settledAt);
    // Set BEFORE the modal dispatch — not that ordering matters for
    // correctness (both are synchronous state writes in the same tick), but
    // it documents that this is decided alongside `settled`, not bolted on
    // after the fact.
    expect(setAt).toBeLessThan(dispatchAt);
  });

  it("prepare() clears it at the start of a fresh attempt — a new attempt is itself the acknowledgment", () => {
    const prepareAt = flow.indexOf("const prepare = useCallback(");
    expect(prepareAt).toBeGreaterThan(-1);
    const statusAt = flow.indexOf('setStatus("preparing");', prepareAt);
    expect(statusAt).toBeGreaterThan(prepareAt);
    const clearAt = flow.lastIndexOf("setSendUnconfirmed(false);", statusAt);
    expect(clearAt).toBeGreaterThan(prepareAt);
    expect(clearAt).toBeLessThan(statusAt);
  });

  it("reset() also clears it — useBookShare shares ONE hook instance across every row's ≡ menu, so a flag that survived reset() would leak an unconfirmed send from one book onto another book's freshly opened, never-tried Share control", () => {
    const resetAt = flow.indexOf("const reset = useCallback(() => {");
    expect(resetAt).toBeGreaterThan(-1);
    const resetEnd = flow.indexOf("}, [handoff, modal]);", resetAt);
    const resetBody = flow.slice(resetAt, resetEnd);
    expect(resetBody).toMatch(/setSendUnconfirmed\(false\);/);
  });

  it("the returned object carries sendUnconfirmed through", () => {
    // Anchored on `status,` — the return object's own first field — rather
    // than a bare `return {`, which also matches `createProgressDriver`'s
    // unrelated return further down this file.
    const returnAt = flow.indexOf("return {\n    status,");
    expect(returnAt).toBeGreaterThan(-1);
    const returnEnd = flow.indexOf("};", returnAt);
    expect(flow.slice(returnAt, returnEnd)).toMatch(/sendUnconfirmed,/);
  });
});

/**
 * `createProgressDriver` must schedule another wake when a tick leaves a
 * timed state unchanged. Otherwise a backward clock step can strand a busy
 * or outcome modal after its timer fires before the state's deadline.
 *
 * These rows inject a clock that steps backward and drive fake timers
 * separately. They exercise the driver's rescheduling directly, without
 * relying on the production clock's monotonicity or mounting the share hook.
 */
describe("createProgressDriver — the clock-monotonicity fix (Frank e915d05 P2)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** A `Clock` this suite can step by hand — including backward. */
  function fakeClock(start: number): Clock & { set: (t: number) => void } {
    let now = start;
    return {
      now: () => now,
      set: (t: number) => {
        now = t;
      },
    };
  }

  it("a clock that steps backward between schedule and fire still clears the busy hold", async () => {
    const clock = fakeClock(0);
    const states: ShareProgress[] = [];
    const driver = createProgressDriver((next) => states.push(next), clock);

    // `prepare`'s own `begin` — busy, nothing pending, nothing to wake for yet.
    driver.dispatch({ type: "begin", work: "prepare", now: clock.now() });

    // A settle lands well before MIN_BUSY_MS (600) has elapsed, so it is HELD:
    // the driver schedules a wake for `since (0) + MIN_BUSY_MS`, 500ms out from
    // `now` (100).
    clock.set(100);
    driver.dispatch({ type: "settle", settled: "sent", now: clock.now() });
    expect(states.at(-1)?.phase).toBe("busy");

    // The clock steps BACKWARD before that wake fires.
    clock.set(50);
    await vi.advanceTimersByTimeAsync(500);

    // The reducer correctly left the busy+pending phase in place (50 - 0 =
    // 50 < 600) — but with the belt removed, nothing replaces the wake that
    // timer just fired and nulled, and the modal is stuck here permanently.
    expect(states.at(-1)?.phase).toBe("busy");

    // The clock recovers, past the ORIGINAL deadline (since 0 + 600 = 600).
    // The belt rescheduled the wake for `600 - 50 = 550`ms out from the
    // backward-stepped fire above, so a further 550ms — with the clock now
    // past the deadline — is what proves the belt: nothing beyond it is
    // required to clear the hold.
    clock.set(650);
    await vi.advanceTimersByTimeAsync(550);

    const last = states.at(-1);
    expect(last?.phase).toBe("outcome");
    if (last?.phase === "outcome") expect(last.settled).toBe("sent");
  });

  it("a clock that steps backward between schedule and fire still clears the outcome hold", async () => {
    const clock = fakeClock(0);
    const states: ShareProgress[] = [];
    const driver = createProgressDriver((next) => states.push(next), clock);

    driver.dispatch({ type: "begin", work: "send", now: clock.now() });
    // The hold has already elapsed by the time this settle lands, so it
    // releases AT ONCE into the outcome phase, `since` = 700 — and the driver
    // schedules a wake for `since (700) + OUTCOME_HOLD_MS (1800)` = 2500,
    // 1800ms out from `now` (700).
    clock.set(700);
    driver.dispatch({ type: "settle", settled: "dismissed", now: clock.now() });
    expect(states.at(-1)?.phase).toBe("outcome");
    const hidden = driver.hidden();

    // The clock steps BACKWARD before that wake fires.
    clock.set(650);
    await vi.advanceTimersByTimeAsync(1800);

    // The reducer correctly left the outcome phase in place
    // (650 - 700 = -50 < OUTCOME_HOLD_MS) — with the belt removed, the
    // modal is now stuck here, and `hidden` above would never resolve.
    expect(states.at(-1)?.phase).toBe("outcome");

    // The clock recovers, past the ORIGINAL deadline (2500). The belt
    // rescheduled the wake for `2500 - 650 = 1850`ms out from the
    // backward-stepped fire above.
    clock.set(2600);
    await vi.advanceTimersByTimeAsync(1850);

    expect(states.at(-1)?.phase).toBe("hidden");
    await hidden; // resolves only because the phase above actually cleared.
  });

  it("MIN_BUSY_MS and OUTCOME_HOLD_MS are the holds these cases exercise", () => {
    // Pins the constants the arithmetic above is written against, so a
    // change to either constant is a visible diff here rather than a silent
    // mismatch between this file's comments and `share-progress.ts`.
    expect(MIN_BUSY_MS).toBe(600);
    expect(OUTCOME_HOLD_MS).toBe(1800);
  });

  /**
   * `driver.state()` — the live read `UseShareFlow.ownsScreen` is built on
   * (#452 PR3, #374).
   *
   * The book ≡ menu's `Layer.busy()` is called from a `popstate`, with no
   * render between the flow's own transition and the read, so it may not go
   * through the `useState` mirror the hook keeps for rendering (invariant 4,
   * `lib/nav/layer-stack.ts`). `onChange` here stands in for that mirror: the
   * assertions below are that `state()` has ALREADY moved at the moment
   * `onChange` is being told to, and that it keeps moving for a transition the
   * subscriber is never told about at all.
   */
  it("reports the next state SYNCHRONOUSLY — already moved by the time the render mirror is notified", () => {
    const clock = fakeClock(0);
    // Read from INSIDE `onChange`: in the hook this callback is `setProgress`,
    // i.e. the earliest possible moment a render could learn anything. If
    // `state()` were assigned after the notification — or were a second copy
    // kept in step by a render — this would still read "hidden".
    const seenFromSubscriber: string[] = [];
    let driverRef: { state: () => ShareProgress } | null = null;
    const driver = createProgressDriver(() => {
      seenFromSubscriber.push(driverRef?.state().phase ?? "unset");
    }, clock);
    driverRef = driver;

    expect(driver.state().phase).toBe("hidden");
    driver.dispatch({ type: "begin", work: "prepare", now: clock.now() });
    expect(driver.state().phase).toBe("busy");
    expect(seenFromSubscriber).toEqual(["busy"]);

    clock.set(700); // past MIN_BUSY_MS, so the settle releases at once
    driver.dispatch({ type: "settle", settled: "sent", now: clock.now() });
    expect(driver.state().phase).toBe("outcome");
    expect(seenFromSubscriber).toEqual(["busy", "outcome"]);
  });

  it("keeps reporting the live state for a dispatch the subscriber is never told about", () => {
    const clock = fakeClock(0);
    let notifications = 0;
    const driver = createProgressDriver(() => {
      notifications += 1;
    }, clock);

    // `dismiss` from `hidden` changes nothing, so `onChange` never fires — the
    // render mirror learns nothing and cannot be the source of this answer.
    driver.dispatch({ type: "dismiss" });
    expect(notifications).toBe(0);
    expect(driver.state().phase).toBe("hidden");

    driver.dispatch({ type: "begin", work: "send", now: clock.now() });
    expect(notifications).toBe(1);
    // A second `begin` while already busy is ignored by the machine
    // (`share-progress.ts`), so again no notification — and `state()` must
    // still report the FIRST begin's phase rather than drifting.
    driver.dispatch({ type: "begin", work: "send", now: clock.now() });
    expect(notifications).toBe(1);
    const live = driver.state();
    expect(live.phase).toBe("busy");
    if (live.phase === "busy") expect(live.work).toBe("send");
  });
});
