import js from "@eslint/js";
import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginReactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

/**
 * Onion Architecture Layers (outer → inner):
 *
 * app/        → Screens (can import from: components, hooks, lib, types)
 * components/ → UI Components (can import from: hooks, lib, types)
 * hooks/      → Browser/stateful glue (can import from: lib, types)
 * lib/        → Pure core: audio, storage and the string table
 *               (can import from: types only)
 * types/      → Domain types (no internal dependencies)
 *
 * Rule: Never import "upward" in the hierarchy.
 *
 * Why this matters here specifically: the requirements owner has said the UI
 * needs extensive changes that are not yet specified. Keeping the audio core in
 * `lib/` — pure, DOM-free, and unit-tested — means the disposable layer
 * (components/app) can be rewritten repeatedly without endangering the
 * durable layer.
 */

/**
 * F-336 — Capacitor's plugin APIs are a browser/native boundary, so they belong
 * in `hooks/` with every other one. `no-restricted-globals` cannot see them:
 * they arrive as an import, not a global, so nothing would have stopped
 * `@capacitor/filesystem` appearing in `lib/export/book.ts` and taking the
 * DOM-free audio core with it.
 *
 * Added with the plugins themselves (`@capacitor/share`, `@capacitor/filesystem`
 * — #336) rather than left for the first violation. `src/hooks/share-target.ts`
 * is the share boundary; `hooks/audio-io.ts` is the audio one.
 *
 * Appended to each outer layer's own patterns rather than given a config block
 * of its own: a second block matching the same files would REPLACE
 * `no-restricted-imports`'s options rather than merge with them, silently
 * dropping the onion rule it was meant to sit beside.
 */
const CAPACITOR_DENIED = {
  group: ["@capacitor/*", "@capacitor/*/**"],
  message:
    "Capacitor plugins are a native/browser boundary: import them in " +
    "src/hooks/** only (share-target.ts is the share boundary). See AGENTS.md.",
};

const deny = (groups, extra = []) => ({
  "no-restricted-imports": [
    "error",
    {
      patterns: [
        ...extra,
        ...groups.map(({ layer, message }) => ({
          // Both spellings. The `@/` alias is the convention, but nothing forces
          // it: `../hooks/audio-io` reaches the same file and used to pass this
          // rule silently. No import in `src/` uses the relative form today —
          // the risk is an editor auto-import while B1–B5 move files between
          // layers, which is exactly when the rule needs to hold.
          group: [
            `@/${layer}/*`,
            `@/${layer}/**`,
            `**/${layer}/*`,
            `**/${layer}/**`,
          ],
          message,
        })),
      ],
    },
  ],
});

/**
 * F58 — `lib/` must stay free of DOM, Web Audio and MediaRecorder.
 *
 * AGENTS.md calls this "the rule that matters most" and it was enforced by
 * nothing: a file in `src/lib/audio/` referencing `AudioContext`, `document`,
 * `window` and `navigator` produced zero ESLint and zero `tsc` diagnostics.
 *
 * Deliberately NOT restricted: `Blob`, `fetch` and `URL`. All three exist in
 * Node and in workers, `lib/storage` types its records on `Blob`, and banning
 * them would be a different rule than the one AGENTS.md states.
 *
 * This list is FAST FEEDBACK, not the boundary. Enumerating the DOM surface by
 * hand is a losing game — the first version of it omitted `AudioBuffer` and
 * `HTMLAudioElement`, both already used at the browser boundary. The boundary
 * is `tsconfig.lib.json`, which compiles src/lib and src/types with no DOM lib,
 * so type positions are covered too. That gate has a named residual — Node's
 * own web globals, `Navigator` and `Storage` among them — documented in that
 * file and asserted by tests/lib-boundary.test.ts. Keep this rule anyway: it
 * fires in the editor, it says why, and it covers `navigator` and
 * `localStorage` as values, which the compile gate does not.
 */
const BROWSER_ONLY_GLOBALS = [
  "window",
  "document",
  "navigator",
  "location",
  "history",
  "localStorage",
  "sessionStorage",
  "AudioContext",
  "webkitAudioContext",
  "OfflineAudioContext",
  "MediaRecorder",
  "MediaStream",
  "MediaStreamTrack",
  "AudioBuffer",
  "AudioBufferSourceNode",
  "AnalyserNode",
  "HTMLAudioElement",
  "HTMLCanvasElement",
  "FileReader",
  "Image",
  "HTMLElement",
  "requestAnimationFrame",
];

/**
 * #452 — `window.history` and `popstate` live in ONE file, the history adapter
 * `src/hooks/use-nav-stack.ts` (docs/design/back-navigation.md invariant 1:
 * "Enforced by a lint rule banning `history.*` calls outside
 * `hooks/use-nav-stack.ts`"). This is the AST form of that rule, added to the
 * `app`/`components`/`hooks` layers below and turned back off for the adapter
 * itself in a later block (flat-config later-wins).
 *
 * It bans the `history` OBJECT at its access points — the bare `history`
 * global, `window.history` / `globalThis.history`, the `onpopstate` handler,
 * and `addEventListener("popstate", …)` — NOT the generic method names
 * (`back`/`forward`/`go`/`pushState`/`replaceState`). Banning `window.history`
 * and the bare global already catches every `history.back()` / `.pushState()`
 * at the `history` node, one step before the method, so a bare-`property`
 * ban would add nothing but false positives on unrelated `.go`/`.back`/
 * `.forward` calls. Being an AST rule (not a source scanner), it cannot fire on
 * the `history.back()` mentions in lib/nav docblocks or `recorder.tsx`'s
 * comments — comments are invisible to the AST — so there is no
 * comment/string-stripping to get wrong.
 */
const HISTORY_BOUNDARY_MESSAGE =
  "window.history / popstate live in ONE file, src/hooks/use-nav-stack.ts " +
  "(#452, docs/design/back-navigation.md invariant 1). Route Back/Forward " +
  "through that adapter, never a raw history call here.";

/**
 * The ONE history `no-restricted-syntax` selector:
 * `foo.addEventListener("popstate", …)` — any object, first arg the string
 * literal "popstate" (esquery indexes call arguments positionally).
 */
const HISTORY_POPSTATE_SELECTOR = {
  selector:
    "CallExpression[callee.property.name='addEventListener'][arguments.0.value='popstate']",
  message: HISTORY_BOUNDARY_MESSAGE,
};

/**
 * Non-history `no-restricted-syntax` selectors for the boundary layers
 * (app/components/hooks). EMPTY today. A selector added here reaches EVERY
 * boundary file, INCLUDING the adapter (`use-nav-stack.ts`) — the adapter's
 * override below spreads this same list — so a future onion/safety syntax rule
 * is not silently dropped for the adapter the way a blanket
 * `no-restricted-syntax: "off"` would drop it (George R3 P3-4).
 */
const NON_HISTORY_SYNTAX_SELECTORS = [];

/**
 * The full boundary-layer `no-restricted-syntax` set: the history popstate ban
 * plus any non-history selectors. Applied to app/components/hooks EXCEPT the
 * adapter (which owns `addEventListener("popstate", …)`) via the dedicated
 * block below — NOT via `HISTORY_BOUNDARY_RULES`, because the adapter cannot
 * carry the popstate selector and then subtract it: ESLint flat config's
 * severity-only `["error"]` override RETAINS the prior selector list, so a
 * per-file "drop just this selector" is impossible; the file must never receive
 * it. `HISTORY_BOUNDARY_RULES` therefore holds only the history OBJECT bans,
 * which the adapter CAN turn fully off.
 */
const BOUNDARY_SYNTAX_SELECTORS = [
  HISTORY_POPSTATE_SELECTOR,
  ...NON_HISTORY_SYNTAX_SELECTORS,
];

/**
 * NEVER add `no-restricted-syntax` here, or to any of the three layer blocks
 * that spread this object (hooks/components/app below). `HISTORY_SYNTAX_BLOCK`
 * is declared later in the exported config with its own explicit
 * `no-restricted-syntax` options and an `ignores` for the adapter file, and a
 * later flat-config block with an explicit option for a rule fully replaces an
 * earlier block's option for that rule on every file the later block matches —
 * so anything set here would be silently overwritten for every boundary file
 * anyway, and the adapter's carve-out (the whole reason `HISTORY_SYNTAX_BLOCK`
 * exists as its own block) would not apply to it. A new syntax selector goes
 * in `NON_HISTORY_SYNTAX_SELECTORS` (panel r5 P3).
 */
const HISTORY_BOUNDARY_RULES = {
  "no-restricted-globals": [
    "error",
    { name: "history", message: HISTORY_BOUNDARY_MESSAGE },
  ],
  "no-restricted-properties": [
    "error",
    {
      object: "window",
      property: "history",
      message: HISTORY_BOUNDARY_MESSAGE,
    },
    {
      object: "globalThis",
      property: "history",
      message: HISTORY_BOUNDARY_MESSAGE,
    },
    {
      object: "window",
      property: "onpopstate",
      message: HISTORY_BOUNDARY_MESSAGE,
    },
    {
      object: "globalThis",
      property: "onpopstate",
      message: HISTORY_BOUNDARY_MESSAGE,
    },
  ],
};

/**
 * The popstate ban, in its OWN block so it can IGNORE the adapter (see
 * `BOUNDARY_SYNTAX_SELECTORS` for why a per-file subtraction is impossible).
 * Every boundary layer that must route Back through the adapter carries it; the
 * adapter is ignored here and re-declares `no-restricted-syntax` (enabled, only
 * the non-history selectors) in its own override.
 */
const HISTORY_SYNTAX_BLOCK = {
  files: [
    "src/hooks/**/*.{ts,tsx}",
    "src/components/**/*.{ts,tsx}",
    "src/app/**/*.{ts,tsx}",
    ".nav-history-probe/**/*.{ts,tsx}",
  ],
  ignores: ["src/hooks/use-nav-stack.ts"],
  rules: {
    "no-restricted-syntax": ["error", ...BOUNDARY_SYNTAX_SELECTORS],
  },
};

export default tseslint.config(
  // `.lib-boundary-probe` is written by tests/lib-boundary.test.ts and removed
  // in afterAll. An interrupted run leaves it behind, and it contains
  // deliberately-invalid code — gitignored, so it must be lint-ignored too.
  // `.react-hooks-refs-probe` is the same pattern for
  // tests/react-hooks-refs-gate.test.ts.
  {
    // `dist-e2e` is build output too (`npm run build:e2e`, #251) and was
    // missing here while `dist` was listed — round-1 George G5.
    ignores: [
      "dist",
      "dist-e2e",
      "dev-dist",
      ".wrangler",
      "public",
      ".lib-boundary-probe",
      ".react-hooks-refs-probe",
      // tests/nav-history-boundary.test.ts's probe dir — same pattern.
      ".nav-history-probe",
      // Capacitor native projects (#262) — generated/managed by the `cap` CLI.
      // No first-party TS/TSX lives here; skip them so ESLint never trips on a
      // generated file inside the iOS/Android shells.
      "android",
      "ios",
    ],
  },

  {
    extends: [...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": pluginReactHooks,
      "react-refresh": pluginReactRefresh,
    },
    rules: {
      // #212: eslint-plugin-react-hooks 7.1.1's static analysis (which
      // `refs` and every other rule here depend on) bails out on a hook body
      // where a `catch (cause) { ... }` block contains ANY nested function
      // that references `cause` — a `setState` updater is the shape found
      // twice so far (use-save-take.ts, use-books.ts), but nothing about
      // `setState` specifically is required — silencing e.g. an unrelated
      // render-time `ref.current = x` write earlier in the same function.
      // Scoped to that one hook function, not the whole file. This is
      // exactly the shape `commit` had in src/hooks/use-save-take.ts before
      // #180 simplified it, which is how a real `react-hooks/refs` violation
      // passed `npm run lint` there for as long as that shape stood.
      // tests/react-hooks-refs-gate.test.ts pins both halves: a plain ref
      // write fires, and this shape stays silent — but it lints only
      // synthetic probes, never `src/`, so it does not by itself find a live
      // occurrence; that is still on review (a second one, use-books.ts, was
      // found by George round 3 on #433, not by this gate).
      ...pluginReactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },

  // types/ — the innermost layer, no internal dependencies at all.
  {
    files: ["src/types/**/*.ts"],
    rules: deny(
      [
        {
          layer: "lib",
          message: "types cannot import lib (onion architecture)",
        },
        {
          layer: "hooks",
          message: "types cannot import hooks (onion architecture)",
        },
        {
          layer: "components",
          message: "types cannot import components (onion architecture)",
        },
        {
          layer: "app",
          message: "types cannot import app (onion architecture)",
        },
      ],
      [CAPACITOR_DENIED]
    ),
  },

  // lib/ — pure core. May import types only, and may touch no browser API.
  {
    files: ["src/lib/**/*.ts"],
    rules: {
      ...deny(
        [
          {
            layer: "hooks",
            message: "lib cannot import hooks (onion architecture)",
          },
          {
            layer: "components",
            message: "lib cannot import components (onion architecture)",
          },
          {
            layer: "app",
            message: "lib cannot import app (onion architecture)",
          },
        ],
        [CAPACITOR_DENIED]
      ),
      "no-restricted-globals": [
        "error",
        ...BROWSER_ONLY_GLOBALS.map((name) => ({
          name,
          message:
            "lib/ must stay DOM-free so the audio core runs in plain Node. " +
            "Browser APIs belong in hooks/ — hooks/audio-io.ts is the single " +
            "audio boundary. See AGENTS.md.",
        })),
      ],
    },
  },

  // hooks/ — may import lib + types. `.nav-history-probe/**` is included so
  // tests/nav-history-boundary.test.ts's synthetic probes are linted against
  // the REAL hooks-layer history rule (they live at the repo root, outside
  // src/, so a leftover from an interrupted run cannot reach knip's `src/**`
  // project — the same safety the other probe gates get from a root-level dir).
  {
    files: ["src/hooks/**/*.{ts,tsx}", ".nav-history-probe/**/*.{ts,tsx}"],
    rules: {
      ...deny([
        {
          layer: "components",
          message: "hooks cannot import components (onion architecture)",
        },
        {
          layer: "app",
          message: "hooks cannot import app (onion architecture)",
        },
      ]),
      ...HISTORY_BOUNDARY_RULES,
    },
  },

  // The history adapter is the ONE place window.history / popstate may live
  // (#452, invariant 1). Allow-list it AFTER the hooks block so flat-config's
  // later-wins exempts it from the history boundary for this file only — its
  // onion `no-restricted-imports` denial (above) still applies. The two
  // history-OBJECT rules (`no-restricted-globals` / `no-restricted-properties`)
  // are turned fully off — the adapter owns `history`/`window.history`.
  //
  // `no-restricted-syntax` is NOT blanket-`off` (George R3 P3-4): it stays
  // ENABLED here with the NON-history boundary selectors, so a future selector
  // added to `NON_HISTORY_SYNTAX_SELECTORS` reaches this file too. The popstate
  // selector is simply absent — `HISTORY_SYNTAX_BLOCK` (which carries it)
  // ignores this file — so no popstate option ever reaches this override and
  // `npm run lint` stays green on the adapter's own `addEventListener(
  // "popstate", …)`. (A blanket `off` would silently drop every future
  // selector too; a severity-only `["error"]` could not drop popstate alone —
  // ESLint retains prior options — which is why popstate is scoped out at
  // source rather than subtracted here.) Proven load-bearing by mutation:
  // removing `HISTORY_SYNTAX_BLOCK`'s adapter `ignores`, or the block itself,
  // flags the real adapter; asserted by `tests/nav-history-boundary.test.ts`.
  {
    files: ["src/hooks/use-nav-stack.ts"],
    rules: {
      "no-restricted-globals": "off",
      "no-restricted-properties": "off",
      "no-restricted-syntax": ["error", ...NON_HISTORY_SYNTAX_SELECTORS],
    },
  },

  // components/ — may import hooks, lib, types.
  {
    files: ["src/components/**/*.{ts,tsx}"],
    rules: {
      ...deny(
        [
          {
            layer: "app",
            message: "components cannot import app (onion architecture)",
          },
        ],
        [CAPACITOR_DENIED]
      ),
      ...HISTORY_BOUNDARY_RULES,
    },
  },

  // app/ — the outermost layer: it may import every layer below, but a
  // Capacitor plugin is still a boundary that belongs in hooks/. This block
  // exists for that rule and the history-boundary rules; app/ has no onion
  // denials of its own.
  {
    files: ["src/app/**/*.{ts,tsx}"],
    rules: { ...deny([], [CAPACITOR_DENIED]), ...HISTORY_BOUNDARY_RULES },
  },

  // The popstate `no-restricted-syntax` ban across the boundary layers, in its
  // own block so it can IGNORE the adapter (see `HISTORY_SYNTAX_BLOCK`). The
  // history OBJECT bans stay in each layer block above via
  // `HISTORY_BOUNDARY_RULES`; only the syntax selector needs this carve-out.
  HISTORY_SYNTAX_BLOCK,

  // The audio core indexes typed arrays in hot loops, where
  // `noUncheckedIndexedAccess` forces a non-null assertion on every sample
  // read. Allowing `!` here is deliberate and scoped to lib/audio only.
  {
    files: ["src/lib/audio/**/*.ts"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },

  // F60 — the build scripts matched no config block, so `eslint .` and
  // lint-staged both implied a coverage that fired nothing:
  // `eslint --print-config scripts/build-obs-catalog.mjs` returned 0 rules.
  // They fetch over the network and write src/data/obs-catalog.json plus 598
  // files into public/, which is not the place for an unlinted script.
  {
    files: ["scripts/**/*.mjs"],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      // The Node globals these two scripts actually use. Listed rather than
      // pulled from the `globals` package, which is one more dependency for
      // eight names.
      globals: {
        console: "readonly",
        process: "readonly",
        fetch: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        setTimeout: "readonly",
        // check-deploy.mjs's fetch timeout (round-1 Frank F2).
        AbortSignal: "readonly",
      },
    },
  }
);
