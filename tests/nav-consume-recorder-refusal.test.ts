// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useNavStack, type UseNavStack } from "@/hooks/use-nav-stack";

/**
 * George r1 on #833 (Low, HYGIENE, deferred to #838 item 2):
 * https://github.com/unfoldingWord/tc-mobile/pull/833#issuecomment-5814266754
 *
 * `consumeRecorderEntry`'s `"issue"` row (`use-nav-stack.ts` ~562-569) is
 * taken only when `recorderExitTraversal` finds both travel-guard flags
 * clear. The comment beside it then asserts `beginBack("commit-close")`
 * "therefore proceeds" and the code writes `.next`, sets `suppressPop` and
 * calls `history.back()` unconditionally. But `recorderExitTraversal` and
 * `beginBack` are two INDEPENDENT checks of the guard, coupled only by that
 * prose comment, not by a shared code path. The commit-close-recorder
 * popstate case (same file, the `"commit-close-recorder"` switch arm) makes
 * the same `beginBack` call and DOES check `.ok`, taking a refusal branch
 * (`suppressPop.current = true;`, no `back()`) when it is false
 * (`nav-commit-close-race-guards.test.ts` pins that arm). The `"issue"` row
 * does not.
 *
 * `beginBack` has no second refusal reason today — `recorderExitTraversal`'s
 * own guard check and `beginBack`'s are evaluated against the same
 * synchronous state, so in the CURRENT tree this row's `beginBack` call can
 * never actually observe a refusal. That is exactly the coupling George is
 * warning about: it holds only because both checks happen to read the same
 * state today, not because the code enforces it. This test manufactures the
 * break directly — it mocks `beginBack` to refuse independently of the
 * guard state — to show what the CURRENT code does when that coupling no
 * longer holds: it calls `history.back()` anyway, stacking a traversal the
 * guard declined (the #763 bug class). This is a defensive invariant against
 * a future refusal reason, not a reproduced field failure — nothing today
 * reaches a real `beginBack` refusal at this exact row.
 *
 * Mounts the real `useNavStack` (the `use-nav-stack-latest-ref-layout-phase`
 * harness shape) and drives `commitCloseRecorder` directly, rather than
 * text-matching the hook's source, so this is a behavioural test of what the
 * hook actually does under the manufactured refusal.
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

  it('control: still issues exactly one history.back() on the un-refused "issue" row', async () => {
    control.refuse = false;
    const handle = await mountAndGetHandle();

    await act(async () => {
      handle.commitCloseRecorder(false);
    });

    expect(backSpy).toHaveBeenCalledTimes(1);
  });
});
