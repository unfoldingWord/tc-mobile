// @vitest-environment jsdom
import { act, createElement, useLayoutEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useNavStack, type UseNavStack } from "@/hooks/use-nav-stack";
import type { RecorderCloseResult } from "@/types/view";

/**
 * #1275: the recorder's book crumb goes to Books, two levels up, through
 * `goBackToBooks`. It is `goBack` carrying one continuation: the first level
 * is the recorder's own commit-close (the `popstate` the browser delivers is
 * routed `"commit-close-recorder"` exactly as a plain Back's is), and once
 * that close has consumed the recorder's entry and Segments is the committed
 * screen, the adapter issues the Segments Back itself, which routes
 * `"to-books"` like any other. One `history.back()` per level, every landing
 * through `popAction`, so the traps and guards are the ones Back already has.
 *
 * Mounts the real `useNavStack` under jsdom (the harness shape of
 * `nav-consume-recorder-refusal.test.ts`) and lets jsdom's own history do
 * the traversing: `history.back()` there lands a `popstate` on a later
 * macrotask, as a browser's does, so the chain below is driven by real
 * landings rather than by dispatching synthetic events in an order the test
 * chose. The recorder is a fake handle whose `requestClose` does what the
 * sheet's `close()` does on exit — calls `onExit` (`commitCloseRecorder`) and
 * resolves `true` — or declines, or exits without the screen ever changing.
 *
 * What this cannot say: anything about a browser's task ordering between
 * React's commit and a `popstate`, or about a phone. The fail-safe case below
 * manufactures the stale-screen state directly rather than racing for it.
 */

type Setters = {
  setRecorderOpen: (open: boolean) => void;
  setHasChapter: (has: boolean) => void;
  setRecovering: (on: boolean) => void;
};

const fake = {
  nav: null as UseNavStack | null,
  set: null as Setters | null,
  requestClose: async (): Promise<RecorderCloseResult> => true,
};
const onLeaveToBooks = vi.fn(() => fake.set?.setHasChapter(false));

/** App's shape: the three nav inputs are state, the state halves flip them. */
function Owner(): null {
  const [recorderOpen, setRecorderOpen] = useState(true);
  const [hasChapter, setHasChapter] = useState(true);
  const [recovering, setRecovering] = useState(false);
  const nav = useNavStack({
    hasChapter,
    recorderOpen,
    recovering,
    databasePanel: false,
    getRecorderHandle: () =>
      recorderOpen ? { requestClose: () => fake.requestClose() } : null,
    onOpenChapter: () => {},
    onOpenRecorder: () => {},
    onLeaveToBooks,
    onRecorderClosed: () => setRecorderOpen(false),
  });
  useLayoutEffect(() => {
    fake.nav = nav;
  });
  // The setters are identity-stable, so this runs once.
  useLayoutEffect(() => {
    fake.set = { setRecorderOpen, setHasChapter, setRecovering };
  }, [setRecorderOpen, setHasChapter, setRecovering]);
  return null;
}

let root: Root;
let container: HTMLDivElement;
let backSpy: ReturnType<typeof vi.spyOn>;
let pushSpy: ReturnType<typeof vi.spyOn>;
/** The `index` each landing delivered, in order. */
let landings: number[];
const recordLanding = (event: PopStateEvent) => {
  landings.push((event.state as { index: number }).index);
};

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // The stack the app has on the recorder: root 0, Segments 1, Recorder 2.
  // The hook's mount effect adopts the top entry's index (Amendment B).
  window.history.replaceState({ tc: true, index: 0 }, "", "/");
  window.history.pushState({ tc: true, index: 1 }, "");
  window.history.pushState({ tc: true, index: 2 }, "");
  landings = [];
  window.addEventListener("popstate", recordLanding);
  onLeaveToBooks.mockClear();
  fake.requestClose = async () => {
    // The sheet exits: its `close()` calls `onExit` and resolves true.
    fake.nav!.commitCloseRecorder(false);
    return true;
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Owner));
  });
  backSpy = vi.spyOn(window.history, "back");
  pushSpy = vi.spyOn(window.history, "pushState");
});

afterEach(async () => {
  window.removeEventListener("popstate", recordLanding);
  await act(async () => root.unmount());
  container.remove();
  backSpy.mockRestore();
  pushSpy.mockRestore();
  vi.unstubAllGlobals();
  // jsdom keeps the document's session history across tests; walk it back to
  // the root so the next case's pushes start from a known stack.
  const depth = window.history.length - 1;
  if (depth > 0) {
    window.history.go(-depth);
    await new Promise((r) => setTimeout(r, 20));
  }
});

/**
 * Let jsdom deliver every pending `popstate` and React commit what each
 * landing's state half enqueued. Each traversal lands on its own macrotask
 * and may issue the next, so this turns the loop several times; the chain
 * under test is three landings long.
 */
async function settle(turns = 6) {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

const index = () => (window.history.state as { index: number }).index;

describe("goBackToBooks from the recorder (#1275)", () => {
  it("lands on Books through the recorder's commit-close, one history.back() per level, and leaves the guard clear", async () => {
    const lengthBefore = window.history.length;
    await act(async () => fake.nav!.goBackToBooks());
    await settle();

    // Three traversals: the first level, the commit-close settle's consuming
    // back(), and the Segments Back the continuation issued.
    expect(backSpy).toHaveBeenCalledTimes(3);
    // Landings: the first Back pops the recorder's entry onto Segments (1);
    // the close re-arms it (one pushState) and consumes it (1 again); the
    // chained Back pops Segments onto the root (0). No landing skips a level
    // and none lands twice on the same traversal.
    expect(landings).toEqual([1, 1, 0]);
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(onLeaveToBooks).toHaveBeenCalledTimes(1);
    expect(index()).toBe(0);
    // The same stack two manual Backs leave: the re-arm replaced the
    // recorder's entry and both pops moved within it.
    expect(window.history.length).toBe(lengthBefore);

    // Settled: the next Back is not refused by a stale guard or latch.
    backSpy.mockClear();
    await act(async () => fake.nav!.goBack());
    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  it("a second Back before the first lands is refused, not stacked, and does not take the continuation with it", async () => {
    await act(async () => {
      fake.nav!.goBackToBooks();
      // A hardware Back in the same window (#374) is a plain `goBack`: the
      // any-outstanding guard refuses it, and a refused request must not
      // overwrite the continuation of the Back that IS in flight.
      fake.nav!.goBack();
    });
    expect(backSpy).toHaveBeenCalledTimes(1);
    await settle();
    expect(backSpy).toHaveBeenCalledTimes(3);
    expect(onLeaveToBooks).toHaveBeenCalledTimes(1);
    expect(index()).toBe(0);
  });

  it("control: a plain goBack from the recorder closes the sheet and stops at Segments", async () => {
    await act(async () => fake.nav!.goBack());
    await settle();

    expect(backSpy).toHaveBeenCalledTimes(2);
    expect(landings).toEqual([1, 1]);
    expect(onLeaveToBooks).not.toHaveBeenCalled();
    expect(index()).toBe(1);
  });

  it("drops the continuation when the close declines (a held take, an overlay), and it does not leak into the next Back", async () => {
    // `close()` resolves false and the sheet stays: the adapter re-armed the
    // recorder's entry and nothing more happens.
    fake.requestClose = async () => false;
    await act(async () => fake.nav!.goBackToBooks());
    await settle();
    expect(backSpy).toHaveBeenCalledTimes(1);
    expect(landings).toEqual([1]);
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(onLeaveToBooks).not.toHaveBeenCalled();

    // The sheet later leaves on its own — a programmatic close, as erase's
    // exit is — whose consuming back() lands suppressed with no Back of the
    // user's behind it. The dropped continuation must not resurface at that
    // landing: the app stops at Segments.
    await act(async () => fake.nav!.commitCloseRecorder(false));
    await settle();
    expect(backSpy).toHaveBeenCalledTimes(2);
    expect(onLeaveToBooks).not.toHaveBeenCalled();
    expect(index()).toBe(1);
  });

  it("stops at Segments when the close exited holding a salvaged phrase on the chapter clipboard (George round 1 on #1300)", async () => {
    // The recorder exits, but its close rolled a phrase back onto the
    // chapter clipboard (a superseded stop after a landed paste) or left a
    // cut-to-empty phrase there with its segment gone. Leaving the chapter
    // runs `backToBooks`, which clears that clipboard, so the sheet reports
    // the exit as one that must stay in the chapter and the continuation is
    // dropped: the entry is still consumed, and the tap ends at Segments.
    fake.requestClose = async () => {
      fake.nav!.commitCloseRecorder(true);
      return "exited-stay-in-chapter";
    };
    await act(async () => fake.nav!.goBackToBooks());
    await settle();

    expect(backSpy).toHaveBeenCalledTimes(2);
    expect(landings).toEqual([1, 1]);
    expect(onLeaveToBooks).not.toHaveBeenCalled();
    expect(index()).toBe(1);
    // Nothing is left armed: a later plain Back still issues.
    backSpy.mockClear();
    await act(async () => fake.nav!.goBack());
    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  it("the chained Back is routed like any other: a recovery modal raised by the close traps it instead of leaving", async () => {
    // A failed save exits the sheet AND raises `SaveFailed` (`recovering`),
    // under which `popAction` traps every gesture. The continuation's Back
    // must land in that trap — a re-arm — not run `onLeaveToBooks` under the
    // modal that holds the only copy of the take.
    fake.requestClose = async () => {
      fake.set!.setRecovering(true);
      fake.nav!.commitCloseRecorder(true);
      return true;
    };
    await act(async () => fake.nav!.goBackToBooks());
    await settle();

    expect(backSpy).toHaveBeenCalledTimes(3);
    expect(landings).toEqual([1, 1, 0]);
    expect(onLeaveToBooks).not.toHaveBeenCalled();
    // The commit-close re-arm, then the trap's re-arm of the root-depth
    // entry the chained Back popped.
    expect(pushSpy).toHaveBeenCalledTimes(2);
  });

  it("fails safe to one level when the recorder has not left the screen by the consuming landing", async () => {
    // The sheet reports it exited without the screen ever changing: the
    // adapter's committed view still says "recorder" when the consuming
    // back() lands. Issuing the chained Back there would route a stale
    // screen, so the continuation is dropped and surfaced, and the tap ends
    // where a plain Back would — at Segments.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    fake.requestClose = async () => true;
    await act(async () => fake.nav!.goBackToBooks());
    await settle();

    expect(backSpy).toHaveBeenCalledTimes(2);
    expect(landings).toEqual([1, 1]);
    expect(onLeaveToBooks).not.toHaveBeenCalled();
    expect(index()).toBe(1);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});
