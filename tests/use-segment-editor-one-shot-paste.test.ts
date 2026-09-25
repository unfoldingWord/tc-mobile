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
 * A paste is one-shot (#489, the requirements owner's decision of
 * 2026-09-24): a paste that lands empties the clipboard, undoing it puts the
 * phrase back, and redoing it empties it again.
 *
 * Mounts the real `useSegmentEditor` in the same wrapper-component shape as
 * `tests/use-segment-editor-mount.test.ts`, with the clipboard held one level
 * up the way `App.tsx` holds it and handed down as a fresh object each render.
 *
 * `materialize` is wrapped so one case can make a paste's allocation throw —
 * the low-memory failure `runEdit`'s guard exists for — and check that a paste
 * that did NOT land leaves the phrase on the clipboard. Every other case runs
 * the real function.
 */
const failNextMaterialize = { value: false };

vi.mock("@/lib/audio/edit-log", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/audio/edit-log")>();
  return {
    ...actual,
    materialize: (...args: Parameters<typeof actual.materialize>) => {
      if (failNextMaterialize.value) {
        failNextMaterialize.value = false;
        throw new RangeError("simulated allocation failure");
      }
      return actual.materialize(...args);
    },
  };
});

interface HarnessHandle extends SegmentEditor {
  readonly clip: Int16Array | null;
  /** Replace the clipboard from outside the editor, as another screen could. */
  readonly setClip: (clip: Int16Array | null) => void;
}

const Harness = forwardRef<HarnessHandle, { readonly original: Int16Array }>(
  function Harness({ original }, ref) {
    const [clip, setClip] = useState<Int16Array | null>(null);
    const editor = useSegmentEditor(original, { clip, set: setClip });
    const handle: HarnessHandle = { ...editor, clip, setClip };
    useImperativeHandle(ref, () => handle);
    return null;
  }
);

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  failNextMaterialize.value = false;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SOURCE = Int16Array.from([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
const AFTER_CUT = Int16Array.from([10, 11, 16, 17, 18, 19]);
const CUT = Int16Array.from([12, 13, 14, 15]);

async function mountWithCut(): Promise<() => HarnessHandle> {
  const ref = createRef<HarnessHandle>();
  await act(async () => {
    root.render(createElement(Harness, { ref, original: SOURCE }));
  });
  const api = () => {
    if (!ref.current) throw new Error("Harness did not mount");
    return ref.current;
  };
  await act(async () => {
    api().openSelection({ start: 2, end: 6 });
  });
  await act(async () => {
    api().cut();
  });
  expect(api().clip).toEqual(CUT);
  expect(api().canPaste).toBe(true);
  expect(api().working).toEqual(AFTER_CUT);
  return api;
}

describe("useSegmentEditor: paste is one-shot (#489)", () => {
  it("a paste that lands empties the clipboard, and a second paste does nothing", async () => {
    const api = await mountWithCut();

    await act(async () => {
      api().paste(2);
    });
    expect(api().working).toEqual(SOURCE);
    expect(api().clip).toBeNull();
    expect(api().canPaste).toBe(false);

    // Nothing left to drop: the buffer is unchanged and no op was pushed, so
    // one undo steps back over the paste, not over a second one.
    await act(async () => {
      api().paste(0);
    });
    expect(api().working).toEqual(SOURCE);
    let undone: unknown = null;
    await act(async () => {
      undone = api().undo();
    });
    expect(undone).toMatchObject({ kind: "paste", at: 2 });
    expect(api().working).toEqual(AFTER_CUT);
  });

  it("undoing the paste puts the phrase back on the clipboard; redoing it empties it again", async () => {
    const api = await mountWithCut();
    await act(async () => {
      api().paste(2);
    });
    expect(api().clip).toBeNull();

    await act(async () => {
      api().undo();
    });
    // The phrase is out of `working` again, so the clipboard is its only copy.
    expect(api().working).toEqual(AFTER_CUT);
    expect(api().clip).toEqual(CUT);
    expect(api().canPaste).toBe(true);

    await act(async () => {
      api().redo();
    });
    expect(api().working).toEqual(SOURCE);
    expect(api().clip).toBeNull();
    expect(api().canPaste).toBe(false);
  });

  it("undoing a cut leaves the clipboard as it was (only a paste moves it)", async () => {
    const api = await mountWithCut();
    await act(async () => {
      api().undo();
    });
    expect(api().working).toEqual(SOURCE);
    expect(api().clip).toEqual(CUT);
    await act(async () => {
      api().redo();
    });
    expect(api().working).toEqual(AFTER_CUT);
    expect(api().clip).toEqual(CUT);
  });

  it("a paste that fails to apply keeps the phrase on the clipboard", async () => {
    const api = await mountWithCut();
    vi.spyOn(console, "error").mockImplementation(() => {});

    failNextMaterialize.value = true;
    await act(async () => {
      api().paste(2);
    });
    expect(api().error).toBe(true);
    expect(api().working).toEqual(AFTER_CUT);
    expect(api().clip).toEqual(CUT);
    expect(api().canPaste).toBe(true);
  });

  it("redoing a later cut puts its phrase back on an emptied clipboard (R1 Frank/George)", async () => {
    const api = await mountWithCut();
    const step = async (fn: () => unknown) => {
      await act(async () => {
        fn();
      });
    };
    await step(() => api().paste(0));
    await step(() => api().openSelection({ start: 6, end: 8 }));
    await step(() => api().cut());
    const B = Int16Array.from([16, 17]);
    const AFTER_B = Int16Array.from([12, 13, 14, 15, 10, 11, 18, 19]);
    expect(api().clip).toEqual(B);
    await step(() => api().paste(0));
    for (let i = 0; i < 3; i++) await step(() => api().undo());
    await step(() => api().redo()); // paste A: empties the clipboard
    await step(() => api().redo()); // cut B: B leaves `working` again
    expect(api().working).toEqual(AFTER_B);
    expect(api().clip).toEqual(B);
    await step(() => api().redo()); // paste B: one-shot still holds
    expect(api().working).toEqual(Int16Array.from([16, 17, ...AFTER_B]));
    expect(api().clip).toBeNull();
  });

  it("redoing two cuts leaves the later one on the clipboard, as the forward pass did (R2 George)", async () => {
    const api = await mountWithCut();
    const step = async (fn: () => unknown) => {
      await act(async () => {
        fn();
      });
    };
    await step(() => api().paste(0));
    await step(() => api().openSelection({ start: 6, end: 8 }));
    await step(() => api().cut()); // B = [16, 17]
    await step(() => api().openSelection({ start: 6, end: 8 }));
    await step(() => api().cut()); // C = [18, 19]
    const C = Int16Array.from([18, 19]);
    const FORWARD_END = Int16Array.from([12, 13, 14, 15, 10, 11]);
    expect(api().working).toEqual(FORWARD_END);
    expect(api().clip).toEqual(C);
    for (let i = 0; i < 3; i++) await step(() => api().undo());
    expect(api().working).toEqual(AFTER_CUT);
    expect(api().clip).toEqual(CUT);
    for (let i = 0; i < 3; i++) await step(() => api().redo());
    // Round trip ends where the forward pass did: C is off `working`, so the
    // clipboard must hold it — otherwise C lives only in the redo tail.
    expect(api().working).toEqual(FORWARD_END);
    expect(api().clip).toEqual(C);
  });

  it("a redo never empties a clipboard holding a different phrase", async () => {
    const api = await mountWithCut();
    await act(async () => {
      api().paste(2);
    });
    await act(async () => {
      api().undo();
    });
    const other = Int16Array.from([1, 2, 3]);
    await act(async () => {
      api().setClip(other);
    });

    await act(async () => {
      api().redo();
    });
    expect(api().working).toEqual(SOURCE);
    expect(api().clip).toBe(other);
  });
});
