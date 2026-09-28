import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { matchingBraceClose } from "./support";

/**
 * `ShareProgress`'s focus grab and its Escape/Tab capture listener are LAYOUT
 * effects, not passive ones (#517 item 4, George r3 P3 on #508).
 *
 * `<Menu inert={shareOverlayOwnsScreen(progress)}>` blurs whatever was
 * focused in the menu's about-to-go-inert subtree to `document.body` during
 * React's MUTATION phase, in the SAME commit this overlay becomes visible
 * (`menu.tsx`'s own docblock on `inert`). React does not guarantee a passive
 * `useEffect` runs before paint, so between that mutation and the effect
 * there can be a frame where focus sits on `body` — inert, with the overlay's own focus grab not
 * yet run and its capture-phase Escape/Tab listener not yet bound. Layout
 * effects close both halves of that window in the same commit `inert` itself
 * applies in, matching the fix this component's own `busyRef` sync already
 * carries for the identical race (Frank at `9832a8b` P2, #491).
 *
 * This is defense in depth, not an observed defect: nothing in this repo has
 * measured a real Tab or Escape landing inside that one frame on a device.
 *
 * **A SOURCE gate, and this file says which** — the same reason
 * `recorder-interruption-layout-effect.test.ts` and
 * `tests/menu-close-ref-layout-sync.test.ts` are: a jsdom mount through
 * `act()` flushes layout and passive effects together (a sync `act()` render
 * leaves no window in which a passive effect has not yet run), so no mounted
 * test here can tell `useLayoutEffect` apart from
 * `useEffect` by observed behaviour. What is decidable from the text is the
 * hook name and, for the keydown listener, that its whole body still does
 * only what it did before — a legitimate rewrite has to re-argue the change
 * against the race above, not slip past this file inside a differently-shaped
 * statement.
 *
 * Mutations that must go red: `useLayoutEffect(` -> `useEffect(` on either
 * effect.
 */
describe("ShareProgress's overlay focus/keyboard effects are layout effects (#517 item 4)", () => {
  const source = readFileSync(
    new URL("../src/components/share-progress.tsx", import.meta.url),
    "utf8"
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  function locate(guard: string) {
    const guardIndex = source.indexOf(guard);
    expect(
      guardIndex,
      `"${guard}" not found in share-progress.tsx`
    ).toBeGreaterThan(-1);
    const before = source.slice(0, guardIndex);
    const openerIndex = before.lastIndexOf("Effect(");
    const hook = before.slice(before.lastIndexOf("use", openerIndex));
    const braceOpen = source.indexOf("{", openerIndex);
    const braceClose = matchingBraceClose(source, braceOpen);
    const body = source.slice(braceOpen, braceClose + 1);
    return { hook, body, braceOpen, braceClose, openerIndex };
  }

  describe("the focus grab", () => {
    const GUARD = "panelRef.current?.focus();";

    it("identifies exactly one focus-grab statement", () => {
      expect(source.split(GUARD)).toHaveLength(2);
    });

    const { hook, body, braceOpen, braceClose, openerIndex } = locate(GUARD);

    it("opens with useLayoutEffect, so focus never idles on body for a frame", () => {
      expect(hook.startsWith("useLayoutEffect(")).toBe(true);
      expect(hook.startsWith("useEffect(")).toBe(false);
    });

    it("does only the guarded focus call — no deferred statement reopens the window", () => {
      expect(braceOpen).toBeGreaterThan(openerIndex);
      expect(braceClose).toBeGreaterThan(braceOpen);
      expect(body.replace(/\s+/g, " ").trim()).toBe(
        `{ if (visible) ${GUARD} }`
      );
    });
  });

  describe("the Escape/Tab capture listener", () => {
    const GUARD = 'window.addEventListener("keydown", onKeyDown, true);';

    it("identifies exactly one keydown-listener bind", () => {
      expect(source.split(GUARD)).toHaveLength(2);
    });

    const { hook, body, braceOpen, braceClose, openerIndex } = locate(GUARD);

    it("opens with useLayoutEffect, so the capture listener is bound before any queued key event", () => {
      expect(hook.startsWith("useLayoutEffect(")).toBe(true);
      expect(hook.startsWith("useEffect(")).toBe(false);
    });

    it("keeps its whole body — the guard, the handler, the bind and its cleanup", () => {
      expect(braceOpen).toBeGreaterThan(openerIndex);
      expect(braceClose).toBeGreaterThan(braceOpen);
      expect(body.replace(/\s+/g, " ").trim()).toBe(
        "{ if (!visible) return; const onKeyDown = (e: KeyboardEvent) => { " +
          'if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); ' +
          "if (busyRef.current) onCancelRef.current(); else onDismissRef.current(); " +
          'return; } if (e.key === "Tab") { e.preventDefault(); e.stopPropagation(); } }; ' +
          `${GUARD} return () => window.removeEventListener("keydown", onKeyDown, true); }`
      );
    });
  });
});
