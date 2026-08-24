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
 * lib/        → Pure audio + storage core (can import from: types only)
 * types/      → Domain types (no internal dependencies)
 *
 * Rule: Never import "upward" in the hierarchy.
 *
 * Why this matters here specifically: Tim has said the UI "needs lots of
 * changes, but I don't know what they are yet." Keeping the audio core in
 * `lib/` — pure, DOM-free, and unit-tested — means the disposable layer
 * (components/app) can be rewritten repeatedly without endangering the
 * durable layer.
 */

const deny = (groups) => ({
  "no-restricted-imports": [
    "error",
    {
      patterns: groups.map(({ layer, message }) => ({
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

export default tseslint.config(
  // `.lib-boundary-probe` is written by tests/lib-boundary.test.ts and removed
  // in afterAll. An interrupted run leaves it behind, and it contains
  // deliberately-invalid code — gitignored, so it must be lint-ignored too.
  {
    ignores: ["dist", "dev-dist", ".wrangler", "public", ".lib-boundary-probe"],
  },

  {
    extends: [...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": pluginReactHooks,
      "react-refresh": pluginReactRefresh,
    },
    rules: {
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
    rules: deny([
      { layer: "lib", message: "types cannot import lib (onion architecture)" },
      {
        layer: "hooks",
        message: "types cannot import hooks (onion architecture)",
      },
      {
        layer: "components",
        message: "types cannot import components (onion architecture)",
      },
      { layer: "app", message: "types cannot import app (onion architecture)" },
    ]),
  },

  // lib/ — pure core. May import types only, and may touch no browser API.
  {
    files: ["src/lib/**/*.ts"],
    rules: {
      ...deny([
        {
          layer: "hooks",
          message: "lib cannot import hooks (onion architecture)",
        },
        {
          layer: "components",
          message: "lib cannot import components (onion architecture)",
        },
        { layer: "app", message: "lib cannot import app (onion architecture)" },
      ]),
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

  // hooks/ — may import lib + types.
  {
    files: ["src/hooks/**/*.{ts,tsx}"],
    rules: deny([
      {
        layer: "components",
        message: "hooks cannot import components (onion architecture)",
      },
      { layer: "app", message: "hooks cannot import app (onion architecture)" },
    ]),
  },

  // components/ — may import hooks, lib, types.
  {
    files: ["src/components/**/*.{ts,tsx}"],
    rules: deny([
      {
        layer: "app",
        message: "components cannot import app (onion architecture)",
      },
    ]),
  },

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
      },
    },
  }
);
