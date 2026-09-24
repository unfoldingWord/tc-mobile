// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useScrollToNew, type ScrollToNew } from "@/hooks/use-scroll-to-new";

/**
 * The row registry Books and Segments share, at the DOM boundary (#160, L-15).
 *
 * The DECISION this hook delegates to is a truth table over ids
 * (`tests/pending-reveal.test.ts`). This file covers the half that table
 * cannot reach: which node a registration resolves to, which control inside a
 * row a hand-off lands on, that an unmount drops the node, and that a HELD
 * hand-off is retained rather than spent — the #364 rule, here as the hook
 * actually behaves rather than as `planReveal` decides.
 *
 * jsdom has no layout, so `scrollIntoView` does not exist on the prototype and
 * is stubbed. What a real one does to a phone viewport is not a question this
 * suite can answer; whether the hook calls it, on which node, and with which
 * argument, is.
 *
 * The harness hands its hook value out from an EFFECT, not from render:
 * `react-hooks/globals` rejects a render-time write to a binding declared
 * outside the component, and it is right to — this repo has its own history
 * with that shape (#212), and a test is not the place to model breaking it.
 */

let root: Root;
let host: HTMLDivElement;
let seen: ScrollToNew<string>[] = [];
/**
 * Which rows were scrolled, newest last — the RECEIVER's id, not just a count.
 *
 * The mock below sits on `HTMLElement.prototype`, so every row shares it. A
 * call count and an options argument therefore cannot tell "scrolled row b"
 * from "scrolled row a": a hook that ignored the armed id and scrolled some
 * other row that happens to exist passed all thirteen cases here (George
 * round 1, finding 1 — observed, not reasoned). Capturing `this.id` is what
 * makes the which-row mutation die, and that mutation is the one this file
 * exists to kill.
 */
const scrolled: string[] = [];
const scrollIntoView = vi.fn(function (this: HTMLElement) {
  scrolled.push(this.id);
});

function Harness({
  onCommit,
}: {
  onCommit: (api: ScrollToNew<string>) => void;
}) {
  const api = useScrollToNew<string>("button");
  // Every commit, so the identity case below can compare across renders.
  useEffect(() => {
    onCommit(api);
  });
  return createElement(
    "ul",
    null,
    ["a", "b"].map((id) =>
      createElement(
        "li",
        {
          key: id,
          id,
          ref: (el: HTMLElement | null) => api.setNode(id, el),
        },
        // A span BEFORE the button, so a `controlIn` that resolved by DOM
        // order rather than by the selector would answer with the wrong node.
        createElement("span", { id: `${id}-label` }, id),
        createElement("button", { id: `${id}-open` }, "Open")
      )
    )
  );
}

const api = (): ScrollToNew<string> => seen[seen.length - 1]!;

function render() {
  act(() =>
    root.render(createElement(Harness, { onCommit: (a) => seen.push(a) }))
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  scrollIntoView.mockClear();
  scrolled.length = 0;
  seen = [];
  // jsdom implements no layout, so this method is absent entirely.
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  render();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the registry", () => {
  it("resolves a registered row to its node", () => {
    expect(api().nodeFor("a")?.id).toBe("a");
    expect(api().nodeFor("b")?.id).toBe("b");
  });

  it("answers null for an id that was never registered", () => {
    expect(api().nodeFor("missing")).toBeNull();
    expect(api().controlIn("missing")).toBeNull();
  });

  it("drops a row's node when it unmounts", () => {
    // React calls the ref callback with null on unmount. A stale node would
    // keep a detached element alive and make `nodeFor` answer for a row that
    // is no longer on screen.
    act(() => api().setNode("a", null));
    expect(api().nodeFor("a")).toBeNull();
    expect(api().nodeFor("b")?.id).toBe("b");
  });

  it("resolves the hand-off control by the SELECTOR, not by DOM order", () => {
    // The row's first child is a span. Landing by position would answer with
    // it, and a span takes no focus — the hand-off would be a silent no-op,
    // which is the #364 failure wearing different clothes.
    expect(api().controlIn("a")?.id).toBe("a-open");
  });

  it("keeps identity-stable callbacks, so a screen's effect deps do not churn", () => {
    // Both screens list this object in a dependency array beside their own
    // data. A fresh object per render would re-run the effect on every render
    // and spend armed ids on commits that changed nothing.
    const first = api();
    render();
    const second = api();

    expect(seen.length).toBeGreaterThan(1); // the re-render really happened
    expect(second).toBe(first);
  });
});

describe("arm, then reveal", () => {
  it("scrolls the armed row into view, nearest, and spends the arm", () => {
    act(() => {
      api().armScroll("b");
      api().reveal();
    });

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    // The ARMED row, not merely some row.
    expect(scrolled).toEqual(["b"]);

    // Spent: a second reveal with nothing newly armed does nothing.
    act(() => api().reveal());
    expect(scrolled).toEqual(["b"]);
  });

  it("does nothing when nothing is armed", () => {
    act(() => api().reveal());
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
  });

  it("SPENDS an arm whose row never arrived", () => {
    // Hook policy, not a reachable screen path: an arm is spent by the next
    // reveal whether or not its row was found. Retaining it instead would fire
    // a scroll on some unrelated later commit, and a list that jumps for no
    // reason a translator can connect to anything they did is worse than one
    // that never jumps.
    //
    // No caller produces that id today — both screens arm only AFTER their
    // create resolves and return before arming when it fails
    // (`segments-screen.tsx`'s `if (!segment) return`, `books-screen.tsx`'s
    // `if (!chapter) return`). That is caller discipline, which is exactly why
    // the hook is held to it here: the same "premise, not a property"
    // reasoning this lane applies to Segments' missing `inert` hold.
    act(() => {
      api().armScroll("never-added");
      api().reveal();
    });
    expect(scrollIntoView).not.toHaveBeenCalled();

    // The arm is gone, not waiting for the row to show up later.
    act(() => api().setNode("never-added", document.createElement("li")));
    act(() => api().reveal());
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("hands focus to the armed row's control", () => {
    act(() => {
      api().armFocus("a");
      api().reveal();
    });
    expect(document.activeElement?.id).toBe("a-open");
  });

  it("arming null focuses nothing, so a decision with no target needs no branch", () => {
    // `focusTargetAfterDelete` can legitimately answer "nowhere", and Books
    // passes that straight through.
    act(() => {
      api().armFocus(null);
      api().reveal();
    });
    expect(document.activeElement).toBe(document.body);
  });

  it("RETAINS a held hand-off, and lands it on the commit that lifts the hold", () => {
    // The #364 line, at the hook rather than at the decision: focusing inside
    // an `inert` subtree is a silent no-op that CONSUMES the target, so the
    // hand-off is lost for good rather than deferred. Books passes its delete
    // confirm's state as the hold.
    act(() => {
      api().armFocus("a");
      api().reveal(true);
    });
    expect(document.activeElement).toBe(document.body);

    act(() => api().reveal(false));
    expect(document.activeElement?.id).toBe("a-open");
  });

  it("a hold does not stop the scroll, which works inside an inert subtree", () => {
    // Asymmetric on purpose: holding the scroll too would leave the new row
    // off-screen for as long as the overlay is up.
    act(() => {
      api().armScroll("b");
      api().armFocus("a");
      api().reveal(true);
    });
    expect(scrolled).toEqual(["b"]);
    expect(document.activeElement).toBe(document.body);
  });

  it("scrollTo acts now and arms nothing", () => {
    // Segments' first load lands on the first not-finished row, a landing
    // decided from the list itself rather than from a create.
    act(() => api().scrollTo("a"));
    expect(scrolled).toEqual(["a"]);

    act(() => api().reveal());
    expect(scrolled).toEqual(["a"]);
  });
});
