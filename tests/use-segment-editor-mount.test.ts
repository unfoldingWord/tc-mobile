// @vitest-environment jsdom
import {
  act,
  createElement,
  createRef,
  forwardRef,
  useImperativeHandle,
  useState,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SegmentEditor } from "@/hooks/use-segment-editor";
import { useSegmentEditor } from "@/hooks/use-segment-editor";

/**
 * Mounts the real `useSegmentEditor` (`src/hooks/use-segment-editor.ts`) in
 * the jsdom hook-mount shape `tests/use-audio-session-supersession.test.ts`
 * uses (wrapper component, `createRoot`, `act`), beside the two source-shape
 * tests (`tests/use-segment-editor-cut-shape.test.ts`,
 * `tests/use-segment-editor-undo-redo-shape.test.ts`) that read the hook as
 * text.
 *
 * It drives `cut`, `paste`, `undo` and `redo`
 * directly, asserting only what the hook's own docblocks and the two shape
 * tests already claim: the op each undo/redo step passed over (the
 * `SegmentEditor` interface docblocks on `undo`/`redo`), the range `cut`
 * stores and returns after routing it through `wholeSampleRange` (the
 * cut-shape test, #512 George R1 P3), and the clear-selection behaviour named
 * both on `cut`'s interface docblock ("then drop the frame") and in the
 * inline comment above its `spansWholeSample` guard ("Refusing here is not a
 * no-op: it leaves the selection open to be resized"). It does not invent
 * anything beyond that — no claim about `error`/OOM handling, which no
 * docblock or shape test names.
 */

interface HarnessProps {
  readonly original: Int16Array | null;
}

interface HarnessHandle extends SegmentEditor {
  /** The clipboard's current contents, exposed so the test can assert what
   *  `cut`'s `clipboard.set(removed)` call actually wrote. */
  readonly clip: Int16Array | null;
}

// Mirrors `recorder.tsx`'s own wiring (`useSegmentEditor(view?.samples ?? null,
// { clip: clipboard, set: onClipboardChange })`): the clipboard is owned one
// level up (`App.tsx`'s `useState`) and handed down as a fresh object literal
// each render, not a stabilised one. The harness reproduces that shape rather
// than a hand-stabilised test double, since useSegmentEditor's dependency
// arrays close over this object on every render in production too.
const Harness = forwardRef<HarnessHandle, HarnessProps>(function Harness(
  { original },
  ref
) {
  const [clip, setClip] = useState<Int16Array | null>(null);
  const editor = useSegmentEditor(original, { clip, set: setClip });
  const handle: HarnessHandle = { ...editor, clip };
  useImperativeHandle(ref, () => handle);
  return null;
});

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function original10(): Int16Array {
  return Int16Array.from([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
}

async function mount(
  original: Int16Array | null
): Promise<() => HarnessHandle> {
  const ref = createRef<HarnessHandle>();
  await act(async () => {
    root.render(createElement(Harness, { ref, original }));
  });
  return () => {
    if (!ref.current) {
      throw new Error("Harness did not mount useSegmentEditor");
    }
    return ref.current;
  };
}

describe("useSegmentEditor mounted: cut -> paste -> undo -> undo -> redo -> redo (#361)", () => {
  it("drives the full round trip and pins the op each undo/redo step passes over", async () => {
    const source = original10();
    const api = await mount(source);

    expect(api().working).toEqual(source);
    expect(api().hasEdits).toBe(false);
    expect(api().canUndo).toBe(false);
    expect(api().canRedo).toBe(false);

    // A FRACTIONAL selection, so the cut-shape test's claim — that `cut()`
    // routes the selection through `wholeSampleRange` before storing or
    // returning it, not merely `clampRange` — is behaviourally observable:
    // clampRange alone would leave {2.2, 6.7} on the stored op and the
    // returned range; wholeSampleRange truncates both to {2, 6}.
    await act(async () => {
      api().openSelection({ start: 2.2, end: 6.7 });
    });
    expect(api().selectionActive).toBe(true);
    expect(api().selection).toEqual({ start: 2.2, end: 6.7 });

    let cutRange: { start: number; end: number } | null = null;
    await act(async () => {
      cutRange = api().cut();
    });
    // The whole-sample range, truncated — not the fractional selection.
    expect(cutRange).toEqual({ start: 2, end: 6 });
    // cut()'s docblock: "Cut the selection to the clipboard, then drop the
    // frame" — the frame (selection) is dropped on a successful cut.
    expect(api().selectionActive).toBe(false);
    expect(api().selection).toBeNull();
    // The removed audio (indices 2..5 of the truncated range) went to the
    // clipboard.
    expect(api().clip).toEqual(Int16Array.from([12, 13, 14, 15]));
    // hasEdits' docblock: "An op has been applied (and not undone)".
    expect(api().hasEdits).toBe(true);
    expect(api().canUndo).toBe(true);
    expect(api().canRedo).toBe(false);
    expect(api().working).toEqual(Int16Array.from([10, 11, 16, 17, 18, 19]));

    // A second op (paste), so undo/redo must step over two DISTINCT ops in
    // sequence — not just toggle a single one back and forth, which would
    // pass even if the hook read the wrong index.
    await act(async () => {
      api().paste(2);
    });
    expect(api().hasEdits).toBe(true);
    expect(api().canUndo).toBe(true);
    expect(api().canRedo).toBe(false);
    expect(api().working).toEqual(source);

    // Re-open a selection before the first undo, so its clear-selection
    // behaviour (`clearSelection` passed as `applyLog`'s `after`) is
    // observable rather than a no-op on an already-null selection.
    await act(async () => {
      api().openSelection({ start: 0, end: 3 });
    });
    expect(api().selectionActive).toBe(true);

    // undo() 1: steps over the paste (the most recently applied op).
    let undone1: unknown = null;
    await act(async () => {
      undone1 = api().undo();
    });
    expect(undone1).toEqual({ kind: "paste", at: 2, clip: expect.anything() });
    expect((undone1 as { clip: Int16Array }).clip).toEqual(
      Int16Array.from([12, 13, 14, 15])
    );
    expect(api().working).toEqual(Int16Array.from([10, 11, 16, 17, 18, 19]));
    expect(api().hasEdits).toBe(true);
    expect(api().canUndo).toBe(true);
    expect(api().canRedo).toBe(true);
    // undo()'s docblock names no clear-selection behaviour of its own, but
    // it always passes `clearSelection` as `applyLog`'s `after`.
    expect(api().selectionActive).toBe(false);
    expect(api().selection).toBeNull();

    // undo() 2: steps over the cut.
    let undone2: unknown = null;
    await act(async () => {
      undone2 = api().undo();
    });
    expect(undone2).toEqual({ kind: "cut", range: { start: 2, end: 6 } });
    expect(api().working).toEqual(source);
    expect(api().hasEdits).toBe(false);
    expect(api().canUndo).toBe(false);
    expect(api().canRedo).toBe(true);

    // undo() 3 (boundary): nothing left to undo. undo()'s docblock: "null …
    // if there was nothing to undo".
    let undoneBoundary: unknown = "not yet set";
    await act(async () => {
      undoneBoundary = api().undo();
    });
    expect(undoneBoundary).toBeNull();
    expect(api().working).toEqual(source);
    expect(api().hasEdits).toBe(false);

    // Re-open a selection before the first redo, for the same reason as
    // before undo above.
    await act(async () => {
      api().openSelection({ start: 0, end: 1 });
    });
    expect(api().selectionActive).toBe(true);

    // redo() 1: re-applies the cut.
    let redone1: unknown = null;
    await act(async () => {
      redone1 = api().redo();
    });
    expect(redone1).toEqual({ kind: "cut", range: { start: 2, end: 6 } });
    expect(api().working).toEqual(Int16Array.from([10, 11, 16, 17, 18, 19]));
    expect(api().hasEdits).toBe(true);
    expect(api().canUndo).toBe(true);
    expect(api().canRedo).toBe(true);
    expect(api().selectionActive).toBe(false);
    expect(api().selection).toBeNull();

    // redo() 2: re-applies the paste.
    let redone2: unknown = null;
    await act(async () => {
      redone2 = api().redo();
    });
    expect(redone2).toEqual({ kind: "paste", at: 2, clip: expect.anything() });
    expect((redone2 as { clip: Int16Array }).clip).toEqual(
      Int16Array.from([12, 13, 14, 15])
    );
    expect(api().working).toEqual(source);
    expect(api().hasEdits).toBe(true);
    expect(api().canUndo).toBe(true);
    expect(api().canRedo).toBe(false);

    // redo() 3 (boundary): nothing left to redo. redo()'s docblock: "null …
    // if there was nothing to redo". Control: open a selection first, and
    // confirm THIS no-op step does NOT clear it — clearSelection only runs
    // when applyLog actually ran.
    await act(async () => {
      api().openSelection({ start: 0, end: 1 });
    });
    let redoneBoundary: unknown = "not yet set";
    await act(async () => {
      redoneBoundary = api().redo();
    });
    expect(redoneBoundary).toBeNull();
    expect(api().working).toEqual(source);
    expect(api().hasEdits).toBe(true);
    expect(api().selectionActive).toBe(true);
    expect(api().selection).toEqual({ start: 0, end: 1 });
  });
});

describe("useSegmentEditor.cut refuses a no-op cut without dropping the frame (#361)", () => {
  it("returns null and leaves an unset selection alone", async () => {
    const api = await mount(original10());

    let result: unknown = "not yet set";
    await act(async () => {
      result = api().cut();
    });
    expect(result).toBeNull();
    expect(api().hasEdits).toBe(false);
  });

  it("returns null and leaves a sub-whole-sample selection open to be resized, per the inline comment above cut()'s spansWholeSample guard", async () => {
    const api = await mount(original10());

    // Seed the clipboard with a real whole-sample cut first (#797/#845): the
    // original version of this case never put anything on the clipboard, so
    // a regression in which a REFUSED cut wipes an already-populated
    // clipboard (the data-loss class the guard's own comment names) would
    // pass unnoticed.
    await act(async () => {
      api().openSelection({ start: 0, end: 3 });
    });
    await act(async () => {
      api().cut();
    });
    expect(api().clip).toEqual(Int16Array.from([10, 11, 12]));
    const hasEditsAfterSeed = api().hasEdits;
    const canUndoAfterSeed = api().canUndo;

    await act(async () => {
      api().openSelection({ start: 3, end: 3.4 });
    });
    expect(api().selectionActive).toBe(true);

    let result: unknown = "not yet set";
    await act(async () => {
      result = api().cut();
    });
    expect(result).toBeNull();
    // "Refusing here is not a no-op: it leaves the selection open to be
    // resized" — selectionActive/selection are UNCHANGED, not cleared.
    expect(api().selectionActive).toBe(true);
    expect(api().selection).toEqual({ start: 3, end: 3.4 });
    // The refusal creates no new edit — history is exactly what the seed cut
    // above left it at, neither advanced nor rolled back.
    expect(api().hasEdits).toBe(hasEditsAfterSeed);
    expect(api().canUndo).toBe(canUndoAfterSeed);
    // The clipboard populated by the seed cut is untouched by the refusal
    // (#797/#845).
    expect(api().clip).toEqual(Int16Array.from([10, 11, 12]));
  });
});
