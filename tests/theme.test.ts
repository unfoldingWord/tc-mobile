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
    expect(screen).toMatch(
      /<Menu open=\{menuOpen\} onClose=\{\(\) => setMenuOpen\(false\)\}>/
    );
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
});
