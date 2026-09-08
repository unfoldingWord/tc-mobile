// FIRST, and deliberately so. This registers the `window` listeners that catch
// the failures React cannot (#167). An ES module body runs only after its
// static imports have evaluated, so being the first import here is what makes
// those listeners live before every other module below evaluates — including
// `./App` and the whole graph under it. See `install-failure-listeners.ts`.
import "./install-failure-listeners";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ErrorBoundary } from "@/components/error-boundary";
import { App } from "./App";
import "./globals.css";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);

// The Playwright smoke harness (#251). `import.meta.env.MODE` is a build-time
// string Vite substitutes per `--mode`: `npm run build` (mode "production",
// what `staging`/`main` ship) never satisfies this, so this branch never runs
// there. What matters for the harness staying OUT of a real build is not this
// branch, though — Rollup discovers a dynamic `import()` target from the
// module graph regardless of a surrounding runtime condition, so a false
// branch alone would still bundle `e2e-harness.ts` as a reachable, if unused,
// chunk. `vite.config.ts`'s `build.rollupOptions.external` excludes
// `"./e2e-harness"` by id for every mode except `"e2e"`, which is what
// actually keeps it out of `dist/` — checked directly against `dist/`'s
// output below, not inferred. See `src/app/e2e-harness.ts`'s header.
if (import.meta.env.MODE === "e2e") {
  void import("./e2e-harness");
}
