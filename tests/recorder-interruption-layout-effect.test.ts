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
 * time. What is decidable from the text is the spelling itself, which is the
 * whole of the fix. Observed red against `e03a7b4`'s `useEffect(` before the
 * change.
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

  it("opens with useLayoutEffect, so stop() snapshots the slices in-commit", () => {
    const guardIndex = source.indexOf(GUARD);
    expect(guardIndex).toBeGreaterThan(-1);

    // Walk back to the hook call that OPENS this effect body, rather than
    // searching forward from some anchor: the guard is the effect's first
    // statement, so the nearest preceding `use*Effect(` is its own.
    const before = source.slice(0, guardIndex);
    const opener = before.lastIndexOf("Effect(");
    expect(opener).toBeGreaterThan(-1);
    const hook = before.slice(before.lastIndexOf("use", opener), opener + 7);

    // The kill: `useEffect(` here is the pre-fix tree, and it is what lets a
    // `pagehide` between commit and paint cancel the mic before `stop()` has
    // taken the chunks.
    expect(hook).toBe("useLayoutEffect(");
    expect(hook).not.toBe("useEffect(");

    // And nothing may sit between the opener and the guard: an `await`, a
    // `setTimeout` or a `queueMicrotask` introduced there would put the
    // `stop()` back after paint while this file still read green.
    const body = source.slice(opener + "Effect(".length, guardIndex);
    expect(body).toMatch(/^\s*\(\)\s*=>\s*\{\s*if\s*\(\s*$/);
  });
});
