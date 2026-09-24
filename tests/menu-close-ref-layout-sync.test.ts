import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { matchingBraceClose } from "./support";

/**
 * `Menu`'s `onCloseRef` sync runs in a LAYOUT effect, not a passive one
 * (#517 item 2, George r3 P3 on #508).
 *
 * #491 made this ref load-bearing for a share overlay's menu: while the
 * overlay owns the screen, the close handlers it points at
 * (`onCloseChapterMenu`/`onCloseShareMenu`) must see the LIVE
 * `shareOverlayOwnsScreen(progress)` and refuse to run, or Menu's own Escape
 * listener (which reads `onCloseRef.current()`) could close the menu
 * underneath a still-showing overlay. `share-progress.tsx` already carries
 * this exact fix for its own `busyRef`/`onCancelRef`/`onDismissRef`
 * (Frank at `9832a8b` P2, #491). React does not guarantee a passive effect
 * flushes before paint or before a queued event, so a keydown in that window
 * can fire against a ref that has not caught up with what just rendered.
 *
 * This is defense in depth, not an observed defect: `share-progress.tsx`'s
 * own capture-phase Escape listener is expected to swallow the keydown
 * before Menu's bubble-phase listener ever reads this ref, so the window this
 * closes is a second failure (that listener not yet bound, and a stale
 * `onCloseRef` at once), not a user-visible bug on its own.
 *
 * **A SOURCE gate, and this file says which** — same reason
 * `recorder-interruption-layout-effect.test.ts` is one: this component's
 * tests mount through `act()`, which flushes layout and passive effects
 * together (a sync `act()` render leaves no window in which a passive
 * effect has not yet run), so no jsdom mount here can tell `useLayoutEffect`
 * apart from `useEffect` by observed behaviour. What is decidable from the
 * text is the hook name and that the effect's body still does only the ref
 * assignment — a legitimate rewrite has to re-argue the change against the
 * race above, not slip past this file by keeping the wrong hook name out of
 * a differently-shaped statement.
 *
 * Mutation that must go red: `useLayoutEffect(` -> `useEffect(` on this
 * effect.
 */
describe("Menu's onCloseRef sync is a layout effect (#517 item 2)", () => {
  const source = readFileSync(
    new URL("../src/components/menu.tsx", import.meta.url),
    "utf8"
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  /** The effect's own body — unique in the file, and what identifies it. */
  const GUARD = "onCloseRef.current = onClose;";

  it("identifies exactly one onCloseRef sync effect", () => {
    expect(source.split(GUARD)).toHaveLength(2);
  });

  const guardIndex = source.indexOf(GUARD);
  const before = source.slice(0, guardIndex);
  const openerIndex = before.lastIndexOf("Effect(");
  const hook = before.slice(before.lastIndexOf("use", openerIndex));

  const braceOpen = source.indexOf("{", openerIndex);
  const braceClose = matchingBraceClose(source, braceOpen);
  const body = source.slice(braceOpen, braceClose + 1);

  it("opens with useLayoutEffect, so the ref is current before any queued keydown", () => {
    expect(hook.startsWith("useLayoutEffect(")).toBe(true);
    expect(hook.startsWith("useEffect(")).toBe(false);
  });

  it("does only the ref assignment — no deferred statement smuggles the passive window back in", () => {
    expect(braceOpen).toBeGreaterThan(openerIndex);
    expect(braceClose).toBeGreaterThan(braceOpen);
    expect(body.replace(/\s+/g, " ").trim()).toBe(`{ ${GUARD} }`);
  });
});
