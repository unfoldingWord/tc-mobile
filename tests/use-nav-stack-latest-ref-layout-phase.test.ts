// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useNavStack } from "@/hooks/use-nav-stack";

/**
 * #361's seventh instance (the "one more mutation-surviving path" comment on
 * #361, M14): `useNavStack`'s whole `popstate`-read closure — `screenRef`,
 * `recoveringRef`, `databasePanelRef`, `onLeaveToBooksRef`, `atFloor` — is
 * refreshed in a `useLayoutEffect` with no dependency array
 * (`use-nav-stack.ts:409`). Mutating that effect to `useEffect` survived the
 * whole suite when #361 was filed, because nothing in `tests/` mounted the
 * hook under jsdom yet. #735/#739 changed that
 * (`tests/use-audio-session-supersession.test.ts`), which is what this
 * file's harness copies.
 *
 * **Hypothesis this test is built on, not a fact it asserts** (see the
 * sibling `use-screen-layers-latest-ref-layout-phase.test.ts` for the same
 * caveat, stated once and not repeated at length here): within one React
 * commit, every `useLayoutEffect` runs before any `useEffect`. This test's
 * pass under the real code and its fail under the M14 mutation, both scoped
 * to this synthetic harness, are the only evidence offered. It says nothing
 * about a real Back gesture, a real `popstate` dispatched by the browser, or
 * device behaviour — only that a `popstate` LANDING inside this exact commit
 * reads the ref this effect writes, not the previous render's value.
 *
 * The harness: `Owner` mounts the real `useNavStack` with `recovering` as its
 * only reactive input (screen fixed to "books" throughout — `hasChapter` and
 * `recorderOpen` never change — so the popstate handler's screen-routing
 * branches stay constant and `recovering` is the one thing this test moves).
 * `popAction` checks `recovering` FIRST, before direction or screen, so its
 * value alone decides whether the popstate handler re-arms the entry
 * (`window.history.pushState`, the `"trap-recovery"` tag) or falls through to
 * `"ignore"`/`"exit-app"` (neither of which calls `pushState`). `Probe` is a
 * LATER sibling of `Owner` that, from its OWN `useLayoutEffect`, dispatches a
 * synthetic `popstate` synchronously — inside the same commit that flips
 * `recovering`. `window.history` is reset to a known, un-adoptable state
 * before every mount (`replaceState(null, ...)`), so `useNavStack`'s own
 * bootstrap effect always stamps a fresh `navIndex` of 0, and the dispatched
 * event's own state carries `index: 0` — so direction is `"same"` in every
 * case here and cannot itself explain a `pushState` call.
 */

function Owner({ recovering }: { recovering: boolean }): null {
  useNavStack({
    hasChapter: false,
    recorderOpen: false,
    recovering,
    databasePanel: false,
    getRecorderHandle: () => null,
    onOpenChapter: () => {},
    onOpenRecorder: () => {},
    onLeaveToBooks: () => {},
    onRecorderClosed: () => {},
  });
  return null;
}

function Probe({ trigger }: { trigger: number }): null {
  useLayoutEffect(() => {
    if (trigger > 0) {
      window.dispatchEvent(
        new PopStateEvent("popstate", { state: { tc: true, index: 0 } })
      );
    }
  }, [trigger]);
  return null;
}

function Harness(props: { recovering: boolean; trigger: number }) {
  return createElement(
    "div",
    null,
    createElement(Owner, { recovering: props.recovering }),
    createElement(Probe, { trigger: props.trigger })
  );
}

let root: Root;
let container: HTMLDivElement;
let pushStateSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState(null, "", "/");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  pushStateSpy = vi.spyOn(window.history, "pushState");
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  pushStateSpy.mockRestore();
  vi.unstubAllGlobals();
});

it(
  "a later layout-phase sibling's synthetic popstate reads the just-refreshed " +
    "recovering ref in the same commit, not the previous render's (#361 seventh instance, M14)",
  async () => {
    await act(async () => {
      root.render(createElement(Harness, { recovering: false, trigger: 0 }));
    });
    pushStateSpy.mockClear();

    await act(async () => {
      root.render(createElement(Harness, { recovering: true, trigger: 1 }));
    });

    expect(pushStateSpy).toHaveBeenCalledTimes(1);
  }
);

it(
  "control: the same synthetic popstate, with recovering never flipped, " +
    "never pushes a re-arm entry",
  async () => {
    await act(async () => {
      root.render(createElement(Harness, { recovering: false, trigger: 0 }));
    });
    pushStateSpy.mockClear();

    await act(async () => {
      root.render(createElement(Harness, { recovering: false, trigger: 1 }));
    });

    expect(pushStateSpy).not.toHaveBeenCalled();
  }
);
