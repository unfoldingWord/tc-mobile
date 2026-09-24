// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useNavStack, type UseNavStack } from "@/hooks/use-nav-stack";

/**
 * George r1 on #833 (Low, HYGIENE, deferred to #838 item 2):
 * https://github.com/unfoldingWord/tc-mobile/pull/833#issuecomment-5814266754
 *
 * `consumeRecorderEntry`'s `"issue"` row (`use-nav-stack.ts`, the
 * programmatic recorder close) calls `beginBack("commit-close")` and only
 * writes `.next`, sets `suppressPop` and issues `history.back()` when that
 * call returns `ok`. This file pins two things about the refusal path:
 *
 * - it issues no `history.back()` — the row must not stack a traversal
 *   `beginBack` declined (the #763 bug class); and
 * - it leaves no stale `suppressPop` latch: the NEXT `goBack()` still
 *   issues its own traversal.
 *
 * The refusal deliberately stays clear of the latch rather than mirroring
 * the commit-close settle's refused arm, which absorbs a `goBack` landing
 * already in flight (`suppressPop.current = true`). This row is reached
 * only when `recorderExitTraversal` has already found BOTH guard flags
 * clear, so a refusal here has nothing outstanding to absorb; arming
 * `suppressPop` anyway would make `goBack`'s own early return swallow the
 * very next Back — a real regression Frank r1 on #854 caught (bench round
 * 1) in this PR's first cut, which did absorb here.
 *
 * `beginBack` has no second refusal reason today — `recorderExitTraversal`
 * and `beginBack` check the same two guard flags one line apart, so in the
 * current tree this exact call can never actually observe a refusal. This
 * test manufactures the break by mocking `beginBack` to refuse independently
 * of the guard state, while `recorderExitTraversal` (unmocked) still
 * resolves to `"issue"` from the real, untouched guard state. This is a
 * defensive invariant against a future refusal reason, not a reproduced
 * field failure — nothing today reaches a real `beginBack` refusal at this
 * exact row.
 *
 * Mounts the real `useNavStack` (the `use-nav-stack-latest-ref-layout-phase`
 * harness shape) and drives `commitCloseRecorder` / `goBack` directly,
 * rather than text-matching the hook's source, so this is a behavioural test
 * of what the hook actually does under the manufactured refusal.
 */

const control = vi.hoisted(() => ({ refuse: true }));

vi.mock("@/lib/nav/travel-guard", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/nav/travel-guard")>();
  return {
    ...actual,
    beginBack: (
      ...args: Parameters<typeof actual.beginBack>
    ): ReturnType<typeof actual.beginBack> =>
      control.refuse ? { ok: false, next: args[0] } : actual.beginBack(...args),
  };
});

function Owner({
  handleRef,
}: {
  handleRef: { current: UseNavStack | null };
}): null {
  const handle = useNavStack({
    hasChapter: false,
    recorderOpen: true,
    recovering: false,
    databasePanel: false,
    getRecorderHandle: () => null,
    onOpenChapter: () => {},
    onOpenRecorder: () => {},
    onLeaveToBooks: () => {},
    onRecorderClosed: () => {},
  });
  // Assigned in a layout effect, not during render (react-hooks/refs) — same
  // reason `use-nav-stack-latest-ref-layout-phase.test.ts`'s `Owner` avoids
  // writing a ref inline in its body.
  useLayoutEffect(() => {
    handleRef.current = handle;
  });
  return null;
}

let root: Root;
let container: HTMLDivElement;
let backSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState(null, "", "/");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  backSpy = vi.spyOn(window.history, "back").mockImplementation(() => {});
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  backSpy.mockRestore();
  vi.unstubAllGlobals();
  control.refuse = true;
});

async function mountAndGetHandle(): Promise<UseNavStack> {
  const handleRef: { current: UseNavStack | null } = { current: null };
  await act(async () => {
    root.render(createElement(Owner, { handleRef }));
  });
  backSpy.mockClear();
  return handleRef.current!;
}

describe("consumeRecorderEntry's \"issue\" row honours beginBack's refusal (#838 item 2)", () => {
  it('issues no history.back() when beginBack refuses, even though recorderExitTraversal chose "issue"', async () => {
    control.refuse = true;
    const handle = await mountAndGetHandle();

    await act(async () => {
      handle.commitCloseRecorder(false);
    });

    expect(backSpy).not.toHaveBeenCalled();
  });

  it("a refusal leaves no stale suppressPop latch: the next goBack() still issues one traversal", async () => {
    // Frank r1 on #854: nothing is in flight after a refused "issue" row, so
    // arming suppressPop there made goBack()'s early return eat the next Back.
    control.refuse = true;
    const handle = await mountAndGetHandle();
    await act(async () => {
      handle.commitCloseRecorder(false);
    });
    control.refuse = false;
    await act(async () => {
      handle.goBack();
    });

    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  it('control: still issues exactly one history.back() on the un-refused "issue" row', async () => {
    control.refuse = false;
    const handle = await mountAndGetHandle();

    await act(async () => {
      handle.commitCloseRecorder(false);
    });

    expect(backSpy).toHaveBeenCalledTimes(1);
  });
});
