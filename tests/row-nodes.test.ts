// @vitest-environment jsdom
import { act, createElement, useEffect, useRef, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRowNodes, type RowNodes } from "@/hooks/use-row-nodes";

/**
 * The row registry Books and Segments now share (#160, L-15).
 *
 * Both screens' scroll-to-a-new-row depends on this, and it had no test in
 * either of its two previous homes — it lived inline in a component. jsdom has
 * no layout, so what is checked is the CONTRACT the screens rely on: which node
 * a registration resolves to, that an unmount drops it, and — the one that
 * would bite — that a pending id is cleared even when its row never arrived.
 *
 * `scrollIntoView` does not exist in jsdom, so it is stubbed on the prototype.
 * That a browser then actually scrolls is not something jsdom can answer.
 *
 * The harness hands its hook values out from an EFFECT, not from render:
 * `react-hooks/globals` rejects a render-time write to anything declared
 * outside the component, and it is right to — this repo has a rule about that
 * shape (#212) and a test is not the place to model breaking it.
 */

type Captured = {
  api: RowNodes<string>;
  pending: RefObject<string | null>;
};

let root: Root;
let host: HTMLDivElement;
let seen: Captured[] = [];
const scrollIntoView = vi.fn();

function Harness({ onCommit }: { onCommit: (c: Captured) => void }) {
  const api = useRowNodes<string>();
  const pending = useRef<string | null>(null);
  // Every commit, so the identity case below can compare across renders.
  useEffect(() => {
    onCommit({ api, pending });
  });
  return createElement(
    "ul",
    null,
    ["a", "b"].map((id) =>
      createElement("li", {
        key: id,
        id,
        ref: (el: HTMLElement | null) => api.setNode(id, el),
      })
    )
  );
}

const latest = (): Captured => seen[seen.length - 1]!;

function render() {
  act(() =>
    root.render(createElement(Harness, { onCommit: (c) => seen.push(c) }))
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  scrollIntoView.mockClear();
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

describe("useRowNodes", () => {
  it("resolves a registered row to its node", () => {
    expect(latest().api.nodeFor("a")?.id).toBe("a");
    expect(latest().api.nodeFor("b")?.id).toBe("b");
  });

  it("knows nothing about an id that was never registered", () => {
    expect(latest().api.nodeFor("missing")).toBeUndefined();
  });

  it("scrolls the pending row into view, nearest, and clears the ref", () => {
    const { api, pending } = latest();
    pending.current = "b";

    act(() => api.scrollPending(pending));

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    expect(pending.current).toBeNull();
  });

  it("does nothing when nothing is pending", () => {
    const { api, pending } = latest();
    act(() => api.scrollPending(pending));
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("CLEARS a pending id whose row never arrived", () => {
    // The one that would bite. Both screens set the ref before the state
    // change that adds the row, then consume it on a later commit. If an
    // append failed, or the row was removed before that commit, holding the id
    // would fire this scroll on some unrelated commit much later — a list that
    // jumps for no reason a translator can connect to anything they did.
    const { api, pending } = latest();
    pending.current = "never-added";

    act(() => api.scrollPending(pending));

    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(pending.current).toBeNull();
  });

  it("drops a row's node when it unmounts", () => {
    // React calls the ref callback with null on unmount. A stale node would
    // keep a detached element alive and make `nodeFor` answer for a row that
    // is no longer on screen.
    const { api } = latest();
    act(() => api.setNode("a", null));
    expect(api.nodeFor("a")).toBeUndefined();
    expect(api.nodeFor("b")?.id).toBe("b");
  });

  it("keeps identity-stable callbacks, so a screen's effect deps do not churn", () => {
    // Both screens list these in a dependency array beside their own data. If
    // any were re-created per render, the effect would run on every render and
    // consume pending ids on commits that changed nothing.
    const first = latest().api;
    render();
    const second = latest().api;

    expect(seen.length).toBeGreaterThan(1); // the re-render really happened
    expect(second.setNode).toBe(first.setNode);
    expect(second.nodeFor).toBe(first.nodeFor);
    expect(second.scrollPending).toBe(first.scrollPending);
  });
});
