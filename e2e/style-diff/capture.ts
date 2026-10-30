import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type {
  BrowserContext,
  Keyboard,
  Locator,
  Mouse,
  Page,
  TestInfo,
  Touchscreen,
} from "@playwright/test";

import {
  roundStyle,
  type CaptureState,
  type CaptureTest,
  type StyleMap,
} from "./diff";

/**
 * The capture half of the computed-style diff tool (#954).
 *
 * `e2e/support/test.ts` runs `startCapture` from an automatic fixture when
 * `STYLE_CAPTURE_DIR` is set, and does nothing otherwise. While it is on, the
 * Page, Locator, Keyboard, Mouse and Touchscreen prototypes are wrapped, so
 * every action a spec takes is followed by one snapshot of the page's computed
 * style. The fixture restores the prototypes when the test ends.
 *
 * One snapshot records, for every element under `<html>` except the ones
 * `SKIP` names (`<head>`, the elements that never render, and the launch
 * overlay from `index.html`, which fades out on its own clock), and for its
 * `::before` and `::after` when they are generated:
 *   - its structural path (`html>body[1]>div[1]`, each index counting only the
 *     kept siblings), with no class or attribute in it, so a class rename
 *     keeps the key;
 *   - every property `getComputedStyle` enumerates, plus every custom
 *     property named in a loaded stylesheet, read by name;
 *   - the properties a running animation or transition drives on it, which
 *     the comparator leaves out. Nothing here pauses or seeks an animation.
 * It also records which `@layer components` selectors matched an element.
 *
 * Style maps are stored once each under `styles/<hash>.json`; a test's
 * states refer to them by hash. Two identical captures in a row of the same
 * page collapse into one, and the test's `sameAs` records which kept state
 * each collapsed key repeated, so the comparator can still match it. A
 * capture that throws (the page navigated or closed mid-read) is counted on
 * the test, never raised into it, and the time a capture takes is added back
 * to the test's timeout.
 *
 * Each snapshot first lets the page settle: it waits a frame at a time until,
 * for `SETTLE_QUIET_MS` and at least two frames, no finite animation or
 * transition outside the skipped elements has been running or pending and
 * nothing outside them has mutated the DOM, a skipped element arriving or
 * leaving counting as neither (an action's async work, such as a database
 * write, commits its render on its own clock). An infinite animation
 * (a spinner, a pulse) never ends, so it does not hold the read; the
 * comparator leaves out what it drives, as above. The wait is bounded twice:
 * `SETTLE_MS` for animations, and the shorter `SETTLE_DOM_MS` for a DOM that
 * keeps changing with nothing animating, which is a page on its own clock
 * (audio playing). A longer wait there moves the spec's own timing: a Play
 * that the spec stops after a set time plays on through the wait. When either
 * bound runs out, the state records what was still running or changing, and
 * the comparator reports it as unsettled rather than comparing a
 * mid-transition read.
 *
 * Every value is rounded (`roundStyle` in `diff.ts`) before its map is hashed,
 * so float noise past `PRECISION` places neither makes a new style nor stops
 * two identical captures collapsing.
 *
 * In the test's own context, `crypto.randomUUID` is replaced by a counter kept
 * in `localStorage`, so a new book gets the same id, and so the same
 * id-derived cover colour, in every run. A context a spec opens itself keeps
 * the real one.
 *
 * How to run it, and what the comparator reports, is in
 * `playwright.style-diff.config.ts`.
 */

interface PageSnapshot {
  url: string;
  elements: [string, string][];
  styles: Record<string, StyleMap>;
  animated: Record<string, string[]>;
  selectors: string[];
  matched: string[];
  unsettled: string[];
}

/** Elements left out of a snapshot, with everything under them. */
export interface Skip {
  tags: readonly string[];
  ids: readonly string[];
}

export const SKIP: Skip = {
  tags: ["head", "script", "style", "link", "meta", "template", "noscript"],
  // `index.html`'s launch overlay: the first child of `<body>` until its own
  // fade-out removes it, so with it in the paths every element after it was
  // renumbered depending on when the capture ran.
  ids: ["launch-intro"],
};

/** How long a snapshot waits for animations to settle before reading anyway. */
export const SETTLE_MS = 2000;
/** How long it waits for a DOM still changing with nothing animating. */
export const SETTLE_DOM_MS = 300;
/** How long nothing may animate or mutate before the page counts as settled. */
export const SETTLE_QUIET_MS = 100;

/**
 * The children a path counts, each with its 1-based index among the kept
 * siblings, so a skipped element ahead of the app's root does not renumber
 * the elements after it. Runs in the page as well as in Node, so it closes
 * over nothing.
 */
export function keptChildren<T extends { localName: string; id: string }>(
  children: readonly T[],
  skip: Skip
): [T, number][] {
  const kept: [T, number][] = [];
  for (const child of children) {
    if (skip.tags.includes(child.localName) || skip.ids.includes(child.id)) {
      continue;
    }
    kept.push([child, kept.length + 1]);
  }
  return kept;
}

/**
 * Whether an animation holds a snapshot back: one that is running or about
 * to, and ends. Runs in the page as well as in Node, so it closes over
 * nothing.
 */
export function blocksSettle(timing: {
  playState: string;
  pending: boolean;
  endTime: number;
}): boolean {
  const live = timing.playState === "running" || timing.pending;
  return live && Number.isFinite(timing.endTime);
}

/**
 * Whether a mutation record holds a snapshot back: one whose target is outside
 * the skipped elements and that is not only a skipped element being added or
 * removed. The launch overlay leaves by its parent `<body>` losing a child, so
 * a check on the target alone counted its exit as the page changing. Runs in
 * the page as well as in Node, so it closes over nothing.
 */
export function countsAsChange<N>(
  record: {
    target: N;
    addedNodes: ArrayLike<N>;
    removedNodes: ArrayLike<N>;
  },
  skipped: (node: N) => boolean
): boolean {
  if (skipped(record.target)) return false;
  const moved = [
    ...Array.from(record.addedNodes),
    ...Array.from(record.removedNodes),
  ];
  return moved.length === 0 || !moved.every(skipped);
}

/**
 * What one frame of the settle wait decides, from how long ago the page was
 * last busy (an animation ran, or the DOM changed), how long ago an animation
 * last ran, and how long the wait has gone on: read now, keep waiting, or stop
 * at one of the two bounds. Runs in the page as well as in Node, so it closes
 * over nothing.
 */
export function settleVerdict(
  clock: {
    frames: number;
    elapsed: number;
    sinceBusy: number;
    sinceAnimated: number;
  },
  bounds: { quietMs: number; domMs: number; settleMs: number }
): "wait" | "settled" | "dom bound" | "animation bound" {
  if (clock.frames >= 2 && clock.sinceBusy >= bounds.quietMs) return "settled";
  const stillAnimating = clock.sinceAnimated < bounds.quietMs;
  if (!stillAnimating && clock.elapsed > bounds.domMs) return "dom bound";
  if (clock.elapsed > bounds.settleMs) return "animation bound";
  return "wait";
}

/**
 * What an unsettled state records: the animations still running, sorted, and
 * whether the DOM changed inside the quiet window. Never empty: the window can
 * have been reset by an animation that has since ended, with nothing running
 * at the bound. Runs in the page as well as in Node, so it closes over
 * nothing.
 */
export function unsettledReasons(
  sinceMutation: number,
  running: readonly string[],
  quietMs: number
): string[] {
  return [
    ...(sinceMutation < quietMs
      ? ["DOM still changing"]
      : running.length === 0
        ? ["an animation ended inside the quiet window"]
        : []),
    ...running,
  ].sort();
}

/**
 * Runs inside the page, so it closes over nothing: `keptChildren`,
 * `blocksSettle`, `countsAsChange`, `settleVerdict` and `unsettledReasons`
 * are passed in as source (`snapshotExpression`), and every other helper is
 * declared in its own body.
 */
async function snapshotInPage(
  arg: {
    known: string[];
    skip: Skip;
    settleMs: number;
    domMs: number;
    quietMs: number;
  },
  kept: typeof keptChildren,
  blocks: typeof blocksSettle,
  counts: typeof countsAsChange,
  verdictOf: typeof settleVerdict,
  reasonsOf: typeof unsettledReasons
): Promise<PageSnapshot> {
  // A frame, or 100 ms if frames have stopped, so the bound below holds. The
  // timeout is kept on purpose (#1780): a page whose frames stop (a hidden or
  // backgrounded one) runs no `requestAnimationFrame` callback, and without
  // the timeout this wait would never return, so the capture would hang the
  // test instead of recording the state as unsettled at a bound. While frames
  // run, the frame resolves first and the timeout does nothing.
  const frame = () =>
    new Promise<void>((done) => {
      requestAnimationFrame(() => done());
      setTimeout(done, 100);
    });
  const skipSelector = arg.skip.ids.map((id) => `#${CSS.escape(id)}`).join(",");
  const watched = (animation: Animation): boolean => {
    const effect = animation.effect as KeyframeEffect | null;
    const target = effect?.target;
    if (!effect || !target || !target.isConnected) return false;
    if (skipSelector !== "" && target.closest(skipSelector)) return false;
    return blocks({
      playState: animation.playState,
      pending: animation.pending,
      endTime: Number(effect.getComputedTiming().endTime ?? Infinity),
    });
  };
  const skipped = (node: Node): boolean => {
    if (skipSelector === "") return false;
    const el = node instanceof Element ? node : node.parentElement;
    return el?.closest(skipSelector) != null;
  };
  // Mutations outside the skipped elements since the last frame.
  let mutated = 0;
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (counts(record, skipped)) mutated += 1;
    }
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  const started = performance.now();
  let busySince = started;
  let animatedSince = started;
  let frames = 0;
  let running: Animation[] = [];
  let lastMutation = -Infinity;
  let verdict: ReturnType<typeof settleVerdict> = "wait";
  while (verdict === "wait") {
    await frame();
    frames += 1;
    const now = performance.now();
    running = document.getAnimations().filter(watched);
    if (mutated > 0) lastMutation = now;
    if (running.length > 0 || mutated > 0) busySince = now;
    if (running.length > 0) animatedSince = now;
    mutated = 0;
    verdict = verdictOf(
      {
        frames,
        elapsed: now - started,
        sinceBusy: now - busySince,
        sinceAnimated: now - animatedSince,
      },
      arg
    );
  }
  observer.disconnect();
  const unsettled =
    verdict === "settled"
      ? []
      : reasonsOf(
          performance.now() - lastMutation,
          running.map((animation) => {
            const effect = animation.effect as KeyframeEffect;
            const el = effect.target as Element;
            const name =
              animation instanceof CSSAnimation
                ? animation.animationName
                : animation instanceof CSSTransition
                  ? `transition ${animation.transitionProperty}`
                  : "animation";
            return `${el.localName}${el.id ? `#${el.id}` : ""}${effect.pseudoElement ?? ""} ${name}`;
          }),
          arg.quietMs
        );

  const known = new Set(arg.known);
  const hash = (text: string): string => {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (
      (h2 >>> 0).toString(16).padStart(8, "0") +
      (h1 >>> 0).toString(16).padStart(8, "0")
    );
  };

  const customNames = new Set<string>();
  const selectors = new Set<string>();
  const walk = (rules: CSSRuleList, inComponents: boolean): void => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule) {
        for (let i = 0; i < rule.style.length; i++) {
          const name = rule.style[i];
          if (name?.startsWith("--")) customNames.add(name);
        }
        if (inComponents) selectors.add(rule.selectorText);
        if (rule.cssRules.length > 0) walk(rule.cssRules, inComponents);
      } else if (rule instanceof CSSLayerBlockRule) {
        const layer = rule.name;
        walk(
          rule.cssRules,
          inComponents ||
            layer === "components" ||
            layer.startsWith("components.")
        );
      } else if ("cssRules" in rule) {
        walk((rule as CSSGroupingRule).cssRules, inComponents);
      }
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      walk(sheet.cssRules, false);
    } catch {
      // A cross-origin sheet refuses `cssRules`; the app ships none, and one
      // that did would only lose its custom-property names and selectors.
    }
  }

  const styles: Record<string, StyleMap> = {};
  const elements: [string, string][] = [];
  const pathOf = new Map<Element, string>();
  const record = (path: string, cs: CSSStyleDeclaration): void => {
    const map: StyleMap = {};
    for (let i = 0; i < cs.length; i++) {
      const name = cs[i];
      if (name !== undefined) map[name] = cs.getPropertyValue(name);
    }
    for (const name of customNames) {
      if (name in map) continue;
      const value = cs.getPropertyValue(name);
      if (value !== "") map[name] = value;
    }
    const sorted: StyleMap = {};
    for (const key of Object.keys(map).sort()) sorted[key] = map[key] ?? "";
    const h = hash(JSON.stringify(sorted));
    if (!known.has(h)) styles[h] = sorted;
    elements.push([path, h]);
  };
  const visit = (el: Element, path: string): void => {
    pathOf.set(el, path);
    record(path, getComputedStyle(el));
    for (const pseudo of ["::before", "::after"]) {
      const cs = getComputedStyle(el, pseudo);
      const content = cs.getPropertyValue("content");
      if (content !== "none" && content !== "normal") record(path + pseudo, cs);
    }
    for (const [child, index] of kept(Array.from(el.children), arg.skip)) {
      visit(child, `${path}>${child.localName}[${index}]`);
    }
  };
  visit(document.documentElement, "html");

  const animated: Record<string, string[]> = {};
  const bookkeeping = new Set([
    "offset",
    "computedOffset",
    "easing",
    "composite",
  ]);
  for (const animation of document.getAnimations()) {
    const effect = animation.effect as KeyframeEffect | null;
    const target = effect?.target;
    if (!effect || !target) continue;
    const base = pathOf.get(target);
    if (base === undefined) continue;
    const key = base + (effect.pseudoElement ?? "");
    const props = new Set(animated[key] ?? []);
    if (
      typeof CSSTransition !== "undefined" &&
      animation instanceof CSSTransition
    ) {
      props.add(animation.transitionProperty);
    } else {
      for (const frame of effect.getKeyframes()) {
        for (const name of Object.keys(frame)) {
          if (bookkeeping.has(name)) continue;
          if (name.startsWith("--")) props.add(name);
          else if (name === "cssFloat") props.add("float");
          else props.add(name.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`));
        }
      }
    }
    animated[key] = [...props].sort();
  }

  const pseudoElement =
    /::?(before|after|marker|placeholder|selection|backdrop|first-line|first-letter|file-selector-button|-webkit-[\w-]+|-moz-[\w-]+)/g;
  const matched: string[] = [];
  for (const selector of selectors) {
    const probe = selector.replace(pseudoElement, "");
    if (probe.trim() === "") continue;
    try {
      if (document.querySelector(probe)) matched.push(selector);
    } catch {
      // A selector the engine cannot query (a nested `&` rule) counts as
      // unmatched, which is the honest reading of "not seen covered".
    }
  }

  return {
    url: location.pathname + location.search + location.hash,
    elements,
    styles,
    animated,
    selectors: [...selectors],
    matched,
    unsettled,
  };
}

/**
 * `snapshotInPage` as one expression, with its shared helpers passed in as
 * source: `page.evaluate` sends a function's text, so a helper it merely
 * referenced would not exist in the page.
 */
const snapshotExpression = (known: string[]) =>
  `(${snapshotInPage.toString()})(${JSON.stringify({
    known,
    skip: SKIP,
    settleMs: SETTLE_MS,
    domMs: SETTLE_DOM_MS,
    quietMs: SETTLE_QUIET_MS,
  })}, ${[keptChildren, blocksSettle, countsAsChange, settleVerdict, unsettledReasons].map((fn) => fn.toString()).join(", ")})`;

/**
 * An init script: `crypto.randomUUID` from a per-origin counter, so ids (and
 * the cover colour a book's id picks) repeat run to run. The counter lives in
 * `localStorage` so a reload or a second page of the same origin carries on
 * from it rather than handing out an id already in IndexedDB.
 */
function deterministicUuid(): void {
  const KEY = "__styleCaptureUuid";
  const next = (): string => {
    let n = 0;
    try {
      n = Number(localStorage.getItem(KEY) ?? "0") + 1;
      localStorage.setItem(KEY, String(n));
    } catch {
      // No storage on this page (about:blank, an opaque origin): the counter
      // restarts, which is harmless there because nothing is stored either.
    }
    let h = 0x811c9dc5 ^ n;
    let hex = "";
    while (hex.length < 32) {
      h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) ^ n;
      hex += (h >>> 0).toString(16).padStart(8, "0");
    }
    const v = hex.slice(0, 32).split("");
    v[12] = "4";
    v[16] = "89ab"[parseInt(v[16] ?? "0", 16) % 4] ?? "8";
    const s = v.join("");
    return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
  };
  Object.defineProperty(crypto, "randomUUID", {
    configurable: true,
    value: next,
  });
}

const PAGE_ACTIONS = [
  "goto",
  "reload",
  "goBack",
  "goForward",
  "setContent",
  "click",
  "dblclick",
  "tap",
  "fill",
  "press",
  "type",
  "check",
  "uncheck",
  "setChecked",
  "selectOption",
  "hover",
  "focus",
  "dragAndDrop",
  "dispatchEvent",
  "setInputFiles",
  "setViewportSize",
  "emulateMedia",
] as const;
const LOCATOR_ACTIONS = [
  "click",
  "dblclick",
  "tap",
  "fill",
  "clear",
  "press",
  "pressSequentially",
  "type",
  "check",
  "uncheck",
  "setChecked",
  "selectOption",
  "selectText",
  "hover",
  "focus",
  "blur",
  "dragTo",
  "dispatchEvent",
  "setInputFiles",
  "scrollIntoViewIfNeeded",
] as const;
const KEYBOARD_ACTIONS = ["press", "type", "down", "up", "insertText"] as const;
const MOUSE_ACTIONS = [
  "click",
  "dblclick",
  "down",
  "up",
  "move",
  "wheel",
] as const;
const TOUCH_ACTIONS = ["tap"] as const;

type AnyFn = (...args: unknown[]) => Promise<unknown>;
type Owner = Keyboard | Mouse | Touchscreen;

/**
 * In this worker: the page's hash of a raw style map to the hash of that map
 * rounded, which is the name it is stored under. The page skips sending a map
 * whose raw hash is a key here.
 */
const roundedOf = new Map<string, string>();
/** Rounded style hashes already on disk in this run. */
let storedHashes: Set<string> | undefined;
/** Every `@layer components` selector seen in this run. */
const runSelectors = new Set<string>();

const safe = (text: string) =>
  text
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);

const digest = (text: string) =>
  createHash("sha1").update(text).digest("hex").slice(0, 10);

/**
 * Tells a nested action from a second top-level one. A wrapped action that
 * another wrapped action calls (`locator.click` calling `mouse.click`) is
 * nested and takes no capture of its own.
 */
export function trackNesting() {
  const inside = new AsyncLocalStorage<true>();
  return async <T>(
    action: () => Promise<T>
  ): Promise<{ value: T; topLevel: boolean }> => {
    // The store follows the async chain, so a call made inside `action` sees
    // it and a second action started beside this one does not.
    const topLevel = inside.getStore() === undefined;
    const value = await (topLevel ? inside.run(true, action) : action());
    return { value, topLevel };
  };
}

/**
 * Writes one test's capture file. The file name is a digest of the id, so a
 * second test with the same id would overwrite the first and the run would
 * read as complete.
 */
export function writeCaptureTest(testsDir: string, record: CaptureTest): void {
  if (!existsSync(testsDir)) mkdirSync(testsDir, { recursive: true });
  const file = join(
    testsDir,
    `${safe(record.project)}__${safe(record.title)}__${digest(record.id)}.json`
  );
  if (existsSync(file)) throw new Error(`capture id collision: ${record.id}`);
  writeFileSync(file, JSON.stringify(record));
}

/**
 * Wraps the action prototypes for one test and returns its teardown, which
 * captures every open page once more ("end"), restores the prototypes and
 * writes the test's file.
 */
export async function startCapture(
  dir: string,
  context: BrowserContext,
  testInfo: TestInfo
): Promise<() => Promise<void>> {
  const stylesDir = join(dir, "styles");
  mkdirSync(stylesDir, { recursive: true });
  storedHashes ??= new Set(
    readdirSync(stylesDir).map((name) => name.replace(/\.json$/, ""))
  );
  const stored = storedHashes;

  const browser = context.browser();
  if (!browser) throw new Error("style capture needs a launched browser");
  await context.addInitScript(deterministicUuid);
  const probeContext = await browser.newContext();
  const probePage = await probeContext.newPage();
  const prototypes: [object, readonly string[], string][] = [
    [Object.getPrototypeOf(probePage) as object, PAGE_ACTIONS, "page"],
    [
      Object.getPrototypeOf(probePage.locator("html")) as object,
      LOCATOR_ACTIONS,
      "locator",
    ],
    [
      Object.getPrototypeOf(probePage.keyboard) as object,
      KEYBOARD_ACTIONS,
      "keyboard",
    ],
    [Object.getPrototypeOf(probePage.mouse) as object, MOUSE_ACTIONS, "mouse"],
    [
      Object.getPrototypeOf(probePage.touchscreen) as object,
      TOUCH_ACTIONS,
      "touchscreen",
    ],
  ];
  await probeContext.close();

  const owners = new WeakMap<Owner, Page>();
  const pageIds = new WeakMap<Page, number>();
  const lastPrint = new WeakMap<Page, { print: string; key: string }>();
  const tableIndex = new Map<string, number>();
  const selectorTable: string[] = [];
  const states: CaptureState[] = [];
  let ordinal = 0;
  let pageCount = 0;
  const nesting = trackNesting();
  let captureErrors = 0;
  let collapsed = 0;
  const sameAs: Record<string, string> = {};
  const errorSamples: string[] = [];

  const register = (page: Page): Page => {
    if (!pageIds.has(page)) pageIds.set(page, pageCount++);
    owners.set(page.keyboard, page);
    owners.set(page.mouse, page);
    owners.set(page.touchscreen, page);
    return page;
  };
  for (const ctx of browser.contexts())
    for (const page of ctx.pages()) register(page);

  const capture = async (page: Page, action: string): Promise<void> => {
    ordinal += 1;
    const here = ordinal;
    const started = Date.now();
    try {
      const snap = await page.evaluate<PageSnapshot>(
        snapshotExpression([...roundedOf.keys()])
      );
      for (const [raw, map] of Object.entries(snap.styles)) {
        const text = JSON.stringify(roundStyle(map));
        const h = createHash("sha1").update(text).digest("hex").slice(0, 16);
        roundedOf.set(raw, h);
        if (stored.has(h)) continue;
        writeFileSync(join(stylesDir, `${h}.json`), text);
        stored.add(h);
      }
      for (const s of snap.selectors) runSelectors.add(s);
      const elements = Object.fromEntries(
        snap.elements.map(([path, raw]) => {
          const h = roundedOf.get(raw);
          if (h === undefined) throw new Error(`page sent no style for ${raw}`);
          return [path, h];
        })
      );
      const print = digest(
        JSON.stringify([elements, snap.animated, snap.unsettled])
      );
      const key = `${String(here).padStart(3, "0")} p${pageIds.get(page) ?? 0} ${action}`;
      const last = lastPrint.get(page);
      if (last?.print === print) {
        collapsed += 1;
        sameAs[key] = last.key;
        return;
      }
      lastPrint.set(page, { print, key });
      const matched = snap.matched.map((s) => {
        let i = tableIndex.get(s);
        if (i === undefined) {
          i = selectorTable.length;
          selectorTable.push(s);
          tableIndex.set(s, i);
        }
        return i;
      });
      states.push({
        key,
        url: snap.url,
        elements,
        animated: snap.animated,
        matched,
        ...(snap.unsettled.length > 0 ? { unsettled: snap.unsettled } : {}),
      });
    } catch (cause) {
      captureErrors += 1;
      if (errorSamples.length < 5) {
        errorSamples.push(`${here} ${action}: ${String(cause).split("\n")[0]}`);
      }
    } finally {
      testInfo.setTimeout(testInfo.timeout + (Date.now() - started));
    }
  };

  const pageOf = (kind: string, self: unknown): Page | undefined => {
    if (kind === "page") return register(self as Page);
    if (kind === "locator") return register((self as Locator).page());
    return owners.get(self as Owner);
  };

  const restore: (() => void)[] = [];
  for (const [proto, names, kind] of prototypes) {
    const target = proto as Record<string, AnyFn>;
    for (const name of names) {
      const original = target[name];
      if (typeof original !== "function") continue;
      target[name] = async function wrapped(this: unknown, ...args: unknown[]) {
        const { value, topLevel } = await nesting(() =>
          original.apply(this, args)
        );
        const page = topLevel ? pageOf(kind, this) : undefined;
        if (page && !page.isClosed()) await capture(page, `${kind}.${name}`);
        return value;
      };
      restore.push(() => {
        target[name] = original;
      });
    }
  }

  return async () => {
    for (const fn of restore) fn();
    for (const ctx of browser.contexts()) {
      for (const page of ctx.pages()) {
        if (!page.isClosed()) await capture(register(page), "end");
      }
    }
    const title = testInfo.titlePath.slice(1).join(" › ");
    const spec = testInfo.titlePath[0] ?? testInfo.file;
    const project = testInfo.project.name;
    const record: CaptureTest = {
      id: `${project} | ${title}${testInfo.retry ? ` | retry ${testInfo.retry}` : ""}`,
      project,
      spec,
      title,
      status: testInfo.status ?? "unknown",
      expectedStatus: testInfo.expectedStatus,
      captureErrors,
      errorSamples,
      collapsed,
      selectors: selectorTable,
      states,
      sameAs,
    };
    writeCaptureTest(join(dir, "tests"), record);
    writeFileSync(
      join(dir, "selectors.json"),
      JSON.stringify([...runSelectors].sort())
    );
  };
}
