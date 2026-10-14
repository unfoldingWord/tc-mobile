// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useNavStack, type UseNavStack } from "@/hooks/use-nav-stack";

/**
 * `hasOpenLayer` (#1014 item 3) is the live read App's phone-check reveal
 * uses to refuse while any screen overlay is registered. It must follow the
 * real layer ref through push and pop, with no render between them.
 */

const held: { nav: UseNavStack | null } = { nav: null };

function Owner(): null {
  const stack = useNavStack({
    hasChapter: false,
    recorderOpen: false,
    recovering: false,
    databasePanel: false,
    chapterClipboardHeld: false,
    getRecorderHandle: () => null,
    onOpenChapter: () => {},
    onOpenRecorder: () => {},
    onLeaveToBooks: () => {},
    onRecorderClosed: () => {},
  });
  useLayoutEffect(() => {
    held.nav = stack;
  }, [stack]);
  return null;
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState(null, "", "/");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  held.nav = null;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("reads true from the push to the pop of a layer, false either side", async () => {
  await act(async () => root.render(createElement(Owner)));
  expect(held.nav!.hasOpenLayer()).toBe(false);
  act(() => {
    held.nav!.pushLayer({ id: "x", busy: () => false, dismiss: () => {} });
  });
  expect(held.nav!.hasOpenLayer()).toBe(true);
  act(() => {
    held.nav!.popLayer("x");
  });
  expect(held.nav!.hasOpenLayer()).toBe(false);
});
