import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  panelRecoveryFocus,
  type PanelRecoveryAction,
} from "@/lib/a11y/panel-recovery";

/**
 * The recovery-path focus decision (#199).
 *
 * A truth table, not a phone, for the same reason `focus-restore.ts` is one:
 * the DOM half has no automated coverage in this repo (#361) and is not
 * claimed as tested. What is pinned here is WHEN focus must be handed back
 * into the sheet — which is the part #199 asked to be decided explicitly
 * rather than left an omission.
 */
describe("panelRecoveryFocus (#199)", () => {
  it("hands focus back when a full-body panel resolves successfully", () => {
    // The whole point: a "Try again" that SUCCEEDS unmounts LoadErrorPanel with
    // focus on its own autoFocused control. The sheet's focus grab is
    // mount-only, and the Segments list behind is inert, so focus lands on
    // <body> and the next Tab reaches the header Back.
    expect(
      panelRecoveryFocus({
        ownedLastCommit: true,
        ownsNow: false,
        closing: false,
      })
    ).toBe("focus");
  });

  it("idles while a panel still owns the body", () => {
    // Its own autoFocus is the correct landing; stealing that back would strand
    // a screen-reader user off the Retry they were just handed.
    expect(
      panelRecoveryFocus({
        ownedLastCommit: true,
        ownsNow: true,
        closing: false,
      })
    ).toBe("idle");
    expect(
      panelRecoveryFocus({
        ownedLastCommit: false,
        ownsNow: true,
        closing: false,
      })
    ).toBe("idle");
  });

  it("idles on a commit where no panel was ever up", () => {
    // The steady state — every ordinary render of a healthy sheet. Firing here
    // would yank focus off whatever the translator is actually using.
    expect(
      panelRecoveryFocus({
        ownedLastCommit: false,
        ownsNow: false,
        closing: false,
      })
    ).toBe("idle");
  });

  it("HOLDS when the panel cleared because the sheet is closing", () => {
    // `heldTake`'s two-tap discard clears the panel AND closes the recorder in
    // the same turn. Focusing inside a sheet that is unmounting is dead code at
    // best; at worst it fights the Segments screen's own hand-off. Same
    // `isClosing` guard the overlay restore in `recorder.tsx` already takes,
    // and the same reason.
    //
    // `hold`, not `idle`: that close can FAIL and leave the sheet mounted, and
    // the caller must not spend the pending recovery on this commit. That is
    // the QA-review P2 on #457 — see the sequence tests at the foot of this
    // file, which are what actually pin it.
    expect(
      panelRecoveryFocus({
        ownedLastCommit: true,
        ownsNow: false,
        closing: true,
      })
    ).toBe("hold");
  });

  it("is the panel-resolved edge, not any panel change", () => {
    // Exhaustive over the eight inputs, so a later "simplification" to
    // `ownedLastCommit !== ownsNow` (which would also fire on the panel
    // APPEARING, stealing its autoFocus) fails here.
    const rows = [false, true].flatMap((ownedLastCommit) =>
      [false, true].flatMap((ownsNow) =>
        [false, true].map((closing) => ({
          input: { ownedLastCommit, ownsNow, closing },
          out: panelRecoveryFocus({ ownedLastCommit, ownsNow, closing }),
        }))
      )
    );
    expect(rows.filter((r) => r.out === "focus").map((r) => r.input)).toEqual([
      { ownedLastCommit: true, ownsNow: false, closing: false },
    ]);
    // And every closing commit HOLDS rather than idling — the half that keeps
    // a pending recovery alive across a close that fails (#457 QA P2).
    expect(rows.filter((r) => r.out === "hold").length).toBe(4);
  });
});

/**
 * The consumed-history defect (QA review P2 on #457).
 *
 * The first version of this returned a boolean and the effect wrote its
 * previous-commit ref on EVERY commit. That spent the pending recovery on the
 * closing commit, and there is a real path where the sheet then stays open:
 * `leaveHeldTake()` clears `heldTake` and sets `isClosing = true`, then
 * `executeTail()` awaits — and a failed clear or Finished write calls
 * `stayOpen()`, which sets `isClosing = false` and leaves the recorder mounted.
 * By that commit `ownedLastCommit` was already false, so the removed panel's
 * control never got a focus hand-off and focus stayed on <body>.
 *
 * `recorder.tsx`'s own overlay-restore effect, a hundred lines above the one
 * this feeds, already carried the lesson in its comment — "HOLD the capture
 * through the commit window rather than spending it" — and the first version of
 * this module did not apply it. So the decision is now three-valued: `hold`
 * means do nothing AND remember nothing, which is what makes the recovery
 * survive a close that fails.
 *
 * Sequence-level, not a DOM reproduction: the caller path was read in
 * `recorder.tsx` and the transitions replayed here. The `.focus()` call itself
 * is still uncovered (#361).
 */
describe("panelRecoveryFocus holds through a close that may fail (#457 QA P2)", () => {
  /** Replay a run of commits the way the effect does, and report every focus. */
  function replay(commits: readonly { panel: boolean; closing: boolean }[]): {
    focused: number[];
    actions: PanelRecoveryAction[];
  } {
    let ownedLastCommit = false;
    const focused: number[] = [];
    const actions: PanelRecoveryAction[] = [];
    commits.forEach(({ panel, closing }, i) => {
      const action = panelRecoveryFocus({
        ownedLastCommit,
        ownsNow: panel,
        closing,
      });
      actions.push(action);
      if (action === "focus") focused.push(i);
      // `hold` is the whole point: the ref is NOT written, so the pending
      // recovery survives into the next commit.
      if (action !== "hold") ownedLastCommit = panel;
    });
    return { focused, actions };
  }

  it("lands focus when a held-take discard's close FAILS and the sheet stays open", () => {
    // The exact sequence the reviewer traced through `leaveHeldTake` →
    // `executeTail` → `stayOpen`.
    const { focused, actions } = replay([
      { panel: true, closing: false }, // recovery panel up
      { panel: false, closing: true }, // heldTake cleared, isClosing set
      { panel: false, closing: false }, // stayOpen(): the write failed, sheet lives
    ]);
    expect(actions).toEqual(["idle", "hold", "focus"]);
    expect(focused).toEqual([2]);
  });

  it("still lands focus on the ordinary retry-succeeds path", () => {
    // The #199 case must not regress: no closing commit at all.
    const { focused } = replay([
      { panel: true, closing: false },
      { panel: false, closing: false },
    ]);
    expect(focused).toEqual([1]);
  });

  it("focuses once, not twice, when a close fails after several closing commits", () => {
    // `executeTail` awaits, so `isClosing` can span more than one commit (the
    // elapsed-ms tick alone re-renders this sheet). Every one of them holds.
    const { focused } = replay([
      { panel: true, closing: false },
      { panel: false, closing: true },
      { panel: false, closing: true },
      { panel: false, closing: true },
      { panel: false, closing: false },
    ]);
    expect(focused).toEqual([4]);
  });

  it("does not focus when the panel goes up and straight into a close", () => {
    // No panel was ever resolved — it appeared and the sheet began closing. A
    // `hold` that later fired here would steal focus for a recovery that never
    // happened.
    const { focused } = replay([
      { panel: false, closing: false },
      { panel: true, closing: false },
      { panel: true, closing: true },
      { panel: true, closing: false },
    ]);
    expect(focused).toEqual([]);
  });

  it("never focuses on a commit where the sheet is closing", () => {
    // Focusing into a sheet that is unmounting is dead code at best, and at
    // worst fights the Segments screen's own hand-off.
    for (const ownedLastCommit of [false, true])
      for (const ownsNow of [false, true])
        expect(
          panelRecoveryFocus({ ownedLastCommit, ownsNow, closing: true })
        ).toBe("hold");
  });
});

/**
 * WHERE the recovery lands (George R1 P2 on #457).
 *
 * The decision above says WHEN; this pins the target. The first version of the
 * caller reused the open-edge landing — the sheet's first `button`, which is
 * header Back — for the recovery edge too. Back is `close()`, which SAVES, and
 * `use-focus-restore.ts`'s contract is explicit that a landmark "must never be
 * a destructive or exiting control": a keyboard/switch user whose "Try again"
 * had just succeeded would have had the very next Space/Enter/switch-activate
 * armed to leave — the #97 hazard, on exactly the users #199 exists for.
 *
 * Open and recovery are different edges: open is not mid-task, recovery is.
 * So the recovery lands on the ≡, resolved by accessible name through
 * `overlayFallbackLabel` — the same landmark the overlay restore in the same
 * file uses, for the same reason — and never by position.
 *
 * Source-shape, because no test mounts `recorder.tsx` itself — it wires the
 * full audio hook graph, which the jsdom hook-mount harness elsewhere in
 * this repo (`tests/use-audio-session-supersession.test.ts`, #735/#739)
 * does not stub — so the `.focus()` itself stays uncovered (#361).
 */
describe("the recovery landing is the ≡ landmark, never the sheet's first button (#457 George R1 P2)", () => {
  const recorder = readFileSync(
    path.resolve(import.meta.dirname, "..", "src/components/recorder.tsx"),
    "utf8"
  );

  it("hands a `focus` action to the menu landmark", () => {
    // The landing is resolved into a local first, so the null case can bail
    // out before the history write (George R3 P2-2, pinned below).
    expect(recorder).toMatch(
      /if \(action === "focus"\) \{\s*const landmark = menuLandmark\(\);/
    );
    expect(
      recorder,
      "the recovery edge still lands on header Back"
    ).not.toMatch(/if \(action === "focus"\)\s*\{?\s*focusSheet\(\);/);
  });

  it("resolves that landmark by accessible name, not by position", () => {
    const start = recorder.indexOf("const menuLandmark = useCallback(");
    expect(start, "no menuLandmark callback in recorder.tsx").toBeGreaterThan(
      -1
    );
    const body = recorder.slice(start, recorder.indexOf("}, []);", start));
    expect(body).toMatch(
      /overlayFallbackLabel\(labels, strings\.recorderMenuOpen\)/
    );
    expect(body).not.toMatch(/querySelector<HTMLElement>\("button"\)/);
  });

  it("keeps the open-edge landing as its own call, used on the open edge only", () => {
    // `focusSheet` still exists — the open edge is allowed to land on the
    // sheet's first control — but it is called from exactly one place now.
    expect(recorder.match(/focusSheet\(\);/g)?.length).toBe(1);
  });
});

/**
 * The OPEN edge, when a panel already owns the FIRST commit (George R3 P2-1
 * on #457).
 *
 * The mount effect's own comment said the permission panel "autofocuses its
 * own Retry when it later appears, which is after this has run". True for the
 * async mic path (Record is gated on `view`), false for `!audio.supported`:
 * `isRecordingSupported()` (`hooks/audio-io.ts`) is a synchronous first-render
 * fact, so on a WebView with no `MediaRecorder` the first paint IS
 * `PermissionPanel` with its `autoFocus` Retry. React's commit focuses Retry;
 * the passive mount effect then ran `focusSheet()` — the sheet's first
 * `button`, which is header Back — and the next Space/Enter/switch-activate
 * was armed to `close()`. The #97 hazard this same hunk keeps off the recovery
 * edge, applied on the open edge to the users the permission panel is for.
 *
 * The fix is on the mount effect only: it yields when a full-body panel owns
 * the first commit, read through a first-render `useRef` snapshot so the
 * effect stays mount-only. `panelOwnsFocus` is deliberately NOT a dependency —
 * that would re-run the effect when the panel resolves and land on Back, the
 * recovery bug round 1 closed. Source-shape, because no test mounts
 * `recorder.tsx` itself — it wires the full audio hook graph, which the
 * jsdom hook-mount harness elsewhere in this repo
 * (`tests/use-audio-session-supersession.test.ts`, #735/#739) does not stub
 * — so the `.focus()` itself stays uncovered (#361).
 */
describe("the open-edge landing yields to a panel that owns the first commit (#457 George R3 P2-1)", () => {
  const recorder = readFileSync(
    path.resolve(import.meta.dirname, "..", "src/components/recorder.tsx"),
    "utf8"
  );
  const end = recorder.indexOf("}, [focusSheet]);");
  const start = recorder.lastIndexOf("useEffect(() => {", end);
  const body = recorder.slice(start, end);

  it("is still mount-only: the deps are exactly [focusSheet], and only once", () => {
    expect(end, "no mount effect keyed on [focusSheet]").toBeGreaterThan(-1);
    expect(recorder.match(/\}, \[focusSheet\]\);/g)?.length).toBe(1);
    expect(body, "panelOwnsFocus must not be a dependency").not.toMatch(
      /\[focusSheet, panelOwnsFocus\]|\[panelOwnsFocus/
    );
  });

  it("returns BEFORE focusSheet() when a full-body panel owns the first commit", () => {
    const guard = body.indexOf("if (panelOwnsFocusAtMount.current) return;");
    const land = body.indexOf("focusSheet();");
    expect(
      guard,
      "no first-commit panel guard in the mount effect"
    ).toBeGreaterThan(-1);
    expect(land, "the mount effect no longer lands focus").toBeGreaterThan(-1);
    expect(guard, "the guard must precede the landing").toBeLessThan(land);
  });

  it("reads the first-commit value through a useRef snapshot, not a render-time write", () => {
    // `useRef(x)` takes its argument on the first render only — exactly the
    // "already true on that first commit" question — and is not a
    // `ref.current = x` write during render, which `react-hooks/refs` exists
    // to catch (#212).
    expect(recorder).toMatch(
      /const panelOwnsFocusAtMount = useRef\(panelOwnsFocus\);/
    );
    expect(recorder).not.toMatch(/panelOwnsFocusAtMount\.current = /);
  });
});

/**
 * A natively disabled ≡ is NOT a landmark (George R3 P2-2 on #457).
 *
 * `menuLandmark`'s comment promised `null` when the ≡ is not rendered AND a
 * no-op when it is `disabled`; the callback returned the disabled node anyway,
 * and `use-focus-restore.ts`'s `hasFallback` checks connectivity, not
 * `disabled` (its `focusable` predicate is for the trigger alone). A disabled
 * button cannot take focus, so both callers "succeeded" with focus on <body>,
 * and the next Tab reached header Back. The ≡ is natively disabled (no `hint`,
 * so `Control` sets the attribute) through `!view || isClosing || denied ||
 * heldTake !== null`.
 *
 * Two halves. The landmark itself returns `null` on the attribute — the same
 * `hasAttribute("disabled")` idiom `use-focus-restore.ts` uses for the
 * trigger, so `aria-disabled` rows (#135) are untouched. And the recovery
 * effect, handed a `focus` action with no landmark to land on, leaves its
 * previous-commit history UNWRITTEN — the `hold` lesson again — so a later
 * commit on which the ≡ has been enabled can still recover.
 */
describe("menuLandmark yields null for a natively disabled ≡ (#457 George R3 P2-2)", () => {
  const recorder = readFileSync(
    path.resolve(import.meta.dirname, "..", "src/components/recorder.tsx"),
    "utf8"
  );

  it("returns null when the ≡ carries the native disabled attribute", () => {
    const start = recorder.indexOf("const menuLandmark = useCallback(");
    expect(start).toBeGreaterThan(-1);
    const body = recorder.slice(start, recorder.indexOf("}, []);", start));
    expect(body).toMatch(/hasAttribute\("disabled"\)\) return null;/);
    // Native only — an `aria-disabled` control keeps its place (#135).
    expect(body).not.toMatch(/aria-disabled/);
  });

  it("a focus action with no landmark leaves the recovery history unwritten", () => {
    const s = recorder.indexOf("const action = panelRecoveryFocus({");
    const e = recorder.indexOf(
      "}, [panelOwnsFocus, isClosing, menuLandmark]);",
      s
    );
    expect(s).toBeGreaterThan(-1);
    expect(e).toBeGreaterThan(s);
    const effect = recorder.slice(s, e);
    const resolve = effect.indexOf("const landmark = menuLandmark();");
    const bail = effect.indexOf("if (landmark === null) return;");
    const land = effect.indexOf("landmark.focus();");
    const write = effect.indexOf("panelOwnedFocus.current = panelOwnsFocus;");
    expect(
      resolve,
      "the landmark is not resolved into a local"
    ).toBeGreaterThan(-1);
    expect(bail, "no null-landmark bail-out").toBeGreaterThan(resolve);
    expect(land, "no landing after the bail-out").toBeGreaterThan(bail);
    expect(write, "the history write must follow the bail-out").toBeGreaterThan(
      land
    );
    // The optional-chain form silently spent the recovery on a disabled ≡.
    expect(effect).not.toMatch(/menuLandmark\(\)\?\.focus\(\)/);
  });
});
