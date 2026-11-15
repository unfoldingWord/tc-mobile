// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { THEME_STORAGE_KEY } from "@/lib/theme";

/**
 * `hooks/use-theme.ts` driven as a hook in jsdom (#1837), where
 * `tests/theme.test.ts` used to read its source text.
 *
 * The hook keeps the live theme in module scope, so every test imports a fresh
 * copy (`vi.resetModules`) and starts from a clean document and storage.
 * `reportFailure` is mocked so a failed persist is observable without the
 * durable log.
 *
 * The subscriber observation: `react` is mocked so the `subscribe` the hook
 * hands `useSyncExternalStore` is wrapped, and each notification records
 * `data-theme` at the moment the module's own listener set calls it. That is
 * the same listener a mounted component is told through, read mid-call, which
 * the one-render static harness (#197) could not do.
 *
 * What jsdom cannot show: the real cascade (the two `--s-floor` values here
 * are a stylesheet this file writes), a painted frame, and a phone. Those stay
 * with `e2e/theme-toggle.spec.ts` and #245.
 */

const reportFailure = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/report-failure", () => ({ reportFailure }));

const notified = vi.hoisted(() => ({ attrs: [] as Array<string | null> }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const wrapped = new WeakMap<object, (cb: () => void) => () => void>();
  return {
    ...actual,
    useSyncExternalStore: <T>(
      subscribe: (cb: () => void) => () => void,
      getSnapshot: () => T,
      getServerSnapshot?: () => T
    ) => {
      let spy = wrapped.get(subscribe);
      if (!spy) {
        spy = (cb) =>
          subscribe(() => {
            notified.attrs.push(
              document.documentElement.getAttribute("data-theme")
            );
            cb();
          });
        wrapped.set(subscribe, spy);
      }
      return actual.useSyncExternalStore(spy, getSnapshot, getServerSnapshot);
    },
  };
});

type ThemeModule = typeof import("@/hooks/use-theme");
type Api = ReturnType<ThemeModule["useTheme"]>;

async function freshHook(): Promise<ThemeModule> {
  vi.resetModules();
  return import("@/hooks/use-theme");
}

const rootEl = () => document.documentElement;
const metaColour = () =>
  document.querySelector('meta[name="theme-color"]')?.getAttribute("content");

let root: Root;
beforeEach(() => {
  reportFailure.mockClear();
  notified.attrs.length = 0;
  window.localStorage.clear();
  rootEl().removeAttribute("data-theme");
  document.head.innerHTML =
    '<meta name="theme-color" content="#000000">' +
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">' +
    "<style>" +
    ":root { --s-floor: #0b1016; }" +
    ':root[data-theme="light"] { --s-floor: #f7f4ee; }' +
    "</style>";
  document.body.innerHTML = "<div id='root'></div>";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount(hook: ThemeModule): Promise<() => Api> {
  let latest: Api | null = null;
  function Probe() {
    const api = hook.useTheme();
    useEffect(() => {
      latest = api;
    });
    return null;
  }
  await act(async () => root.render(createElement(Probe)));
  return () => {
    if (!latest) throw new Error("hook not mounted");
    return latest;
  };
}

describe("useTheme through the hook (#1837)", () => {
  it("puts the attribute on the document before any subscriber is notified", async () => {
    const hook = await freshHook();
    const api = await mount(hook);
    expect(api().theme).toBe("dark");
    await act(async () => api().toggle());
    expect(notified.attrs).toEqual(["light"]);
    expect(api().theme).toBe("light");
    expect(rootEl().getAttribute("data-theme")).toBe("light");
  });

  it("keeps the live theme across unmount and remount when setItem throws", async () => {
    const hook = await freshHook();
    const api = await mount(hook);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    await act(async () => api().toggle());
    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(reportFailure.mock.calls[0]?.[1]).toBe("use-theme: persist");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();

    await act(async () => root.unmount());
    root = createRoot(document.getElementById("root")!);
    const again = await mount(hook);
    expect(again().theme).toBe("light");
    expect(rootEl().getAttribute("data-theme")).toBe("light");
  });

  it("persists the choice when setItem works", async () => {
    const hook = await freshHook();
    const api = await mount(hook);
    await act(async () => api().toggle());
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("falls back to the default, unreported, when getItem throws", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    const hook = await freshHook();
    const api = await mount(hook);
    expect(getItem).toHaveBeenCalledWith(THEME_STORAGE_KEY);
    expect(api().theme).toBe("dark");
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("reads the stored theme at install and applies it", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    const hook = await freshHook();
    hook.installStoredTheme();
    expect(rootEl().getAttribute("data-theme")).toBe("light");
  });

  it("repaints theme-color and the iOS status-bar meta from --s-floor on a toggle", async () => {
    const hook = await freshHook();
    const api = await mount(hook);
    expect(metaColour()).toBe("#0b1016");
    await act(async () => api().toggle());
    expect(metaColour()).toBe("#f7f4ee");
    expect(
      document
        .querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
        ?.getAttribute("content")
    ).toBe("default");
    await act(async () => api().toggle());
    expect(metaColour()).toBe("#0b1016");
  });

  it("leaves theme-color alone when --s-floor resolves empty", async () => {
    document.head.querySelector("style")!.remove();
    const hook = await freshHook();
    const api = await mount(hook);
    await act(async () => api().toggle());
    expect(metaColour()).toBe("#000000");
    expect(rootEl().getAttribute("data-theme")).toBe("light");
  });
});
