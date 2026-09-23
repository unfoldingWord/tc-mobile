import { describe, expect, it, type Mock, vi } from "vitest";

import { attachNativeBack, type NativeBackPlugin } from "@/hooks/use-nav-stack";
import type { Layer } from "@/lib/nav/layer-stack";
import { popAction, type PopAction } from "@/lib/nav/navigation";

const reportFailure = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/report-failure", () => ({ reportFailure }));

/**
 * The native (Capacitor shell) leg of system Back (#374).
 *
 * Inside the shell a hardware Back is not a WebView history pop; it reaches
 * the app as `@capacitor/app`'s `backButton` event, and the app decides. This
 * exercises `attachNativeBack` — the listener and its dispatch — through an
 * injected plugin, composed with the REAL `popAction` over a real `Layer`, so
 * the decision under test is the one the `popstate` route makes.
 *
 * The dispatch rule under test: whatever the WebView can still pop becomes
 * the one in-app Back, so the `popstate` handler routes it exactly as it would
 * a browser Back — including the `"exit-app"` cases it settles silently (the
 * #535 standing floor entry, an adopted depth after a reload). `exitApp()` is
 * reached only when there is nothing left to pop AND the route says leave; a
 * trap with nothing beneath it holds.
 *
 * What it cannot reach, stated rather than implied: the `popstate` that the
 * dispatched `goBack()` produces, and the layer dismissal that route performs,
 * need a browser (`e2e/back-navigation.spec.ts` in Chromium); the plugin event
 * itself, `exitApp()` and the Android `OnBackPressedCallback` need a phone.
 * This file proves the dispatch, the failure routing and the handler toggling.
 */

interface FakeBack {
  readonly plugin: NativeBackPlugin;
  /** Fire the event the plugin would deliver on a hardware Back. */
  press(canGoBack: boolean): void;
  readonly exitApp: ReturnType<typeof vi.fn>;
  readonly remove: ReturnType<typeof vi.fn>;
  readonly toggle: ReturnType<typeof vi.fn>;
  /** Resolve `addListener`'s handle promise (it is held until this is called). */
  settleHandle(): Promise<void>;
  /** Reject `addListener`'s handle promise instead. */
  failHandle(cause: unknown): Promise<void>;
}

function fakeBack(): FakeBack {
  let listener: ((event: { canGoBack: boolean }) => void) | null = null;
  const exitApp = vi.fn(() => Promise.resolve());
  const remove = vi.fn(() => Promise.resolve());
  const toggle = vi.fn(() => Promise.resolve());
  let resolveHandle: (() => void) | null = null;
  let rejectHandle: ((cause: unknown) => void) | null = null;
  const handle = new Promise<{ remove: () => Promise<void> }>(
    (resolve, reject) => {
      resolveHandle = () => resolve({ remove });
      rejectHandle = reject;
    }
  );
  // A rejection that nobody has attached to yet must not surface as unhandled
  // in the test runner; the code under test attaches its own catch.
  handle.catch(() => undefined);
  return {
    plugin: {
      addListener: (_eventName, fn) => {
        listener = fn;
        return handle;
      },
      exitApp,
      toggleBackButtonHandler: toggle,
    },
    press(canGoBack) {
      if (!listener) throw new Error("no backButton listener registered");
      listener({ canGoBack });
    },
    exitApp,
    remove,
    toggle,
    async settleHandle() {
      resolveHandle?.();
      await handle;
    },
    async failHandle(cause) {
      rejectHandle?.(cause);
      await handle.catch(() => undefined);
    },
  };
}

/** Let the microtask chains inside `attachNativeBack` settle. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function layer(): Layer & { dismiss: Mock<() => void> } {
  return { id: "menu", busy: () => false, dismiss: vi.fn<() => void>() };
}

/** `popAction` for a Back at `screen` with `stack` open and no trap up. */
function decideFor(
  screen: "books" | "segments" | "recorder",
  stack: readonly Layer[],
  databasePanel = false
): () => PopAction {
  return () => popAction("back", screen, false, false, databasePanel, stack);
}

describe("attachNativeBack — the shell's hardware Back (#374)", () => {
  it("(a) a layer open on Books: issues the in-app Back, never exitApp, and leaves the dismissal to the popstate route", () => {
    const back = fakeBack();
    const top = layer();
    const goBack = vi.fn();
    attachNativeBack(back.plugin, {
      decide: decideFor("books", [top]),
      goBack,
    });

    back.press(true);

    expect(goBack).toHaveBeenCalledTimes(1);
    expect(back.exitApp).not.toHaveBeenCalled();
    // No duplicate routing: the layer is dismissed by the popstate the Back
    // produces, not a second time here.
    expect(top.dismiss).not.toHaveBeenCalled();
  });

  it("(b) an empty stack on Books with nothing left to pop: exits the app and issues no history Back", () => {
    const back = fakeBack();
    const goBack = vi.fn();
    attachNativeBack(back.plugin, { decide: decideFor("books", []), goBack });

    back.press(false);

    expect(back.exitApp).toHaveBeenCalledTimes(1);
    expect(goBack).not.toHaveBeenCalled();
  });

  it("(b') an empty stack on Books with an entry still in the WebView (#535 floor entry, or an adopted depth after a reload): issues the Back so the popstate route settles it, and does NOT exit", () => {
    const back = fakeBack();
    const goBack = vi.fn();
    attachNativeBack(back.plugin, { decide: decideFor("books", []), goBack });

    back.press(true);

    expect(goBack).toHaveBeenCalledTimes(1);
    expect(back.exitApp).not.toHaveBeenCalled();
  });

  it("(c) an empty stack on a non-floor screen: runs the normal Back route", () => {
    const back = fakeBack();
    const goBack = vi.fn();
    attachNativeBack(back.plugin, {
      decide: decideFor("segments", []),
      goBack,
    });

    back.press(true);

    expect(goBack).toHaveBeenCalledTimes(1);
    expect(back.exitApp).not.toHaveBeenCalled();
  });

  it("(d) a global trap on Books with nothing beneath it: holds — neither exits nor issues a Back that could never land", () => {
    const back = fakeBack();
    const goBack = vi.fn();
    attachNativeBack(back.plugin, {
      decide: decideFor("books", [], true),
      goBack,
    });

    back.press(false);

    expect(goBack).not.toHaveBeenCalled();
    expect(back.exitApp).not.toHaveBeenCalled();
  });

  it("(e) a global trap with an entry beneath it: issues the Back so the popstate route re-arms it", () => {
    const back = fakeBack();
    const goBack = vi.fn();
    attachNativeBack(back.plugin, {
      decide: decideFor("books", [], true),
      goBack,
    });

    back.press(true);

    expect(goBack).toHaveBeenCalledTimes(1);
    expect(back.exitApp).not.toHaveBeenCalled();
  });

  it("(f) detach removes the plugin listener once the handle has resolved", async () => {
    const back = fakeBack();
    const detach = attachNativeBack(back.plugin, {
      decide: decideFor("books", []),
      goBack: vi.fn(),
    });
    await back.settleHandle();

    detach();
    await flush();

    expect(back.remove).toHaveBeenCalledTimes(1);
  });

  it("(f') detach before the handle resolves still removes it, exactly once, when it does", async () => {
    const back = fakeBack();
    const detach = attachNativeBack(back.plugin, {
      decide: decideFor("books", []),
      goBack: vi.fn(),
    });

    detach();
    expect(back.remove).not.toHaveBeenCalled();
    await back.settleHandle();
    await flush();

    expect(back.remove).toHaveBeenCalledTimes(1);
  });
});

describe("attachNativeBack — every plugin promise has a channel (Frank r1 P2 on PR 634)", () => {
  it("(g) a rejected exitApp() reaches the funnel under its own context", async () => {
    reportFailure.mockClear();
    const back = fakeBack();
    const cause = new Error("finish refused");
    back.exitApp.mockImplementationOnce(() => Promise.reject(cause));
    attachNativeBack(back.plugin, {
      decide: decideFor("books", []),
      goBack: vi.fn(),
    });

    back.press(false);
    await flush();

    expect(reportFailure).toHaveBeenCalledWith(cause, "native-back-exit");
  });

  it("(h) a rejected addListener() reaches the funnel — the press would otherwise be silently unwired", async () => {
    reportFailure.mockClear();
    const back = fakeBack();
    const cause = new Error("bridge not ready");
    attachNativeBack(back.plugin, {
      decide: decideFor("books", []),
      goBack: vi.fn(),
    });

    await back.failHandle(cause);
    await flush();

    expect(reportFailure).toHaveBeenCalledWith(cause, "native-back-listener");
  });

  it("(m) a callback the plugin failed to remove is inert after detach — a press routes nothing (Frank r2 P2)", async () => {
    reportFailure.mockClear();
    const back = fakeBack();
    const goBack = vi.fn();
    back.remove.mockImplementationOnce(() =>
      Promise.reject(new Error("handle gone"))
    );
    const detach = attachNativeBack(back.plugin, {
      decide: decideFor("segments", []),
      goBack,
    });
    await back.settleHandle();
    detach();
    await flush();

    // The plugin still holds the listener; a hardware Back reaches it.
    back.press(true);
    back.press(false);

    expect(goBack).not.toHaveBeenCalled();
    expect(back.exitApp).not.toHaveBeenCalled();
  });

  it("(i) a rejected remove() on detach reaches the funnel", async () => {
    reportFailure.mockClear();
    const back = fakeBack();
    const cause = new Error("handle gone");
    back.remove.mockImplementationOnce(() => Promise.reject(cause));
    const detach = attachNativeBack(back.plugin, {
      decide: decideFor("books", []),
      goBack: vi.fn(),
    });
    await back.settleHandle();

    detach();
    await flush();

    expect(reportFailure).toHaveBeenCalledWith(cause, "native-back-remove");
  });
});

describe("attachNativeBack — the Android OnBackPressedCallback is enabled only while this app listens (George r1 P2-2 on PR 634)", () => {
  it("(j) on Android the handler is enabled once the listener is registered, and disabled again on detach", async () => {
    const back = fakeBack();
    const detach = attachNativeBack(
      back.plugin,
      { decide: decideFor("books", []), goBack: vi.fn() },
      true
    );
    // Not before the native side has the listener — a press in between would
    // reach the plugin's no-listener branch and be swallowed.
    expect(back.toggle).not.toHaveBeenCalled();

    await back.settleHandle();
    await flush();
    expect(back.toggle).toHaveBeenCalledWith({ enabled: true });

    detach();
    await flush();
    expect(back.toggle).toHaveBeenLastCalledWith({ enabled: false });
    expect(back.toggle).toHaveBeenCalledTimes(2);
  });

  it("(j') detached before the handle resolves: disabled on detach, never enabled afterwards", async () => {
    const back = fakeBack();
    const detach = attachNativeBack(
      back.plugin,
      { decide: decideFor("books", []), goBack: vi.fn() },
      true
    );

    detach();
    await back.settleHandle();
    await flush();

    expect(back.toggle).toHaveBeenCalledTimes(1);
    expect(back.toggle).toHaveBeenCalledWith({ enabled: false });
  });

  it("(k) off Android the handler is never touched — iOS's toggleBackButtonHandler is unimplemented", async () => {
    const back = fakeBack();
    const detach = attachNativeBack(back.plugin, {
      decide: decideFor("books", []),
      goBack: vi.fn(),
    });
    await back.settleHandle();
    detach();
    await flush();

    expect(back.toggle).not.toHaveBeenCalled();
  });

  it("(l) a rejected toggle reaches the funnel under its own context", async () => {
    reportFailure.mockClear();
    const back = fakeBack();
    const cause = new Error("onBackPressedCallback is not set");
    back.toggle.mockImplementationOnce(() => Promise.reject(cause));
    attachNativeBack(
      back.plugin,
      { decide: decideFor("books", []), goBack: vi.fn() },
      true
    );
    await back.settleHandle();
    await flush();

    expect(reportFailure).toHaveBeenCalledWith(cause, "native-back-handler");
  });
});

/**
 * The detach's bridge round trip (#674). On Android the detach posts
 * `toggleBackButtonHandler({ enabled: false })`; until the plugin applies it,
 * the `OnBackPressedCallback` is still enabled, so a hardware Back in that
 * window still reaches this listener. The hook has unmounted by then (the
 * crash screen is the reachable case), and its `popstate` router with it, so
 * an in-app `goBack()` would land on nothing: the one outcome that is not a
 * swallow is the one the press gets once the disable lands — the activity
 * default, which leaves. So a press in the window leaves (`exitApp()`), a
 * press after the disable is confirmed is inert (round 2's guarantee for a
 * callback whose `remove()` rejected), and the remove is posted only after
 * the disable has resolved.
 *
 * The mock records every plugin call in order, and holds the disable's
 * promise until the test settles it — that pending promise IS the window.
 * Whether the real bridge delivers a press dispatched before the disable
 * landed ahead of the disable's own resolution is a device question, not
 * one this file can answer.
 */
interface OrderedBack {
  readonly plugin: NativeBackPlugin;
  readonly calls: string[];
  press(canGoBack: boolean): void;
  settleHandle(): Promise<void>;
  /** Resolve the pending `toggleBackButtonHandler({ enabled: false })`. */
  confirmDisable(): Promise<void>;
  /** Reject it instead. */
  refuseDisable(cause: unknown): Promise<void>;
  /** What the next `remove()` returns. */
  readonly removeResult: { next: Promise<void> };
}

function orderedBack(): OrderedBack {
  const calls: string[] = [];
  const listeners: ((event: { canGoBack: boolean }) => void)[] = [];
  let resolveHandle: (() => void) | null = null;
  let settleDisable: ((ok: boolean, cause?: unknown) => void) | null = null;
  const removeResult = { next: Promise.resolve() };
  const handle = new Promise<{ remove: () => Promise<void> }>((resolve) => {
    resolveHandle = () => {
      resolve({
        remove: () => {
          calls.push("remove");
          return removeResult.next;
        },
      });
    };
  });
  return {
    calls,
    removeResult,
    plugin: {
      addListener: (_eventName, fn) => {
        calls.push("addListener");
        listeners.push(fn);
        return handle;
      },
      exitApp: () => {
        calls.push("exitApp");
        return Promise.resolve();
      },
      toggleBackButtonHandler: ({ enabled }) => {
        calls.push(`toggle:${String(enabled)}`);
        if (enabled) return Promise.resolve();
        return new Promise<void>((resolve, reject) => {
          settleDisable = (ok, cause) => {
            if (ok) resolve();
            else reject(cause);
          };
        });
      },
    },
    press(canGoBack) {
      calls.push(`press:${String(canGoBack)}`);
      for (const fn of listeners) fn({ canGoBack });
    },
    async settleHandle() {
      resolveHandle?.();
      await handle;
      await flush();
    },
    async confirmDisable() {
      settleDisable?.(true);
      await flush();
      await flush();
    },
    async refuseDisable(cause) {
      settleDisable?.(false, cause);
      await flush();
      await flush();
    },
  };
}

describe("attachNativeBack — a press inside the detach's disable round trip is never swallowed (#674)", () => {
  it("(n) the disable is posted first; the remove waits until the disable has resolved", async () => {
    const back = orderedBack();
    const detach = attachNativeBack(
      back.plugin,
      { decide: decideFor("segments", []), goBack: vi.fn() },
      true
    );
    await back.settleHandle();

    detach();
    await flush();
    await flush();
    // The disable is in flight; the callback still owns the press.
    expect(back.calls).toEqual(["addListener", "toggle:true", "toggle:false"]);

    await back.confirmDisable();
    expect(back.calls).toEqual([
      "addListener",
      "toggle:true",
      "toggle:false",
      "remove",
    ]);
  });

  it("(o) a press between the disable being posted and it resolving leaves the app — whatever the WebView could pop — and never issues the unrouted in-app Back", async () => {
    const back = orderedBack();
    const goBack = vi.fn();
    const detach = attachNativeBack(
      back.plugin,
      { decide: decideFor("segments", []), goBack },
      true
    );
    await back.settleHandle();

    detach();
    back.press(true);
    back.press(false);
    await back.confirmDisable();

    expect(goBack).not.toHaveBeenCalled();
    expect(back.calls).toEqual([
      "addListener",
      "toggle:true",
      "toggle:false",
      "press:true",
      "exitApp",
      "press:false",
      "exitApp",
      "remove",
    ]);
  });

  it("(p) once the disable has resolved, a press on a callback the plugin failed to remove is inert (round 2's guarantee holds on Android)", async () => {
    reportFailure.mockClear();
    const back = orderedBack();
    const goBack = vi.fn();
    const cause = new Error("handle gone");
    back.removeResult.next = Promise.reject(cause);
    back.removeResult.next.catch(() => undefined);
    const detach = attachNativeBack(
      back.plugin,
      { decide: decideFor("segments", []), goBack },
      true
    );
    await back.settleHandle();
    detach();
    await back.confirmDisable();

    back.press(true);
    back.press(false);

    expect(goBack).not.toHaveBeenCalled();
    expect(back.calls).toContain("remove");
    expect(back.calls).not.toContain("exitApp");
    expect(reportFailure).toHaveBeenCalledWith(cause, "native-back-remove");
  });

  it("(q) a press in the window after a newer attach has begun is inert — never exitApp() beside a live successor", async () => {
    const back = orderedBack();
    const goBack = vi.fn();
    const detach = attachNativeBack(
      back.plugin,
      { decide: decideFor("segments", []), goBack },
      true
    );
    await back.settleHandle();
    detach();

    const successor = fakeBack();
    attachNativeBack(
      successor.plugin,
      { decide: decideFor("segments", []), goBack: vi.fn() },
      true
    );
    back.press(true);
    back.press(false);

    expect(goBack).not.toHaveBeenCalled();
    expect(back.calls).not.toContain("exitApp");
  });

  it("(s) detached before the handle resolved (the handler was never enabled): inert at once, no drain", async () => {
    const back = orderedBack();
    const goBack = vi.fn();
    const detach = attachNativeBack(
      back.plugin,
      { decide: decideFor("segments", []), goBack },
      true
    );

    detach();
    back.press(true);
    back.press(false);
    await back.settleHandle();
    await back.confirmDisable();

    expect(goBack).not.toHaveBeenCalled();
    expect(back.calls).toEqual([
      "addListener",
      "toggle:false",
      "press:true",
      "press:false",
      "remove",
    ]);
  });

  it("(t) off Android there is no handler to disable: inert at once, no drain", async () => {
    const back = orderedBack();
    const goBack = vi.fn();
    const detach = attachNativeBack(back.plugin, {
      decide: decideFor("segments", []),
      goBack,
    });
    await back.settleHandle();

    detach();
    back.press(true);
    back.press(false);

    expect(goBack).not.toHaveBeenCalled();
    expect(back.calls).toEqual([
      "addListener",
      "remove",
      "press:true",
      "press:false",
    ]);
  });

  it("(r) a disable the plugin refuses is reported, and the detach still completes: the remove is posted and the callback goes inert", async () => {
    reportFailure.mockClear();
    const back = orderedBack();
    const goBack = vi.fn();
    const cause = new Error("onBackPressedCallback is not set");
    const detach = attachNativeBack(
      back.plugin,
      { decide: decideFor("segments", []), goBack },
      true
    );
    await back.settleHandle();
    detach();
    await back.refuseDisable(cause);

    back.press(true);

    expect(reportFailure).toHaveBeenCalledWith(cause, "native-back-handler");
    expect(back.calls).toEqual([
      "addListener",
      "toggle:true",
      "toggle:false",
      "remove",
      "press:true",
    ]);
    expect(goBack).not.toHaveBeenCalled();
  });
});
