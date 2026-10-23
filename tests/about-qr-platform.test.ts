// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AboutPanel } from "@/components/about-panel";
import { encodeQr } from "@/lib/qr";
import { strings } from "@/lib/strings";

/**
 * #1250 part 2: the About list shows the store QR on the Android build only.
 * The panel is mounted for real with the platform read mocked, so this pins the
 * panel's gating on `readSharePlatform()`, not the runtime's own answer.
 */

const LINK =
  "https://play.google.com/store/apps/details?id=org.unfoldingword.tcmobile";

const platform = vi.hoisted(() => ({ id: "web" as "android" | "ios" | "web" }));
vi.mock("@/hooks/share-target", () => ({
  readSharePlatform: () => platform.id,
}));
vi.mock("@/hooks/report-failure", () => ({ reportFailure: vi.fn() }));
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

async function open(id: "android" | "ios" | "web") {
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
}

const QR = `svg[role="img"][aria-label="${strings.aboutQrCaption}"]`;

it("shows the QR of the Play listing on Android", async () => {
  await open("android");
  const svg = document.querySelector(QR);
  expect(svg).not.toBeNull();
  expect(svg!.querySelectorAll("rect.qr-dark")).toHaveLength(
    encodeQr(LINK).modules.flat().filter(Boolean).length
  );
  // The caption is visible as well as the accessible name.
  expect(document.body.textContent).toContain(strings.aboutQrCaption);
});

it.each(["ios", "web"] as const)("shows no QR on %s", async (id) => {
  await open(id);
  expect(document.querySelector(QR)).toBeNull();
  expect(document.querySelector("rect.qr-dark")).toBeNull();
  expect(document.body.textContent).not.toContain(strings.aboutQrCaption);
});
