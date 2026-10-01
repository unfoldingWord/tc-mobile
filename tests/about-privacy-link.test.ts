// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AboutPanel } from "@/components/about-panel";
import { strings } from "@/lib/strings";

/**
 * #1210 (go-live, section 1): the privacy policy is reachable inside the app,
 * not only from the store listings. Apple's guideline 5.1.1(i) asks for both,
 * and the DRI's pick on 2026-10-01 was to ship the link in 1.0.1. The panel is
 * mounted for real (the `about-native-licences.test.ts` harness), so these are
 * the attributes the rendered link carries, not a reading of the source.
 *
 * The URL is spelled out here on purpose: it is the address the stores are
 * given, so a change to it is a listing change, not a refactor.
 */

const PRIVACY_URL =
  "https://github.com/unfoldingWord/tc-mobile/blob/main/PRIVACY.md";

vi.mock("@/hooks/share-target", () => ({ readSharePlatform: () => "web" }));
vi.mock("@/hooks/report-failure", () => ({ reportFailure: vi.fn() }));
// `BuildStamp` reads build-time defines absent in the test env.
vi.mock("@/components/build-stamp", () => ({ BuildStamp: () => null }));

let root: Root;

beforeEach(async () => {
  document.body.innerHTML = "<div id='root'></div>";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "__BUILD_SHA_FULL__",
    "0123456789abcdef0123456789abcdef01234567"
  );
  root = createRoot(document.getElementById("root")!);
  await act(async () =>
    root.render(
      createElement(AboutPanel, {
        open: true,
        viewing: null,
        onView: () => {},
        onBack: () => {},
        onClose: () => {},
      })
    )
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

function privacyLinks(): HTMLAnchorElement[] {
  return [...document.querySelectorAll<HTMLAnchorElement>("a")].filter(
    (a) => a.getAttribute("href") === PRIVACY_URL
  );
}

it("links the privacy policy exactly once, at the address the stores list", () => {
  expect(privacyLinks()).toHaveLength(1);
});

it("names the link for assistive tech and shows the policy's name", () => {
  const [link] = privacyLinks();
  expect(link).toBeDefined();
  expect(strings.aboutVisitPrivacy).toBeTruthy();
  expect(link?.getAttribute("aria-label")).toBe(strings.aboutVisitPrivacy);
  expect(link?.textContent).toBe(strings.aboutPrivacyLink);
});

it("opens the policy off the phone, like the panel's other links", () => {
  const [link] = privacyLinks();
  expect(link).toBeDefined();
  expect(link?.getAttribute("target")).toBe("_blank");
  expect(link?.getAttribute("rel")).toContain("noopener");
});

it("keeps the list's first focusable control an in-app button (George G2)", () => {
  // The list is the panel's scroll container; the open-edge focus lands on
  // its first control, which must not be an off-phone link.
  const list = document.querySelector("div.overflow-auto");
  const first = list?.querySelector<HTMLElement>("button, a[href]");
  expect(first?.tagName).toBe("BUTTON");
});
