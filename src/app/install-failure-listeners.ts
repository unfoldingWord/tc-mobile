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
 * What is still NOT covered, and is not claimed to be: this module's own import
 * (`@/hooks/report-failure`, which registers nothing and only declares), and
 * anything the browser evaluates before the entry module.
 *
 * The listeners are never removed: they live as long as the page.
 */

import { reportFailure } from "@/hooks/report-failure";

window.addEventListener("unhandledrejection", (event) => {
  reportFailure(event.reason, "unhandled-rejection");
});

window.addEventListener("error", (event) => {
  // `error` is the thrown value when there is one; a cross-origin script error
  // arrives with `error === null` and only a message, which is still worth a
  // line in the log.
  reportFailure(event.error ?? event.message, "uncaught-error");
});
