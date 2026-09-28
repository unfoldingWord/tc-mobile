// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AboutPanel } from "@/components/about-panel";
import { licenseTexts, licenseTextsFor } from "@/components/licenses";
import { strings } from "@/lib/strings";

/**
 * #477: the About list names the native notice on that native build only.
 * The panel is mounted for real (the `about-focus-return.test.ts` harness)
 * with the platform read mocked, so this pins the panel's wiring — that it
 * lists `licenseTextsFor(<the running platform>)` — not the runtime's own
 * platform answer, which only a native build can give.
 */

const platform = vi.hoisted(() => ({ id: "web" as "android" | "ios" | "web" }));
vi.mock("@/hooks/share-target", () => ({
  readSharePlatform: () => platform.id,
}));
vi.mock("@/hooks/report-failure", () => ({ reportFailure: vi.fn() }));
// `BuildStamp` reads build-time defines absent in the test env.
vi.mock("@/components/build-stamp", () => ({ BuildStamp: () => null }));

let root: Root;

beforeEach(() => {
  document.body.innerHTML = "<div id='root'></div>";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "__BUILD_SHA_FULL__",
    "0123456789abcdef0123456789abcdef01234567"
  );
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

async function listedLabels(id: "android" | "ios" | "web") {
  platform.id = id;
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
  // Every text any build could list, once each, in list order.
  const all = [
    ...new Map(
      [...licenseTextsFor("android"), ...licenseTextsFor("ios")].map((t) => [
        t.href,
        t,
      ])
    ).values(),
  ];
  return all
    .filter(
      (t) =>
        document.querySelector(
          `button[aria-label="${strings.aboutReadText(t.label)}"]`
        ) !== null
    )
    .map((t) => t.href);
}

it.each(["android", "ios"] as const)(
  "lists the %s notice after the web texts on that build",
  async (id) => {
    const hrefs = await listedLabels(id);
    expect(hrefs).toEqual(licenseTextsFor(id).map((t) => t.href));
    expect(hrefs.length).toBe(licenseTexts.length + 1);
  }
);

it("lists no native notice on the web build", async () => {
  const hrefs = await listedLabels("web");
  expect(hrefs).toEqual(licenseTexts.map((t) => t.href));
});
