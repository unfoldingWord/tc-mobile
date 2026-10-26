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
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { SegmentEditor } from "@/hooks/use-segment-editor";
import { useSegmentEditor } from "@/hooks/use-segment-editor";

/**
 * An edit whose buffer cannot be allocated is dropped and shown in place
 * (`error`), and now also written to the failure log under
 * `"recorder-edit-apply"` with the console line kept beside it.
 *
 * Mounts the real hook; `materialize` is the one seam made to throw, the
 * low-memory failure `runEdit`'s guard exists for.
 */
const boundary = vi.hoisted(() => ({ failNext: false, report: vi.fn() }));
vi.mock("@/hooks/report-failure", () => ({ reportFailure: boundary.report }));
vi.mock("@/lib/audio/edit-log", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/audio/edit-log")>();
  return {
    ...actual,
    materialize: (...args: Parameters<typeof actual.materialize>) => {
      if (boundary.failNext) {
        boundary.failNext = false;
        throw new RangeError("simulated allocation failure");
      }
      return actual.materialize(...args);
    },
  };
});

const Harness = forwardRef<SegmentEditor, { readonly original: Int16Array }>(
  function Harness({ original }, ref) {
    const [clip, setClip] = useState<Int16Array | null>(null);
    const editor = useSegmentEditor(original, { clip, set: setClip });
    useImperativeHandle(ref, () => editor);
    return null;
  }
);

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  boundary.failNext = false;
  boundary.report.mockReset();
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

it('a dropped edit reports "recorder-edit-apply" once, with the thrown cause, and sets the in-place error', async () => {
  const ref = createRef<SegmentEditor>();
  await act(async () => {
    root.render(
      createElement(Harness, {
        ref,
        original: Int16Array.from([10, 11, 12, 13, 14, 15]),
      })
    );
  });
  await act(async () => {
    ref.current!.openSelection({ start: 1, end: 3 });
  });
  boundary.failNext = true;
  await act(async () => {
    ref.current!.cut();
  });

  expect(ref.current!.error).toBe(true);
  expect(boundary.report).toHaveBeenCalledTimes(1);
  const [cause, context] = boundary.report.mock.calls[0]!;
  expect(context).toBe("recorder-edit-apply");
  expect(cause).toBeInstanceOf(RangeError);
});

it("an edit that applies writes no row", async () => {
  const ref = createRef<SegmentEditor>();
  await act(async () => {
    root.render(
      createElement(Harness, {
        ref,
        original: Int16Array.from([10, 11, 12, 13, 14, 15]),
      })
    );
  });
  await act(async () => {
    ref.current!.openSelection({ start: 1, end: 3 });
  });
  await act(async () => {
    ref.current!.cut();
  });

  expect(ref.current!.error).toBe(false);
  expect(boundary.report).not.toHaveBeenCalled();
});
