// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AboutPanel } from "@/components/about-panel";
import { stringsEn } from "@/lib/strings";

/**
 * ADR 0017: the ISO 639-3 terms of use ask that "attribution is given to
 * iso639-3.sil.org as the source of the codes". The bundled language list
 * (#1492) carries ISO 639-3 codes, so About & licenses says where they come
 * from. The panel is mounted for real (the `about-privacy-link.test.ts`
 * harness), so this is the text a person holding the phone can read.
 */

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

it("names ISO 639-3 and iso639-3.sil.org as the source of the language codes", () => {
  expect(stringsEn.aboutLanguageCodes).toBe(
    "Language codes: ISO 639-3, from iso639-3.sil.org."
  );
  const lines = [...document.querySelectorAll("section span")].map(
    (el) => el.textContent
  );
  expect(lines).toContain(stringsEn.aboutLanguageCodes);
});
