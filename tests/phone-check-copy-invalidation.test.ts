// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PhoneCheckView } from "@/components/phone-check-screen";
import type { PhoneCheckState } from "@/hooks/use-phone-check";
import { strings } from "@/lib/strings";

/**
 * #1014 item 8: "Copied." must not survive a result landing after the copy.
 *
 * `tests/phone-check-entry.test.ts` covers `PhoneCheckView` with the static
 * render harness (`tests/render.ts`), which runs no effects — the invalidating
 * `useEffect` this file exercises cannot be reached from a single
 * `renderToStaticMarkup` pass, so this file mounts the real component with
 * `react-dom/client` and `act()`, the same step `docs`/AGENTS.md names for
 * "if an assertion genuinely needs effects."
 *
 * jsdom has no Clipboard API, so `navigator.clipboard` is stubbed here with a
 * `writeText` that resolves — without it `copyText` falls back to `select()`
 * and reports `"selected"`, not `"copied"`, and the label under test never
 * appears to go stale in the first place.
 */

const IDLE: PhoneCheckState = {
  device: null,
  encode: null,
  storage: null,
  allocation: null,
  activity: null,
};

const OK_DEVICE: PhoneCheckState["device"] = {
  status: "ok",
  value: {
    userAgent: "test",
    deviceMemoryGb: null,
    cores: null,
    quotaBytes: null,
    usageBytes: null,
    persisted: null,
  },
};

const OK_ENCODE: PhoneCheckState["encode"] = {
  status: "ok",
  value: { audioSeconds: 300, wallMs: 1000, mp3Bytes: 100 },
};

let root: Root;
let container: HTMLDivElement;
let writeText: (text: string) => Promise<void>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  writeText = () => Promise.resolve();
  Object.defineProperty(window.navigator, "clipboard", {
    value: { writeText: (text: string) => writeText(text) },
    configurable: true,
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  Reflect.deleteProperty(window.navigator, "clipboard");
  vi.unstubAllGlobals();
});

function renderView(state: PhoneCheckState) {
  root.render(
    createElement(PhoneCheckView, {
      state,
      version: "0.2.12",
      sha: "abc1234",
      onStart: () => {},
      onStartMemory: () => {},
      onClose: () => {},
    })
  );
}

function copyStatusText(): string {
  const el = container.querySelector('[data-phone-check="copy-status"]');
  if (el === null) throw new Error("no copy-status element rendered");
  return el.textContent ?? "";
}

describe("PhoneCheckView clears a stale Copied when the report changes (#1014 item 8)", () => {
  it("copies, then invalidates when a later step lands", async () => {
    await act(async () => renderView({ ...IDLE, device: OK_DEVICE }));
    expect(copyStatusText()).toBe("");

    const copyButton = container.querySelector<HTMLButtonElement>(
      '[data-phone-check="copy"]'
    );
    if (copyButton === null) throw new Error("no copy button rendered");
    await act(async () => copyButton.click());
    expect(copyStatusText()).toBe(strings.phoneCheckCopied);

    // The encode step lands — a different report, same device result.
    await act(async () =>
      renderView({ ...IDLE, device: OK_DEVICE, encode: OK_ENCODE })
    );
    expect(copyStatusText()).toBe("");
  });

  it("control: re-rendering with the SAME results keeps Copied up", async () => {
    await act(async () => renderView({ ...IDLE, device: OK_DEVICE }));
    const copyButton = container.querySelector<HTMLButtonElement>(
      '[data-phone-check="copy"]'
    );
    if (copyButton === null) throw new Error("no copy button rendered");
    await act(async () => copyButton.click());
    expect(copyStatusText()).toBe(strings.phoneCheckCopied);

    // A re-render carrying the identical state (e.g. a parent re-render with
    // no new result) must not clear a label that is still accurate.
    await act(async () => renderView({ ...IDLE, device: OK_DEVICE }));
    expect(copyStatusText()).toBe(strings.phoneCheckCopied);
  });
});
