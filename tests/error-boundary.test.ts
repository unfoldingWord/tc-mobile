import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "@/components/error-boundary";
import {
  subscribeToFailures,
  type FailureReport,
} from "@/hooks/report-failure";
import { strings } from "@/components/strings";

/**
 * What this can and cannot prove.
 *
 * There is no renderer here — `vitest.config.ts` sets `environment: "node"`,
 * and this repo has no jsdom and no testing-library. So React's own catching is
 * NOT exercised below: `renderToStaticMarkup` rethrows a child's error rather
 * than routing it to the boundary (checked, at this commit), and nothing in
 * Node can mount a tree and break it. **That a render throw reaches this
 * boundary at all is verified in a browser, by hand, and is recorded on the
 * PR — not here.**
 *
 * What IS covered is the part that has no browser in it: the two entry points
 * React calls, invoked directly, and the markup the fallback produces. That
 * matters for one property in particular — the fallback must never put the
 * cause on screen. `react-dom/server` is a subpath of a dependency this project
 * already ships; no renderer is added for these two cases.
 */
describe("ErrorBoundary", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("switches to the fallback and reports the cause to the sink", () => {
    const seen: FailureReport[] = [];
    const off = subscribeToFailures((report) => seen.push(report));

    expect(ErrorBoundary.getDerivedStateFromError()).toEqual({ failed: true });

    const boundary = new ErrorBoundary({ children: null });
    const cause = new Error("a stack-shaped string nobody in the field reads");
    boundary.componentDidCatch(cause);

    expect(seen).toEqual([{ context: "render", cause }]);
    off();
  });

  it("shows a glyph and one control, and never the cause", () => {
    const boundary = new ErrorBoundary({ children: null });
    boundary.state = ErrorBoundary.getDerivedStateFromError();

    // The element tree the failed state renders. Constructed directly because
    // reaching it the way React does needs a DOM.
    const html = renderToStaticMarkup(
      createElement(() => boundary.render() as ReactElement)
    );

    // The alert `Notice` — its role is what an assistive reader announces, and
    // its glyph is what a translator who does not read sees.
    expect(html).toContain('role="alert"');
    expect(html).toContain("<svg");
    expect(html).toContain(strings.appFailed);
    // One control, labelled, and large: `--primary` is 68px, over the 44px
    // touch floor.
    expect(html).toContain(`aria-label="${strings.tryAgain}"`);
    expect(html).toContain("control--primary");
    // The property this screen exists to keep: no cause, ever.
    expect(html).not.toContain("Error");
    expect(html).not.toContain("stack");
  });
});
