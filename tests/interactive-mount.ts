import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { vi } from "vitest";

/**
 * The interactive mount pattern #890 item 2 (George r1 on #887) asked for and
 * `recorder-edit-toolbar-glyph.test.ts` introduced: a `react-dom/client` root
 * inside its own jsdom window, `act()`-wrapped — the step up from
 * `./render`'s static harness for behaviour a click drives, not just props.
 * The Vitest environment itself stays `node` (AGENTS.md): this brings its own
 * `window`/`document` rather than swapping the global ones, so `lib/`'s
 * DOM-free boundary is untouched.
 *
 * Pulled out here (#903 item 1) so two test files stop each carrying their
 * own copy of the same jsdom-window-plus-root bookkeeping.
 *
 * Stubs `window`, `document`, `getComputedStyle` (the one bare global
 * `recorder.tsx`'s paste-row probe touches outside `window`/`document`),
 * `HTMLElement` (`use-focus-restore.ts`'s `active instanceof HTMLElement`
 * check, reached once a mounted tree drives a real focus-restore capture —
 * e.g. the record bar's bin, #903 item 1) and `IS_REACT_ACT_ENVIRONMENT` for
 * the lifetime of the mount.
 *
 * Call `teardown()` from `afterEach`, in a try/finally around your own
 * `await act(async () => root.unmount())` — never bare, or an unmount that
 * throws leaves the stubbed globals in place for the next test in the same
 * worker (#907 item 2).
 */
export interface InteractiveMount {
  readonly dom: JSDOM;
  readonly root: Root;
  readonly container: HTMLElement;
  /** Closes the jsdom window and unstubs the globals. Does not unmount the
   *  root — that must happen first, inside your own `act()`. */
  teardown(): void;
}

export function mountInteractive(): InteractiveMount {
  const dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>",
    // A named origin, the same reason `menu-hamburger-header.test.ts` gives
    // one: an opaque jsdom origin trips vitest's failure printer on
    // `localStorage`, turning a red assertion into an unrelated
    // `SecurityError`.
    { url: "http://localhost/" }
  );
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal(
    "getComputedStyle",
    dom.window.getComputedStyle.bind(dom.window)
  );
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  return {
    dom,
    root,
    container,
    teardown() {
      // try/finally: the same leak #907 item 2 closed for the caller's own
      // unmount, one frame down. If `dom.window.close()` throws, the globals
      // this mount stubbed must still be unstubbed, or they leak into the
      // next test in the same worker (#913 item 1).
      try {
        dom.window.close();
      } finally {
        vi.unstubAllGlobals();
      }
    },
  };
}
