import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ErrorBoundary } from "@/components/error-boundary";
import { reportFailure } from "@/hooks/report-failure";
import { App } from "./App";
import "./globals.css";

/**
 * The two failures React never sees, routed to the same sink as a render throw
 * (#167).
 *
 * An error boundary catches render, lifecycle and constructor throws only.
 * A promise nothing awaited and a throw from an event handler or a timer land
 * on `window`, where — until this — nothing was listening at all.
 *
 * Registered before the first render, because a rejection during module
 * evaluation or the first paint is exactly the one that looks like the app
 * simply never started. They are never removed: they live as long as the page.
 */
window.addEventListener("unhandledrejection", (event) => {
  reportFailure(event.reason, "unhandled-rejection");
});
window.addEventListener("error", (event) => {
  // `error` is the thrown value when there is one; a cross-origin script error
  // arrives with `error === null` and only a message, which is still worth a
  // line in the log.
  reportFailure(event.error ?? event.message, "uncaught-error");
});

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
