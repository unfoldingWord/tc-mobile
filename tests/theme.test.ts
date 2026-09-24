import { readdirSync, readFileSync } from "node:fs";
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
   * The same file with its comments removed - block and line - so an assertion
   * about the CODE cannot be satisfied by prose (George round 12, #623).
   *
   * AGENTS.md records the capture-by-comment trap in one direction: a comment
   * naming a string a test greps for can CAPTURE that test (#529 round 3).
   * This is the other direction, and the mount tripwire had it. Comments are
   * part of the file, so a later edit that parked the JSX inside a JSX comment
   * would still have been counted as a mount. No comment in the tree contains
   * that string today, so the counts were honest as written; this closes the
   * shape before it can become true.
   *
   * What each pass removes, since the two are not symmetric. The block pass is
   * unanchored, so a block-comment opener inside a string literal would start a
   * cut. The line pass is anchored to the start of a line, so it removes only a
   * line whose first non-whitespace is a line-comment marker: one TRAILING code
   * on the same line survives, and so does a marker inside a string. Trailing
   * comments do occur in the counted files; none of them names a mount, which
   * is the same fact the paragraph above rests on. A real parser would be more
   * code than the thing it protects.
   */
  const code = (rel: string) =>
    read(rel)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");

  /** Every file under `dir`, recursively. Used by the subscriber sweep below. */
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : [full];
    });

  /**
   * The global menu's opening tag, matched by the props this file is actually
   * about — `open={menuOpen}` and a close handler of some kind — rather than by
   * one exact expression. The two cases below both need to FIND that tag; what
   * they assert is what is inside it. Any further prop the tag grows (today
   * `hamburger`, #608) is allowed through for the same reason the close
   * handler is: neither is what this file is about.
   */
  const GLOBAL_MENU_OPEN_TAG = String.raw`<Menu open=\{menuOpen\} onClose=\{[^}]*\}[^>]*>`;

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
    // The hook could exist and be called by nothing. Since #149 the control
    // itself is `ThemeControl` — one component mounted in three menus — so the
    // wiring lives in that file and the MOUNT is what each screen shows.
    const control = read("src/components/theme-control.tsx");
    expect(control).toMatch(/useTheme\(\)/);
    expect(control).toMatch(/onClick=\{theme\.toggle\}/);
    const screen = code("src/components/books-screen.tsx");
    expect(screen).toMatch(/<ThemeControl\s*\/>/);
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
    const screen = code("src/components/books-screen.tsx");
    const menu = screen.search(new RegExp(GLOBAL_MENU_OPEN_TAG));
    expect(menu).toBeGreaterThan(-1);
    const body = screen.slice(menu);
    const panel = body.indexOf("<FailureLogPanel");
    // `<ThemeControl`, with the angle bracket, so a prose mention of the
    // component in a nearby comment can never stand in for the mount — the
    // capture-by-comment trap AGENTS.md records from #529 round 3.
    const toggle = body.indexOf("<ThemeControl");
    expect(panel, "FailureLogPanel is not in the global menu").toBeGreaterThan(
      -1
    );
    expect(toggle, "the toggle is not in the global menu").toBeGreaterThan(-1);
    expect(
      panel,
      "the theme toggle is mounted ahead of the failure-log panel"
    ).toBeLessThan(toggle);
  });

  it("follows the translator into a chapter and into the recorder (#149)", () => {
    // WHAT THIS IS AND IS NOT. The behavioural claim — that the toggle is
    // reachable from the chapter `≡` and the recorder `≡` and repaints the
    // shipped cascade from each — is `e2e/theme-toggle.spec.ts`, in real
    // Chromium against `dist/`. This is the cheap Node companion that fails
    // fast when a mount is DELETED, which is the way this regresses: both
    // screens are large, and neither reviewer's eye is a gate.
    //
    // COUNTED, not merely present. The recorder menu has two mutually
    // exclusive branches — record mode and edit mode — and each mounts the
    // toggle, so a `toMatch` over the file passes with one of them deleted:
    // the first draft of this case was mutated that way and survived. The
    // e2e spec drives the sheet in RECORD mode only, so the edit-mode mount
    // has no other gate at all.
    //
    // Matched as `<ThemeControl`, never as the bare identifier, for the
    // comment-capture reason above.
    const mounts = (file: string) =>
      code(file).match(/<ThemeControl\s*\/>/g)?.length ?? 0;
    // The chapter `≡`'s one action branch (the stale and rename branches are
    // transient sub-states with no action list of their own).
    expect(mounts("src/components/segments-screen.tsx")).toBe(1);
    // Record mode and edit mode — in `recorder-menu.tsx` since #662 lifted the
    // recorder's `≡` out of `recorder.tsx` into its own component. The count
    // follows the menu rather than the screen, and `recorder.tsx` is asserted
    // to hold NONE, so a half-finished move that leaves one mount behind in
    // the screen fails here instead of silently double-mounting.
    expect(mounts("src/components/recorder-menu.tsx")).toBe(2);
    expect(mounts("src/components/recorder.tsx")).toBe(0);

    // And the other half of the claim, which the counts alone do NOT pin
    // (George round 10, #623). The whole argument for mounting this control
    // on a live take is that the SUBSCRIPTION stays in the leaf: a toggle
    // re-renders that button, not the screen hosting the menu. Counting
    // mounts cannot see a regression there — a later `useTheme()` in any of
    // these screens would re-render that tree on every toggle and still leave
    // every count above correct. The books case used to pin this incidentally,
    // by requiring `useTheme()` in `books-screen.tsx`; that assertion left
    // with the inline control it was written for, and nothing replaced it.
    //
    // So the absence is pinned directly — and SWEPT, not listed (George round
    // 11, #623). A four-file ban was narrower than the sentence it sat under:
    // `useLiveTheme(` does not match `/useTheme\(/`, and a subscription added
    // in any file outside the list — a shared hook the recorder already calls,
    // a new component — would re-render that tree on every toggle and leave
    // every count and every named file green. A list cannot say "the one file
    // allowed"; only a sweep with an allow-list can.
    //
    // So: walk all of `src/`, find every call site of either hook, and require
    // the set to be exactly the allow-list. Adding a subscriber is then a
    // deliberate edit to this list with a reason, which is the point — the
    // canvases are allowed BECAUSE they must repaint on a token change
    // (`waveform.tsx`, `live-scope.tsx`, George R2 P2 on #457); a screen or a
    // menu is not, because that is the blast radius this control was factored
    // to avoid.
    //
    // The sweep runs TWICE, over the same allow-list, because the two readings
    // fail closed in opposite directions and neither covers both (George
    // rounds 14 and 17 each named one half, and they conflict if you have to
    // pick one).
    //
    //   raw  — catches an ADDED subscriber even in a file whose call the
    //          comment stripper would have eaten. Were the sweep stripped-only,
    //          a new subscriber that the stripper swallowed would drop out of
    //          the set, the set would still match, and the gate would go green
    //          on the thing it exists to catch.
    //   code — catches a REMOVED subscriber whose call text survives in a
    //          comment. Were the sweep raw-only, commenting out the only
    //          `useLiveTheme()` in `live-scope.tsx` would leave it on the list
    //          and the gate would stay green while the canvas silently stopped
    //          repainting on a token change. Observed, not reasoned: that exact
    //          mutation passed 21/21 before this second assertion existed.
    //
    // Both directions are a false GREEN, which is why neither reading is
    // enough on its own and why this is two assertions rather than a choice.
    const sweep = (source: (rel: string) => string) =>
      walk(path.resolve(import.meta.dirname, "..", "src"))
        .filter((file) => /\.tsx?$/.test(file))
        // The hook module DEFINES both; its own `export function useTheme()` is
        // not a subscription.
        .filter((file) => !file.endsWith("hooks/use-theme.ts"))
        .filter((file) => /\buseLiveTheme\(|\buseTheme\(/.test(source(file)))
        .map((file) =>
          // Normalised to forward slashes: `path.relative` yields `\` on
          // win32, which would fail the literal comparison below for a reason
          // that has nothing to do with theme subscribers (George).
          path
            .relative(path.resolve(import.meta.dirname, ".."), file)
            .split(path.sep)
            .join("/")
        )
        .sort();

    const allowed = [
      "src/components/live-scope.tsx",
      "src/components/theme-control.tsx",
      "src/components/waveform.tsx",
    ];

    expect(sweep(read)).toEqual(allowed);
    expect(sweep(code)).toEqual(allowed);
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
    // `--s-ink-faint`). This used to be anticipatory — while the toggle was
    // Books-only, `App` rendered Books XOR Segments, so a toggle unmounted
    // every canvas and the subscription cost nothing yet. #149 made the
    // toggle reachable from the chapter and recorder menus, so the case it
    // was written for is now the ordinary one: without these subscriptions
    // the bars would keep the previous theme's amber/faint until
    // `peaks`/`finished`/`active` happened to change (George R2 P2 on #457).
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
