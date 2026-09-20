import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  THEME_STORAGE_KEY,
  nextTheme,
  readStoredTheme,
  type Theme,
} from "@/lib/theme";

/**
 * The theme decision (#171), as a table rather than a phone.
 *
 * A complete light theme has existed in `2-semantic.css` since the pivot and
 * nothing could ever select it: `grep -rn "data-theme" src --include=*.ts*`
 * returned nothing. The theme was written because direct equatorial sun makes
 * the dark screen unreadable, so the condition it was written for was
 * unaddressed while its maintenance cost was already being paid.
 *
 * This module is the pure half. The DOM half — setting the attribute, reading
 * `localStorage`, repainting the `theme-color` meta — is `hooks/use-theme.ts`,
 * and it is NOT uncovered: `e2e/theme-toggle.spec.ts` drives it in real
 * Chromium against the shipped build, including the failing-write path. An
 * earlier draft of this header said it was covered "nowhere", which was wrong
 * in the same PR that added that spec (QA review, #457).
 *
 * What genuinely remains uncovered is narrower: `readTheme`'s throw-on-READ
 * catch, `applyTheme`'s empty-token early return, and everything about a real
 * phone (#245). See that hook's own docblock, which splits the three.
 */
describe("readStoredTheme (#171)", () => {
  it("returns the stored theme when it is one this app has", () => {
    expect(readStoredTheme("light")).toBe("light");
    expect(readStoredTheme("dark")).toBe("dark");
  });

  it("defaults to dark when nothing has been chosen", () => {
    // `2-semantic.css`'s own header: "The app ships dark by default: it is
    // used in low light, on battery, and a theme switch is a decision nobody
    // in a workshop should have to make."
    expect(readStoredTheme(null)).toBe("dark");
  });

  it("defaults to dark on anything else, rather than trusting the string", () => {
    // `localStorage` is shared per-origin and survives an uninstall of the
    // PWA's data on some engines; a value this app never wrote must not reach
    // `data-theme`, where it would select NEITHER token block and paint an
    // unstyled screen — every role would fall back to nothing.
    for (const raw of ["", " ", "LIGHT", "Dark", "sepia", "null", "{}", "0"])
      expect(readStoredTheme(raw), `readStoredTheme(${raw})`).toBe("dark");
  });

  it("does not follow prefers-color-scheme, and cannot", () => {
    // Recorded as a DECISION, not an omission. #171 offered mapping the OS
    // setting or a persisted toggle, and argued the toggle: these are shared
    // phones handed out by a facilitator, so the OS setting is not the
    // translator's to change — and the one who needs light is the one standing
    // in the sun, not the one whose phone was configured that way. The
    // signature is the enforcement: this takes a stored string and nothing
    // else, so an OS read cannot be smuggled in without changing it.
    expect(readStoredTheme.length).toBe(1);
  });
});

describe("nextTheme (#171)", () => {
  it("is an involution — two taps return you to where you were", () => {
    // The toggle is ONE control with no label a non-reader can check against,
    // so its only guarantee is that tapping twice undoes it. A third state
    // (an "auto") would break that and is why there is not one.
    for (const t of ["dark", "light"] as const)
      expect(nextTheme(nextTheme(t))).toBe(t);
  });

  it("swaps the two themes", () => {
    expect(nextTheme("dark")).toBe("light");
    expect(nextTheme("light")).toBe("dark");
  });

  it("covers every theme in the union", () => {
    // If a third theme is ever added, `nextTheme` must be revisited rather
    // than silently cycling two of three. This fails at compile time via the
    // exhaustive switch, and at runtime here.
    const themes: Theme[] = ["dark", "light"];
    expect(new Set(themes.map(nextTheme))).toEqual(new Set(themes));
  });
});

describe("THEME_STORAGE_KEY (#171)", () => {
  it("is namespaced, so it cannot collide on a shared origin", () => {
    expect(THEME_STORAGE_KEY).toMatch(/^tc-mobile[.:]/);
  });
});

/**
 * The reachability half (#171).
 *
 * The defect was never that the light theme was wrong — it was complete and
 * correct in `2-semantic.css`. The defect was that `grep -rn "data-theme" src
 * --include=*.ts --include=*.tsx` returned NOTHING, so no code path could ever
 * select it. A table over `readStoredTheme` and `nextTheme` would pass in full
 * with the hook deleted and the toggle never mounted, which is exactly the
 * shape AGENTS.md warns about: a test that proves the pure core while the
 * boundary it exists for is missing.
 *
 * So this asserts the chain end to end in source: the attribute is written,
 * the stylesheet has a block keyed on it, the toggle is mounted in the global
 * menu, and the theme is applied before React renders. Source-shape, not
 * behaviour — there is no DOM runner (#197) and none of this has been seen on
 * a phone.
 */
describe("the light theme is reachable (#171)", () => {
  const read = (rel: string) =>
    readFileSync(path.resolve(import.meta.dirname, "..", rel), "utf8");

  /**
   * The global menu's opening tag, matched by the props this file is actually
   * about — `open={menuOpen}` and a close handler of some kind — rather than by
   * one exact expression. The two cases below both need to FIND that tag; what
   * they assert is what is inside it.
   */
  const GLOBAL_MENU_OPEN_TAG = String.raw`<Menu open=\{menuOpen\} onClose=\{[^}]*\}>`;

  it("something in src actually writes data-theme", () => {
    // The literal grep from #171's evidence, which returned no hits.
    const hits = ["src/hooks/use-theme.ts", "src/lib/theme.ts"]
      .map(read)
      .filter((source) => source.includes("data-theme"));
    expect(hits.length).toBeGreaterThan(0);
    expect(read("src/hooks/use-theme.ts")).toMatch(
      /setAttribute\(\s*["']data-theme["']/
    );
  });

  it("the stylesheet still has a block keyed on that attribute", () => {
    // If layer 2's light block is ever renamed or dropped, the hook above
    // starts setting an attribute nothing reads — reachable in name only.
    expect(read("src/app/styles/2-semantic.css")).toMatch(
      /:root\[data-theme="light"\]\s*\{/
    );
    expect(read("src/app/styles/2-semantic.css")).toMatch(
      /:root\[data-theme="dark"\]/
    );
  });

  it("the toggle is mounted in the global menu, not just written", () => {
    // The hook could exist and be called by nothing. `books-screen.tsx` holds
    // the only global menu (its reachability from the Segments screen is a
    // separate question, #149).
    const screen = read("src/components/books-screen.tsx");
    expect(screen).toMatch(/useTheme\(\)/);
    expect(screen).toMatch(/onClick=\{theme\.toggle\}/);
    // A `<Menu>` with CHILDREN — before this it was a self-closing empty panel.
    //
    // The close handler is matched loosely on purpose (#452 PR3): it was the
    // inline `() => setMenuOpen(false)` until the global menu became a Back
    // layer, at which point opening and closing it had to go through ONE named
    // pair so no call site could forget the registration. Pinning the exact
    // expression made this assertion a tripwire for any refactor of that
    // handler rather than for the thing it is about — that the panel has
    // children.
    expect(screen).toMatch(new RegExp(GLOBAL_MENU_OPEN_TAG));
  });

  it("sits AFTER the failure-log panel, so ≡-with-failures lands on the report", () => {
    // `Menu` focuses its first actionable child on open (`menu.tsx`). While
    // the log is non-empty the ≡ is named "Open menu. N problems recorded."
    // and its whole point is reaching the report — so the toggle, which is
    // unconditional, must not be the first child in front of the panel, or a
    // switch/AT user who activates what they landed on flips the theme
    // instead (George R1 P2 on #457). The panel is mounted only while
    // `failureCount > 0`, so on a quiet phone the toggle is still first.
    const screen = read("src/components/books-screen.tsx");
    const menu = screen.search(new RegExp(GLOBAL_MENU_OPEN_TAG));
    expect(menu).toBeGreaterThan(-1);
    const body = screen.slice(menu);
    const panel = body.indexOf("<FailureLogPanel");
    const toggle = body.indexOf("onClick={theme.toggle}");
    expect(panel, "FailureLogPanel is not in the global menu").toBeGreaterThan(
      -1
    );
    expect(toggle, "the toggle is not in the global menu").toBeGreaterThan(-1);
    expect(
      panel,
      "the theme toggle is mounted ahead of the failure-log panel"
    ).toBeLessThan(toggle);
  });

  it("is applied before React renders, not in an effect", () => {
    // An effect runs after the first paint: a translator who chose light would
    // see a dark frame on every launch. The call must sit above `createRoot`.
    const main = read("src/app/main.tsx");
    const install = main.indexOf("installStoredTheme()");
    const render = main.indexOf("createRoot(");
    expect(
      install,
      "installStoredTheme() is not called in main.tsx"
    ).toBeGreaterThan(-1);
    expect(render).toBeGreaterThan(install);
  });

  it("the theme-color meta is repainted from the token, not a second hex", () => {
    // `index.html` hard-coded `#0b0f14` — which had ALREADY drifted from
    // `--s-floor` (#0b1016) — so a light-theme user kept a dark status bar over
    // a white screen. Reading the computed token is what keeps the OS chrome
    // and the body the same colour by construction.
    const hook = read("src/hooks/use-theme.ts");
    expect(hook).toMatch(/getPropertyValue\(["']--s-floor["']\)/);
    expect(hook).toMatch(/meta\[name="theme-color"\]/);
    // And no second copy of a floor hex in the CODE to drift out of step. The
    // comments name the old drifted pair on purpose, as the record of why this
    // reads a token — so they are stripped rather than matched.
    const code = hook
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/#[0-9a-f]{6}/i);
  });

  it("the manifest's dark hex is the floor token, not a third value", () => {
    // The manifest is read at INSTALL time and cannot follow a runtime switch,
    // so it necessarily stays dark — but it was #0b0f14, a value no token in
    // this app has ever had, so the splash and the task-switcher tint were two
    // units off the floor the body paints. Pinned to the primitive rather than
    // to a literal, so the two cannot drift apart again.
    const floor = /--p-cool-950:\s*(#[0-9a-f]{6})/i.exec(
      read("src/app/styles/1-primitives.css")
    );
    expect(floor?.[1], "no --p-cool-950 primitive found").toBeTruthy();
    const config = read("vite.config.ts");
    expect(config).toContain(`theme_color: "${floor![1]}"`);
    expect(config).toContain(`background_color: "${floor![1]}"`);
  });

  it("index.html's own theme-color is the floor token too, for the pre-JS bar", () => {
    // The manifest was moved onto the token; the document the browser reads
    // FIRST was not, so until `installStoredTheme` ran the OS chrome was still
    // `#0b0f14` — a value no token has ever had, the drift this lane exists to
    // close (George R2 P3 on #457). Same pin as the manifest, same primitive.
    const floor = /--p-cool-950:\s*(#[0-9a-f]{6})/i.exec(
      read("src/app/styles/1-primitives.css")
    );
    expect(floor?.[1], "no --p-cool-950 primitive found").toBeTruthy();
    const html = read("index.html");
    const meta = /<meta\s+name="theme-color"\s+content="(#[0-9a-f]{6})"/i.exec(
      html
    );
    expect(meta?.[1], "no theme-color meta in index.html").toBeTruthy();
    expect((meta?.[1] ?? "").toLowerCase()).toBe(
      (floor?.[1] ?? "").toLowerCase()
    );
  });

  it("the toggle applies the theme IN the gesture, before any subscriber renders", () => {
    // `toggle` moves the live store first and React re-renders in the click:
    // the control already shows the moon and the "dark screen" label. If
    // `applyTheme` ran only in `useEffect`, the browser could paint one frame
    // of the new chrome on the still-dark `data-theme` — the same flash class
    // `installStoredTheme` refuses on launch, now on the gesture the light
    // theme exists for (George R2 P2 on #457). So the attribute and the store
    // must move together: `setLiveTheme` applies BEFORE it notifies, and the
    // effect is left as a mount-time reconcile only.
    //
    // Source-shape, not behaviour: there is no DOM runner in the Node suite
    // (#197) and no way to render the hook and observe the attribute between
    // the store write and the subscriber's render. `e2e/theme-toggle.spec.ts`
    // waits on the attribute, so it cannot see an intermediate frame either.
    const hook = read("src/hooks/use-theme.ts");
    const setter = /function setLiveTheme\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(
      hook
    );
    expect(setter?.[1], "no setLiveTheme in use-theme.ts").toBeTruthy();
    const body = setter?.[1] ?? "";
    const apply = body.indexOf("applyTheme(");
    const notify = body.indexOf("listener()");
    expect(apply, "setLiveTheme does not call applyTheme").toBeGreaterThan(-1);
    expect(notify, "setLiveTheme does not notify listeners").toBeGreaterThan(
      -1
    );
    expect(
      apply,
      "applyTheme runs after the listeners are notified"
    ).toBeLessThan(notify);
    // Ordering alone is not enough: an `applyTheme(next)` that appears before
    // the loop but is DEFERRED — wrapped in `queueMicrotask`, `setTimeout`,
    // `requestAnimationFrame` or a `.then` — passes the index check above and
    // still lets the subscriber render on the old attribute. So the call must
    // be a bare, synchronous statement of the setter's body: the line is
    // nothing but `applyTheme(next);` (panel P3 on #457).
    expect(
      body,
      "applyTheme(next) is not a bare synchronous statement in setLiveTheme"
    ).toMatch(/^\s*applyTheme\(next\);\s*$/m);
    // And the toggle still goes through that setter, not around it.
    expect(hook).toMatch(/setLiveTheme\(next\)/);
  });

  it("both canvases re-draw on a theme change, not only on their own props", () => {
    // A canvas painted once cannot observe a CSS-variable change — which is
    // exactly why `finished` sits in `Waveform`'s draw deps. `data-theme` is
    // a CSS-variable change of the same class (`--c-wave-stroke`, `--s-voice`,
    // `--s-ink-faint`). Today `useTheme` is Books-only and `App` renders Books
    // XOR Segments, so a toggle unmounts every canvas — but the moment the
    // toggle is reachable from a screen with a `Waveform` or `LiveScope`
    // mounted (#149), the bars keep the previous theme's amber/faint until
    // `peaks`/`finished`/`active` happen to change (George R2 P2 on #457).
    // So both draw effects subscribe to the live theme and list it.
    const hook = read("src/hooks/use-theme.ts");
    expect(hook).toMatch(/export function useLiveTheme\(\)/);
    for (const rel of [
      "src/components/waveform.tsx",
      "src/components/live-scope.tsx",
    ]) {
      const source = read(rel);
      expect(source, `${rel} does not subscribe to the live theme`).toMatch(
        /useLiveTheme\(\)/
      );
      // The dep is `theme`, in the array of the one `useLayoutEffect` that
      // draws — the only `useLayoutEffect` in either file.
      const draw =
        /useLayoutEffect\(\(\) => \{[\s\S]*?\n  \}, \[([^\]]*)\]\);/.exec(
          source
        );
      expect(draw?.[1], `${rel}: no draw effect deps found`).toBeTruthy();
      expect(
        (draw?.[1] ?? "").split(",").map((d) => d.trim()),
        `${rel}: the draw effect does not list the theme`
      ).toContain("theme");
      // And the invariant comment names `data-theme`, so the next reader does
      // not "simplify" it back out on the grounds that tokens never change.
      expect(
        source,
        `${rel}: the draw comment does not name data-theme`
      ).toMatch(/data-theme/);
    }
  });

  it("a FROZEN LiveScope repaints on a theme change, not only a live one", () => {
    // `LiveScope` stays mounted with `active === false` through pause,
    // processing and close (`liveScopeShown`, `recorder-stage.ts`), holding
    // its last frame. Listing `theme` in the draw deps re-runs the effect on a
    // toggle, but the re-run painted only on the `active` path (peek + rAF):
    // with a paused take on screen it re-read the colours, bound a fresh
    // observer, and painted nothing — the frozen bars kept the previous
    // theme's amber until Resume or a resize (George R4 P2-1 on #457). The
    // frozen-resize repaint, `paint(lastScopeRef.current)`, is the path that
    // already exists for exactly this state, so the effect must take it
    // itself when `!active`: AFTER the observer is bound (one frozen-repaint
    // path, not two), BEFORE the active branch, and never through
    // `readScope`, which advances the ring (the extra-column defect George R3
    // found on the peek path).
    //
    // Source-shape, not behaviour: no DOM runner in the Node suite (#197), and
    // the scenario needs a theme control on a screen that keeps `LiveScope`
    // mounted (#149), which does not exist yet.
    const source = read("src/components/live-scope.tsx");
    const draw =
      /useLayoutEffect\(\(\) => \{([\s\S]*?)\n    return \(\) => \{/.exec(
        source
      );
    expect(
      draw?.[1],
      "no draw effect body found in live-scope.tsx"
    ).toBeTruthy();
    const body = draw?.[1] ?? "";
    const bind = body.indexOf("observer.observe(canvas)");
    expect(
      bind,
      "the draw effect does not bind the ResizeObserver"
    ).toBeGreaterThan(-1);
    const live = body.indexOf("if (active) {");
    expect(live, "no active branch in the draw effect").toBeGreaterThan(bind);
    const frozen = body.slice(bind, live);
    expect(
      frozen,
      "no guarded frozen repaint between the observer bind and the active branch"
    ).toMatch(/^\s*if \(!active\) paint\(lastScopeRef\.current\);\s*$/m);
    // The comment beside the repaint names `readScope` as the thing NOT to
    // call, so strip comment lines before the negative match — code only.
    const frozenCode = frozen.replace(/^\s*\/\/.*$/gm, "");
    expect(
      frozenCode,
      "the frozen repaint must not advance the ring"
    ).not.toMatch(/readScope/);
  });

  it("a theme READ fallback is not a translator-facing failure; a failed WRITE still is", () => {
    // `reportFailure` is the one funnel, and its production subscriber is the
    // durable log the Books `≡` counts and marks (#205): the translator-facing
    // problem channel — unfiltered, 50 rows (the #478 constraint, tracker
    // 2026-09-18 learning 2). `readTheme` runs once per launch, and a throw on
    // READ (Safari with cookies blocked, a WebView with storage off) falls
    // back to the default theme, which is the app's normal state: nothing for
    // a translator or facilitator to act on. Reporting it put one row in that
    // log per cold start — "N problems recorded" for a cosmetic fallback, and
    // after 50 launches the ring drops the real save failure a facilitator
    // would send (George R4 P2-2 on #457). So the read fallback is silent
    // toward the log, with the reason in its comment.
    //
    // The persist path is the other case: user-initiated, and the choice will
    // not survive a relaunch — that row stays, and `e2e/theme-toggle.spec.ts`
    // asserts it through the ≡ name and mark. Both halves are pinned here so
    // neither is "tidied" into the other.
    const hook = read("src/hooks/use-theme.ts");
    const readFn = /function readTheme\(\)[^{]*\{([\s\S]*?)\n\}/.exec(hook);
    expect(readFn?.[1], "no readTheme in use-theme.ts").toBeTruthy();
    const readBody = readFn?.[1] ?? "";
    expect(
      readBody,
      "readTheme reports its read fallback to the failure log"
    ).not.toContain("reportFailure(");
    // And it still falls back to the default rather than rethrowing.
    expect(readBody, "readTheme no longer falls back to the default").toMatch(
      /readStoredTheme\(null\)/
    );
    expect(hook, "the persist failure is no longer reported").toMatch(
      /reportFailure\(cause, "use-theme: persist"\)/
    );
  });
});
