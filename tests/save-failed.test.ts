import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SaveFailed } from "@/components/save-failed";
import { strings } from "@/components/strings";

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
    expect(html.indexOf('aria-label="Try saving again"')).toBeLessThan(
      html.indexOf(`aria-label="${strings.shareFailureLog}"`)
    );
  });

  it("is not shown while a save attempt is in flight, like every other control here", () => {
    const html = renderToStaticMarkup(
      createElement(SaveFailed, { ...props, state: "saving" })
    );

    expect(html).not.toContain(`aria-label="${strings.shareFailureLog}"`);
  });

  it("is withheld on the terminal downgrade arm — an unreachable database cannot read its own log (George R1 P2-1)", () => {
    const html = renderToStaticMarkup(
      createElement(SaveFailed, { ...props, kind: "downgrade" })
    );

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
    expect(html).not.toContain(`aria-label="${strings.saveFailedRetry}"`);
    expect(html).not.toContain(strings.appReload);
    expect(html).toContain(`aria-label="${strings.shareFailureLog}"`);
    expect(html).toContain("control--primary");
  });

  /**
   * The other half of the case above, and the reason it is worth having: the
   * two assertions that Retry and Restart are ABSENT are negative, and a
   * negative assertion against copy goes vacuous the moment the copy moves.
   * Reading `strings.saveFailedRetry` and `strings.appReload` rather than their
   * text (#169) is what keeps them honest; this case adds the positive half, so
   * a render that dropped every control would not pass as "no Retry".
   *
   * Discard is the promoted exit on a stale target, so its wording is the thing
   * a translator is left reading, and it must still name the held work
   * correctly: the recording on the record path, the changes on the edit path,
   * where the stored recording survives on disk and only the edit is at stake.
   */
  it("still names the held work on the promoted Discard, both paths (#378, #169)", () => {
    const record = renderToStaticMarkup(
      createElement(SaveFailed, { ...props, kind: "stale" })
    );
    expect(record).toContain(`aria-label="${strings.discardRecording}"`);
    expect(record).not.toContain(strings.discardChanges);

    const edit = renderToStaticMarkup(
      createElement(SaveFailed, { ...props, kind: "stale", editOnly: true })
    );
    expect(edit).toContain(`aria-label="${strings.discardChanges}"`);
    expect(edit).not.toContain(strings.discardRecording);
  });
});
