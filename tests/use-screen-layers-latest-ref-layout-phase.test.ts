// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useScreenLayers } from "@/hooks/use-screen-layers";
import type { Layer } from "@/lib/nav/layer-stack";

/**
 * #361's seventh instance (the "one more mutation-surviving path" comment on
 * #361, M13): `useScreenLayers`' `behaviorsRef` is refreshed in a
 * `useLayoutEffect` with no dependency array (`use-screen-layers.ts:99`), so
 * that every render's `behaviors` closure lands before ANYTHING later in the
 * same commit can read it through the `Layer` this hook hands to `pushLayer`.
 * Mutating that effect to `useEffect` survived the whole suite when #361 was
 * filed, because nothing in `tests/` mounted a hook under jsdom yet. #735/#739
 * changed that (`tests/use-audio-session-supersession.test.ts`), which is what
 * this test's harness copies.
 *
 * **Hypothesis this test is built on, not a fact it asserts:** within one
 * React commit, every `useLayoutEffect` across the tree runs before any
 * `useEffect`. This file does not cite that as a documented React guarantee;
 * it is exercised by a probe and the pass/fail of that probe under the real
 * code versus the M13 mutation IS the evidence, scoped to this synthetic
 * harness. It says nothing about a real Back gesture, a real `popstate`, or
 * device behaviour.
 *
 * The harness: `Owner` mounts `useScreenLayers` and opens one layer whose
 * `dismiss()` records the render's own `counter` prop (its closure). `Probe`
 * is a LATER sibling of `Owner` that, from its OWN `useLayoutEffect`, calls
 * the already-open layer's `dismiss()` directly — synchronously, inside the
 * same commit that changed `counter`. Under the real code, `Owner`'s internal
 * refresh (also a layout effect, and declared before `Probe` in render order)
 * has already landed by the time `Probe`'s layout effect runs, so `dismiss()`
 * observes the FRESH counter. Under M13, the refresh is deferred to a passive
 * effect that has not run yet when `Probe`'s layout effect fires, so
 * `dismiss()` observes the STALE one.
 */

let capturedLayer: Layer | null = null;
const observedCounters: number[] = [];

function pushLayer(layer: Layer): void {
  capturedLayer = layer;
}
function popLayer(): void {
  capturedLayer = null;
}

function Owner({ counter }: { counter: number }): null {
  const layers = useScreenLayers<"probe">(pushLayer, popLayer, {
    probe: {
      busy: () => false,
      dismiss: () => {
        observedCounters.push(counter);
      },
    },
  });
  useLayoutEffect(() => {
    layers.open("probe");
    return () => layers.close("probe");
  }, [layers]);
  return null;
}

function Probe({ trigger }: { trigger: number }): null {
  useLayoutEffect(() => {
    if (trigger > 0) capturedLayer?.dismiss();
  }, [trigger]);
  return null;
}

function Harness({ counter }: { counter: number }) {
  return createElement(
    "div",
    null,
    createElement(Owner, { counter }),
    createElement(Probe, { trigger: counter })
  );
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  observedCounters.length = 0;
  capturedLayer = null;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it(
  "a later layout-phase sibling reads the just-refreshed behaviors closure " +
    "in the same commit, not the previous render's (#361 seventh instance, M13)",
  async () => {
    await act(async () => {
      root.render(createElement(Harness, { counter: 0 }));
    });
    expect(capturedLayer).not.toBeNull();
    expect(observedCounters).toEqual([]);

    await act(async () => {
      root.render(createElement(Harness, { counter: 1 }));
    });

    expect(observedCounters).toEqual([1]);
  }
);
