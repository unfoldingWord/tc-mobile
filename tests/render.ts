import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";

/**
 * The render harness #197 asks for: a component, its props, and the markup it
 * actually produces.
 *
 * ## Why this exists
 *
 * A whole class of this repo's contracts is carried by a single JSX attribute
 * and pinned by nothing. #197's finding is the type case — `recorder.tsx`'s
 * former inline interrupted branch passed `tone="info"`, and flipping it back
 * to `"busy"` left all tests green. The same hole covers `Control`'s `busy` × `disabled`
 * cell (#155 F1), the recovery panels' `role="alert"` and the ≡-row `alert`
 * badge: each is a prop-to-attribute guarantee with no runner behind it.
 *
 * ## Why static markup, and not a DOM environment
 *
 * Vitest's environment stays `node` (see `vitest.config.ts` and AGENTS.md's
 * DOM ban on `lib/`), and this harness brings its own document rather than
 * changing that globally. Nothing about the environment is swapped: a test
 * file that imports this gets a parsed DOM tree back and nothing else.
 *
 * `renderToStaticMarkup` runs the component once and returns HTML. That is
 * deliberately less than a client render — no effects, no `act()`, no events,
 * no layout, and no cascade — because every assertion #197 lists is a pure
 * props-to-attributes question. Where the *cascade or the real build* is what
 * is under test, the answer is the Playwright suite against `dist/`
 * (`e2e/theme-toggle.spec.ts`), not this; that split is #197's own reasoning,
 * recorded there on 2026-09-17. If an assertion ever genuinely needs effects
 * or focus, the step up is `react-dom/client` + `act()` inside this same
 * jsdom window — not a rewrite of the tests built on it.
 *
 * ## What it returns
 *
 * The container element, so assertions are DOM queries (`querySelector`,
 * `getAttribute`, `hasAttribute`) rather than substring matches on a string.
 * That distinction is the point: `expect(html).not.toContain("disabled")`
 * would pass or fail on a *class name* containing the word, which is exactly
 * the weakened-pattern trap AGENTS.md names for whole-file greps.
 */
export function render(element: ReactElement): Element {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const container = dom.window.document.createElement("div");
  container.innerHTML = renderToStaticMarkup(element);
  dom.window.document.body.append(container);
  return container;
}

/**
 * The one element matching `selector`, or a failure that names what was missing.
 *
 * A bare `querySelector` returns null and hands the assertion a null-property
 * read three lines later; a miss here says which selector found nothing, which
 * is the difference between "the badge is gone" and `TypeError`. It also
 * refuses an ambiguous match: two hits mean the selector no longer identifies
 * the thing the test names, and silently taking the first is how a test starts
 * passing about the wrong element.
 */
export function one(container: Element, selector: string): Element {
  const found = container.querySelectorAll(selector);
  if (found.length === 0) {
    throw new Error(
      `no element matched ${selector} in: ${container.innerHTML}`
    );
  }
  if (found.length > 1) {
    throw new Error(
      `${found.length} elements matched ${selector}, expected exactly one`
    );
  }
  return found[0]!;
}
