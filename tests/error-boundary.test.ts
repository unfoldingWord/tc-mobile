import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "@/components/error-boundary";
import {
  subscribeToFailures,
  type FailureReport,
} from "@/hooks/report-failure";
import { strings } from "@/lib/strings";

/**
 * What this can and cannot prove.
 *
 * There is no renderer here — `vitest.config.ts` sets `environment: "node"`,
 * and this repo has no jsdom and no testing-library. So React's own catching is
 * NOT exercised below: `renderToStaticMarkup` rethrows a child's error rather
 * than routing it to the boundary (checked, at this commit), and nothing in
 * Node can mount a tree and break it. **That a render throw reaches this
 * boundary at all is verified in a browser, by hand, and is recorded on the
 * PR — not here.** The same goes for the focus move: `renderToStaticMarkup`
 * never attaches a ref, so `focusOnMount` is markup here and behaviour only in
 * a browser.
 *
 * What IS covered is the part that has no browser in it: the two entry points
 * React calls, invoked directly, and the markup the fallback produces. That
 * matters for one property in particular — the fallback must never put the
 * cause on screen. `react-dom/server` is a subpath of a dependency this project
 * already ships; no renderer is added for these cases.
 */
describe("ErrorBoundary", () => {
  let seen: FailureReport[];
  let off: () => void;

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    seen = [];
    // Installed here and undone in `afterEach`, the way tests/report-failure
    // does it. `report-failure.ts` holds the one sink slot process-wide, so a
    // case that fails partway through must not leave the slot occupied for
    // whichever file this worker runs next — it would take the "second sink
    // replaced the first" log and fail for a reason unrelated to what it
    // asserts.
    off = subscribeToFailures((report) => seen.push(report));
  });

  afterEach(() => {
    off();
    vi.restoreAllMocks();
  });

  it("switches to the fallback and reports the cause to the sink", () => {
    expect(ErrorBoundary.getDerivedStateFromError()).toEqual({ failed: true });

    const boundary = new ErrorBoundary({ children: null });
    const cause = new Error("a stack-shaped string nobody in the field reads");
    const componentStack = "\n    in Recorder\n    in App";
    boundary.componentDidCatch(cause, { componentStack });

    // React's component tree travels with the cause: in a production build the
    // minified stack alone does not say which component threw.
    expect(seen).toEqual([{ context: "render", cause, componentStack }]);
  });

  it("reports a cause React hands it with no component tree", () => {
    const boundary = new ErrorBoundary({ children: null });
    const cause = new Error("no tree for this one");
    // React's own type says `componentStack?: string | null`, and `null` must
    // not travel to the sink as a present-but-empty field.
    boundary.componentDidCatch(cause, { componentStack: null });

    expect(seen).toEqual([{ context: "render", cause }]);
    expect(seen[0]).not.toHaveProperty("componentStack");
  });

  it("shows a glyph and two controls, and never the cause", () => {
    const boundary = new ErrorBoundary({ children: null });
    boundary.state = ErrorBoundary.getDerivedStateFromError();

    // The element tree the failed state renders. Constructed directly because
    // reaching it the way React does needs a DOM.
    const html = renderToStaticMarkup(
      createElement(() => boundary.render() as ReactElement)
    );

    // The same full-screen recovery surface `SaveFailed` is: a named
    // alertdialog, not a 13px banner.
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-labelledby="app-failed-title"');
    expect(html).toContain('id="app-failed-title"');
    expect(html).toContain(strings.appFailed);
    // The teach line describes the dialog, so a screen reader announces what the
    // button does, not just the alert's name (George, round 3).
    expect(html).toContain('aria-describedby="app-failed-teach"');
    expect(html).toContain('id="app-failed-teach"');
    expect(html).toContain(strings.appReloadTeach);
    // The 56px alert mark — what a translator who does not read actually sees,
    // and the size the other recovery screen uses.
    expect(html).toContain('width="56"');
    // Restart, labelled for what it does — not the Books shelf's `tryAgain` —
    // and large: `--primary` is 68px, over the 44px touch floor.
    expect(html).toContain(`aria-label="${strings.appReload}"`);
    expect(html).toContain("control--primary");
    // `size={30}` — the same retry mark `SaveFailed` draws inside its 68px
    // button, not the 22px default.
    expect(html).toContain('width="30"');
    expect(html).not.toContain(`aria-label="${strings.tryAgain}"`);

    // The log's second door (#205, George round 2). The boundary REPLACES the
    // tree, so the ≡ marker and the menu that normally sends the log are
    // unmounted with `BooksScreen` — and a deterministic home-path render throw
    // returns here after every Restart. Without this control the one failure the
    // durable log most exists to carry is the one that could never leave the
    // phone, so its presence is asserted rather than left to a reading.
    expect(html).toContain(`aria-label="${strings.shareFailureLog}"`);
    // Restart FIRST. Order is the whole accommodation for a non-reader: the
    // primary, recognisable action is under the thumb, and the facilitator's
    // control is the one after it.
    expect(html.indexOf(`aria-label="${strings.appReload}"`)).toBeLessThan(
      html.indexOf(`aria-label="${strings.shareFailureLog}"`)
    );
    // And it is quiet in this state, so it cannot be mistaken for the action to
    // take first. (Its ARMED paint — `default`, after tap 1 — needs a renderer
    // this suite does not have: `renderToStaticMarkup` runs the hook once, in
    // `idle`, and never runs the effect. That half is verified by reading, and
    // said so rather than implied.)
    expect(html).toContain("control--quiet");
    // Focus goes to the labelled heading, so the icon-only button carries no
    // autofocus of its own.
    expect(html).not.toContain("autofocus");
    expect(html).toContain('tabindex="-1"');
    // Restart is NOT busy in this state, and carries its idle label. That is
    // the legitimate-state half of the gate, and it fails if anyone wires
    // `busy` on unconditionally. The BUSY half — the relabel, `aria-busy`, and
    // the busy Notice under it (George R4 P2-3) — needs a click and a pending
    // flush, which needs a renderer this suite does not have AND a render throw
    // the e2e harness cannot produce without adding product surface to force
    // one. Verified by reading, and said so rather than implied.
    expect(html).not.toContain("aria-busy");
    expect(html).not.toContain(strings.appReloading);

    // The property this screen exists to keep: no cause, ever.
    expect(html).not.toContain("Error");
    expect(html).not.toContain("stack");
    expect(html).not.toContain("in Recorder");
  });
});
