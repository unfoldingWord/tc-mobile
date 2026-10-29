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

import type { CaptureState, CaptureTest, StyleMap } from "./diff";

/**
 * The capture half of the computed-style diff tool (#954).
 *
 * `e2e/support/test.ts` runs `startCapture` from an automatic fixture when
 * `STYLE_CAPTURE_DIR` is set, and does nothing otherwise. While it is on, the
 * Page, Locator, Keyboard, Mouse and Touchscreen prototypes are wrapped, so
 * every action a spec takes is followed by one snapshot of the page's computed
 * style. The fixture restores the prototypes when the test ends.
 *
 * One snapshot records, for every element under `<html>` except `<head>` and
 * the elements that never render (`script`, `style`, `link`, `meta`,
 * `template`, `noscript`), and for its `::before` and `::after` when they are
 * generated:
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
 * page collapse into one. A capture that throws (the page navigated or
 * closed mid-read) is counted on the test, never raised into it, and the
 * time a capture takes is added back to the test's timeout.
 *
 * Each snapshot waits two animation frames before it reads, so a render the
 * action scheduled has landed. In the test's own context, `crypto.randomUUID`
 * is replaced by a counter kept in `localStorage`, so a new book gets the same
 * id, and so the same id-derived cover colour, in every run. A context a spec
 * opens itself keeps the real one.
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
}

/**
 * Runs inside the page through `page.evaluate`, so it closes over nothing:
 * every helper it needs is declared in its own body.
 */
async function snapshotInPage(arg: { known: string[] }): Promise<PageSnapshot> {
  // Two frames, so a render the action scheduled has committed and been
  // styled before anything is read.
  for (let i = 0; i < 2; i++) {
    await new Promise<void>((done) => requestAnimationFrame(() => done()));
  }
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
  const unrendered = new Set([
    "head",
    "script",
    "style",
    "link",
    "meta",
    "template",
    "noscript",
  ]);
  const visit = (el: Element, path: string): void => {
    pathOf.set(el, path);
    record(path, getComputedStyle(el));
    for (const pseudo of ["::before", "::after"]) {
      const cs = getComputedStyle(el, pseudo);
      const content = cs.getPropertyValue("content");
      if (content !== "none" && content !== "normal") record(path + pseudo, cs);
    }
    // The index counts only the siblings that are kept, so a `<script>` or
    // `<style>` inserted ahead of the app's root does not renumber every
    // element after it.
    let index = 0;
    for (const child of Array.from(el.children)) {
      if (unrendered.has(child.localName)) continue;
      index += 1;
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
  };
}

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

/** Style hashes already on disk in this run, shared by every test in the worker. */
let knownHashes: Set<string> | undefined;
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
  knownHashes ??= new Set(
    readdirSync(stylesDir).map((name) => name.replace(/\.json$/, ""))
  );
  const known = knownHashes;

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
  const lastPrint = new WeakMap<Page, string>();
  const tableIndex = new Map<string, number>();
  const selectorTable: string[] = [];
  const states: CaptureState[] = [];
  let ordinal = 0;
  let pageCount = 0;
  let depth = 0;
  let captureErrors = 0;
  let collapsed = 0;
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
      const snap = await page.evaluate(snapshotInPage, { known: [...known] });
      for (const [h, map] of Object.entries(snap.styles)) {
        if (known.has(h)) continue;
        writeFileSync(join(stylesDir, `${h}.json`), JSON.stringify(map));
        known.add(h);
      }
      for (const s of snap.selectors) runSelectors.add(s);
      const elements = Object.fromEntries(snap.elements);
      const print = digest(JSON.stringify([snap.elements, snap.animated]));
      if (lastPrint.get(page) === print) {
        collapsed += 1;
        return;
      }
      lastPrint.set(page, print);
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
        key: `${String(here).padStart(3, "0")} p${pageIds.get(page) ?? 0} ${action}`,
        url: snap.url,
        elements,
        animated: snap.animated,
        matched,
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
        depth += 1;
        let result: unknown;
        try {
          result = await original.apply(this, args);
        } finally {
          depth -= 1;
        }
        const page = depth === 0 ? pageOf(kind, this) : undefined;
        if (page && !page.isClosed()) await capture(page, `${kind}.${name}`);
        return result;
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
    };
    const testsDir = join(dir, "tests");
    if (!existsSync(testsDir)) mkdirSync(testsDir, { recursive: true });
    writeFileSync(
      join(
        testsDir,
        `${safe(project)}__${safe(title)}__${digest(record.id)}.json`
      ),
      JSON.stringify(record)
    );
    writeFileSync(
      join(dir, "selectors.json"),
      JSON.stringify([...runSelectors].sort())
    );
  };
}
