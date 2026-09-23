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
