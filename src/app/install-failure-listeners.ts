/**
 * The two failures React never sees, routed to the same sink as a render throw
 * (#167).
 *
 * An error boundary catches render, lifecycle and constructor throws only. A
 * promise nothing awaited, and a throw from an event handler or a timer, land
 * on `window` — where, until this, nothing was listening at all.
 *
 * **Why this is a module of its own, and the first import of the entry.** An ES
 * module body runs only after every one of its static imports has finished
 * evaluating. Registering these listeners in the body of `src/app/main.tsx` —
 * which imports `./App` above them — therefore leaves one gap uncovered: a
 * throw or a rejection raised while the App graph itself evaluates, before any
 * of `main.tsx`'s own statements run. That is exactly the failure that looks
 * like the app never started. Importing this file first makes its body the
 * first code that runs, so every module imported after it is covered.
 *
 * What is still NOT covered, and is not claimed to be: this module's own two
 * imports, which by the same rule finish evaluating before any of the
 * statements below run. That is no longer a single declaration-only module —
 * `@/hooks/failure-log` pulls in the storage layer and `@/lib/failure-text`
 * with it — so a throw raised while THAT graph evaluates has no listener and no
 * sink. It is a narrow window (module bodies that only declare and open no
 * database), but it is wider than it was, and naming it honestly is the point
 * of this paragraph. Also uncovered: anything the browser evaluates before the
 * entry module.
 *
 * The listeners are never removed: they live as long as the page.
 *
 * The durable log (#205) is installed from here too, and for the same reason:
 * a sink installed inside a React effect is installed after the App graph has
 * evaluated and rendered, so the earliest failures — the ones that look like the
 * app never started — would reach the funnel with nowhere to be stored. Ordered
 * BEFORE the two listeners below so a failure raised by their own registration
 * would still land in the log.
 */

import { installFailureLog } from "@/hooks/failure-log";
import { reportFailure } from "@/hooks/report-failure";

installFailureLog();

window.addEventListener("unhandledrejection", (event) => {
  reportFailure(event.reason, "unhandled-rejection");
});

window.addEventListener("error", (event) => {
  // Chromium raises a window `error` for the benign "ResizeObserver loop
  // completed with undelivered notifications." (and the older "ResizeObserver
  // loop limit exceeded") — a frame-budget notice, not an exception. `LiveScope`
  // is a live trigger: its observer calls `paint()`, which writes `canvas.width`.
  // The notice carries no `event.error`, so its cause would be the string
  // message, which the sink's identity dedup cannot collapse — a resize burst
  // would spam the one channel. Drop it here, at the single listener, so any
  // future observer is covered without rewriting the component that fired it.
  if (/^ResizeObserver loop/.test(event.message)) return;

  // `error` is the thrown value when there is one; a cross-origin script error
  // arrives with `error === null` and only a message, which is still worth a
  // line in the log.
  reportFailure(event.error ?? event.message, "uncaught-error");
});
