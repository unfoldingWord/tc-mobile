// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { THEME_STORAGE_KEY } from "@/lib/theme";

/**
 * #1973 — the phone's system bars follow the app's theme inside the native
 * shell, and nothing happens on the web.
 *
 * `@capacitor/core` is mocked at the seam `hooks/system-bars.ts` reads: the
 * platform probe and the core `SystemBars` plugin. The expected styles are
 * written as the plugin's wire strings ("LIGHT", "DARK") rather than through
 * the enum, so a swapped mapping fails here instead of agreeing with itself.
 *
 * What this cannot show: the native side. That `"LIGHT"` makes Android draw
 * dark icons is read from the plugin's Java source, and is for a phone to
 * confirm (#1973's device row).
 */

const native = vi.hoisted(() => ({
  isNative: true,
  setStyle: vi.fn<(options: { style: string }) => Promise<void>>(),
}));
vi.mock("@capacitor/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@capacitor/core")>();
  return {
    ...actual,
    Capacitor: {
      ...actual.Capacitor,
      isNativePlatform: () => native.isNative,
    },
    SystemBars: { setStyle: native.setStyle },
  };
});

const reportFailure = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/report-failure", () => ({ reportFailure }));

type BarsModule = typeof import("@/hooks/system-bars");
type ThemeModule = typeof import("@/hooks/use-theme");

async function freshBars(): Promise<BarsModule> {
  vi.resetModules();
  return import("@/hooks/system-bars");
}

async function freshTheme(): Promise<ThemeModule> {
  vi.resetModules();
  return import("@/hooks/use-theme");
}

const styles = () => native.setStyle.mock.calls.map(([o]) => o.style);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let root: Root;
beforeEach(() => {
  native.isNative = true;
  native.setStyle.mockReset();
  native.setStyle.mockResolvedValue(undefined);
  reportFailure.mockClear();
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.body.innerHTML = "<div id='root'></div>";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("applySystemBarsStyle (#1973)", () => {
  it("asks for dark icons (LIGHT) on the light theme and light icons (DARK) on the dark theme", async () => {
    const bars = await freshBars();
    bars.applySystemBarsStyle("light");
    bars.applySystemBarsStyle("dark");
    expect(native.setStyle.mock.calls).toEqual([
      [{ style: "LIGHT" }],
      [{ style: "DARK" }],
    ]);
  });

  it("does nothing outside the native shell", async () => {
    native.isNative = false;
    const bars = await freshBars();
    bars.applySystemBarsStyle("light");
    expect(native.setStyle).not.toHaveBeenCalled();
  });

  it("reports a rejected call once per page, under system-bars-style", async () => {
    native.setStyle.mockRejectedValue(new Error("unimplemented"));
    const bars = await freshBars();
    bars.applySystemBarsStyle("light");
    bars.applySystemBarsStyle("dark");
    await flush();
    expect(native.setStyle).toHaveBeenCalledTimes(2);
    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(reportFailure.mock.calls[0]?.[1]).toBe("system-bars-style");
  });

  it("reports a synchronous throw instead of letting it escape", async () => {
    native.setStyle.mockImplementation(() => {
      throw new Error("bridge gone");
    });
    const bars = await freshBars();
    expect(() => bars.applySystemBarsStyle("light")).not.toThrow();
    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(reportFailure.mock.calls[0]?.[1]).toBe("system-bars-style");
  });
});

describe("the theme drives the system bars (#1973)", () => {
  it("styles the bars from the stored theme at install", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    const theme = await freshTheme();
    theme.installStoredTheme();
    expect(styles()).toEqual(["LIGHT"]);
  });

  it("restyles the bars on every runtime toggle", async () => {
    const theme = await freshTheme();
    let toggle: (() => void) | null = null;
    function Probe() {
      const api = theme.useTheme();
      useEffect(() => {
        toggle = api.toggle;
      });
      return null;
    }
    await act(async () => root.render(createElement(Probe)));
    expect(styles()).toEqual(["DARK"]);
    await act(async () => toggle!());
    await act(async () => toggle!());
    expect(styles()).toEqual(["DARK", "LIGHT", "DARK"]);
  });
});
