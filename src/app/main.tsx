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
