import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The #59 interruption commit runs in a LAYOUT effect, not a passive one
 * (George r1 pass B, P2, on PR #681).
 *
 * Option A's whole reason for auto-committing an interrupted take is that the
 * mic was taken mid-take — an incoming call, a Bluetooth swap — and the slices
 * already captured are the only copy. `onInterrupted` (`use-recorder.ts`) sets
 * `"processing"` and leaves them in `chunksRef`; `stop()` snapshots
 * `chunksRef.current` into a local **only when it is actually called**, which is
 * the property that lets a `pagehide` during the flush cancel the mic without
 * destroying a confirmed take. `cancel()` replaces that array and bumps the
 * generation.
 *
 * A PASSIVE effect flushes after paint. A `pagehide` delivered in that gap runs
 * `leave()` → `cancelRecording()` first, and the interrupted take is gone: the
 * late `stop()` reads the fresh empty array and reports an empty capture, or
 * React drops the stale effect and nothing commits at all. A layout effect runs
 * in the same commit as the `"processing"` render, so `stop()` has the slices
 * before the browser can deliver anything. The Stop TAP has no such window —
 * `commitTake` calls `stop()` synchronously inside the click — which is exactly
 * why the interruption path needed its own fix.
 *
 * A `pagehide` that arrives BEFORE the interruption handler is a different
 * thing and not a bug: that is the existing "backgrounding abandons an
 * unconfirmed take" contract, and this gate makes no claim about it.
 *
 * **A SOURCE gate, and this file says which.** The timing it protects is a
 * `pagehide` landing between commit and paint, and `act()` flushes layout and
 * passive effects together — so a jsdom test that "interrupted, then fired
 * pagehide" would pass against BOTH spellings and would be a comment costing CI
 * time. What is decidable from the text is the spelling, plus the property the
 * spelling only buys if the body keeps it: the commit has to be reached
 * SYNCHRONOUSLY. `useLayoutEffect(() => { ...; setTimeout(commit, 0); })` is
 * back in the same after-paint window with the hook name reading right (Frank
 * P2 on this commit), so the assertion pins the whole body, not its opener.
 *
 * Mutations that must go red, each observed: `useLayoutEffect(` ->
 * `useEffect(`; a statement inserted ahead of the guard; the commit deferred
 * behind a `setTimeout`. The body is matched exactly, so a legitimate rewrite
 * of this effect fails here on purpose — the replacement has to be re-argued
 * against the pagehide window above, not re-typed.
 */
describe("the #59 interruption commit is a layout effect (George r1 pass B P2)", () => {
  const source = readFileSync(
    new URL("../src/components/recorder.tsx", import.meta.url),
    "utf8"
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  /** The effect's own guard — unique in the file, and what identifies it. */
  const GUARD = 'state !== "processing" || closing.current';

  it("identifies exactly one interruption-commit effect", () => {
    // The locator has to be unique or the assertion below could read some other
    // hook's opener. If a second copy of this guard ever appears, that is a
    // second commit path and this file must be re-pointed rather than widened.
    expect(source.split(GUARD)).toHaveLength(2);
  });

  /**
   * Walk back to the hook call that OPENS this effect, rather than searching
   * forward from some anchor: the guard is the effect's first statement, so
   * the nearest preceding `use*Effect(` is its own.
   */
  const guardIndex = source.indexOf(GUARD);
  const before = source.slice(0, guardIndex);
  const openerIndex = before.lastIndexOf("Effect(");
  const hook = before.slice(before.lastIndexOf("use", openerIndex));

  const matchingBraceClose = (text: string, openIndex: number): number => {
    let depth = 0;
    for (let i = openIndex; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  };

  const braceOpen = source.indexOf("{", openerIndex);
  const braceClose = matchingBraceClose(source, braceOpen);
  const body = source.slice(braceOpen, braceClose + 1);

  it("opens with useLayoutEffect, so stop() snapshots the slices in-commit", () => {
    // The kill: `useEffect(` here is the pre-fix tree, and it is what lets a
    // `pagehide` between commit and paint cancel the mic before `stop()` has
    // taken the chunks.
    expect(hook.startsWith("useLayoutEffect(")).toBe(true);
    expect(hook.startsWith("useEffect(")).toBe(false);
  });

  it("reaches the commit synchronously — the whole body, not just the opener", () => {
    // A layout effect that defers is a passive effect wearing the right name,
    // so the hook name above is only half the claim. An `await`, a
    // `setTimeout`, a `queueMicrotask` or any statement at all beyond these two
    // puts the `stop()` back after paint; the exact match is what says so.
    expect(braceOpen).toBeGreaterThan(openerIndex);
    expect(braceClose).toBeGreaterThan(braceOpen);
    expect(body.replace(/\s+/g, " ").trim()).toBe(
      `{ if (${GUARD}) return; commitTake("stay"); }`
    );
  });
});
