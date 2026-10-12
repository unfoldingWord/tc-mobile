import path from "node:path";
import { defineConfig } from "vitest/config";

import { disclosedComponents } from "./src/components/licenses.ts";
import { installedVersions } from "./scripts/licence-versions.mjs";

export default defineConfig({
  // The same installed-manifest versions the build defines (vite.config.ts), so
  // `thirdPartyLicenses` carries real versions under test. A disclosed package
  // that is not installed is left out here and fails tests/licenses.test.ts by
  // name, instead of taking every test file down at config load (#1381).
  define: {
    __DEP_VERSIONS__: JSON.stringify(
      installedVersions(
        import.meta.dirname,
        disclosedComponents.map((c) => c.pinPackage ?? c.name)
      )
    ),
  },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  test: {
    // The `lib/` layer is deliberately free of DOM and Web Audio APIs so the
    // audio core is testable in plain Node. Anything that genuinely needs
    // MediaRecorder / AudioContext is verified on-device — see AGENTS.md.
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Inert under plain `npm test`; `npm run test:coverage` switches it on
    // (#159 Q-16). Scoped to src/lib/** because that is the T1 layer, where a
    // regression is unrecoverable in the field. The floors sit a few points
    // under the measured level, so they catch a deleted test file or an
    // untested new module, not a single uncovered branch.
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      reporter: ["text-summary", "json-summary"],
      // A coverage verdict on a run whose tests failed means nothing.
      reportOnFailure: false,
      thresholds: {
        lines: 96,
        statements: 95,
        functions: 95,
        branches: 92,
        "src/lib/audio/**": {
          lines: 98,
          statements: 98,
          functions: 98,
          branches: 94,
        },
        "src/lib/storage/**": {
          lines: 95,
          statements: 93,
          functions: 94,
          branches: 88,
        },
        "src/lib/takes/**": {
          lines: 98,
          statements: 98,
          functions: 98,
          branches: 98,
        },
      },
    },
  },
});
