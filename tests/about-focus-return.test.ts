// @vitest-environment jsdom
import { act, createElement, useLayoutEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AboutPanel } from "@/components/about-panel";
import { licenseTexts, type LicenseText } from "@/components/licenses";
import { strings } from "@/lib/strings";

/**
 * #823 item 7: Back from a licence text returns focus to the button that
 * opened it, not to the first button in the list. The panel is mounted for
 * real (react-dom + `act()` in jsdom, the `about-licence-text.test.ts`
 * harness) under a wrapper that owns `viewing` the way BooksScreen does, so
 * the Menu's own open-edge focus runs before the panel's return focus.
 */

vi.mock("@/hooks/report-failure", () => ({ reportFailure: vi.fn() }));
// `BuildStamp` reads build-time defines absent in the test env; this suite is
// about focus, not the footer (the `about-back-navigation.test.ts` mock).
vi.mock("@/components/build-stamp", () => ({ BuildStamp: () => null }));

let root: Root;
let container: HTMLElement;
const control: {
  back: () => void;
  close: () => void;
  open: () => void;
} = { back: () => {}, close: () => {}, open: () => {} };

function Harness() {
  const [open, setOpen] = useState(true);
  const [viewing, setViewing] = useState<LicenseText | null>(null);
  useLayoutEffect(() => {
    control.back = () => setViewing(null);
    control.close = () => {
      setViewing(null);
      setOpen(false);
    };
    control.open = () => setOpen(true);
  });
  return createElement(AboutPanel, {
    open,
    viewing,
    onView: setViewing,
    onBack: () => setViewing(null),
    onClose: () => setOpen(false),
  });
}

beforeEach(async () => {
  document.body.innerHTML = "<div id='root'></div>";
  container = document.getElementById("root")!;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // `SourceOfferLink` in the list reads the `__BUILD_SHA_FULL__` build define.
  vi.stubGlobal(
    "__BUILD_SHA_FULL__",
    "0123456789abcdef0123456789abcdef01234567"
  );
  // The text view's fetch never settles: focus return is about the list.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>(() => {}))
  );
  root = createRoot(container);
  await act(async () => root.render(createElement(Harness)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const button = (text: LicenseText) =>
  document.querySelector<HTMLButtonElement>(
    `button[aria-label="${strings.aboutReadText(text.label)}"]`
  );

it("returns focus to the licence button that opened the text on Back (#823 item 7)", async () => {
  const [first, , third] = licenseTexts as [
    LicenseText,
    LicenseText,
    LicenseText,
  ];
  // The open edge lands on the first licence button: the case the fix must
  // tell apart from a return to the third.
  expect(document.activeElement).toBe(button(first));

  await act(async () => button(third)!.click());
  expect(button(third)).toBeNull();

  await act(async () => control.back());

  expect(button(third)).not.toBeNull();
  expect(document.activeElement).toBe(button(third));
});

it("does not carry a stale return target into a fresh open of the drawer (#823 item 7)", async () => {
  const [first, , third] = licenseTexts as [
    LicenseText,
    LicenseText,
    LicenseText,
  ];
  await act(async () => button(third)!.click());
  // The caller closes the whole drawer from the text view (BooksScreen's
  // closeAbout pops both layers), then the drawer is opened again.
  await act(async () => control.close());
  await act(async () => control.open());

  expect(document.activeElement).toBe(button(first));
});
