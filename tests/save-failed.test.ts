import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SaveFailed } from "@/components/save-failed";
import { strings } from "@/components/strings";
import { region } from "./support";

/**
 * SaveFailed carries the same Send-log control the crash screen has (#456).
 *
 * Same constraint `tests/error-boundary.test.ts` documents: no jsdom, no
 * renderer (`vitest.config.ts` sets `environment: "node"`), so only the
 * markup a first render produces is checked here — the armed/preparing paint
 * `SendLogControl`'s own hook (`useFailureLogShare`) reaches after a tap
 * needs a browser and is not exercised in this suite.
 *
 * `DatabasePanel` is explicitly out of scope for #456 (its own screen calls
 * it a design call) and carries no assertion here.
 */
describe("SaveFailed — the Send-log control (#456)", () => {
  const props = {
    state: "failed" as const,
    kind: "unknown" as const,
    editOnly: false,
    ordinal: 3,
    holdsCutAudio: false,
    attempts: 1,
    onRetry: vi.fn(),
    onDiscard: vi.fn(),
  };

  it("shows the quiet Send-log control, after the primary Retry control", () => {
    const html = renderToStaticMarkup(createElement(SaveFailed, props));

    // The same control the crash screen offers, reused rather than a copy —
    // same accessible name, same quiet paint in its idle state.
    expect(html).toContain(`aria-label="${strings.shareFailureLog}"`);
    expect(html).toContain("control--quiet");

    // Retry is the primary action and comes first; Send is second, matching
    // `ErrorBoundary`'s documented order (RestartControl then SendLogControl).
    // region() throws if either aria-label is missing, or if Send does not
    // strictly follow Retry — a bare indexOf comparison would silently pass
    // if BOTH returned -1 (#533).
    region(html, {
      from: html.indexOf('aria-label="Try saving again"'),
      to: html.indexOf(`aria-label="${strings.shareFailureLog}"`),
    });
  });

  it("is not shown while a save attempt is in flight, like every other control here", () => {
    const html = renderToStaticMarkup(
      createElement(SaveFailed, { ...props, state: "saving" })
    );

    // Positive floor first (#533): an early `return null` on the `saving` arm
    // would make the negative assertion below pass on an empty document,
    // checking nothing. "Saving" is the state's own title text, rendered
    // independently of the block the negative assertion is really about.
    expect(html).toContain("Saving");
    expect(html).not.toContain(`aria-label="${strings.shareFailureLog}"`);
  });

  it("is withheld on the terminal downgrade arm — an unreachable database cannot read its own log (George R1 P2-1)", () => {
    const html = renderToStaticMarkup(
      createElement(SaveFailed, { ...props, kind: "downgrade" })
    );

    // Positive floor first (#533): an early `return null` on the `terminal`
    // arm would make the negative assertion below pass on an empty document.
    // The Discard control renders on every non-saving arm regardless of
    // `terminal`, so its presence proves the screen actually rendered.
    expect(html).toContain("Delete this recording");

    // Same reasoning `DatabasePanel` already carries (AGENTS.md): a
    // `DatabaseDowngradeError` latches `getDb()` for the life of the page, so
    // `prepare()` -> `readFailureLog()` -> `getDb()` would reject on every
    // tap. This is the terminal arm — the same `terminal` condition that
    // swaps Retry for Restart — so Send must not render here either.
    expect(html).not.toContain(`aria-label="${strings.shareFailureLog}"`);
  });

  it("does not invite Retry for a stale deleted target (#378)", () => {
    const html = renderToStaticMarkup(
      createElement(SaveFailed, { ...props, kind: "stale" })
    );

    expect(html).toContain("This book is gone");
    expect(html).not.toContain('aria-label="Try saving again"');
    expect(html).not.toContain("Restart the app");
    expect(html).toContain(`aria-label="${strings.shareFailureLog}"`);
    expect(html).toContain("control--primary");
  });
});
