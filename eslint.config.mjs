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
        group: [`@/${layer}/*`, `@/${layer}/**`],
        message,
      })),
    },
  ],
});

export default tseslint.config(
  { ignores: ["dist", "dev-dist", ".wrangler", "public"] },

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

  // lib/ — pure core. May import types only.
  {
    files: ["src/lib/**/*.ts"],
    rules: deny([
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
  }
);
