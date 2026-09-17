import { Component, type ErrorInfo, type ReactNode } from "react";

import { reportFailure } from "@/hooks/report-failure";
import { Control } from "./control";
import { Icon } from "./icon";
import { strings } from "./strings";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  readonly failed: boolean;
}

/** The heading that names the alert, referenced by `aria-labelledby`. */
const TITLE_ID = "app-failed-title";

/** The teach line that describes the alert, referenced by `aria-describedby`. */
const TEACH_ID = "app-failed-teach";

/**
 * Restart the app from disk. Everything saved lives in IndexedDB.
 *
 * This is a reload, and the label says so (`strings.appReload`, not the Books
 * shelf's `tryAgain`): it cannot bring back anything that lived only in memory,
 * and a deterministic boot crash will simply reach the same screen again — an
 * open gap recorded on #167, not something this control can pretend away.
 */
function reload(): void {
  window.location.reload();
}

/**
 * Put the reader on the alert's name when the fallback mounts.
 *
 * The heading, not the button. `autoFocus` on an icon-only `Control` moves a
 * screen reader straight to "Restart the app" and can swallow the alert that
 * mounted with it — the action announced with no reason. Focusing the labelled
 * heading inside the `alertdialog` announces the dialog and what happened
 * first, and leaves the one control the very next stop.
 */
function focusOnMount(node: HTMLParagraphElement | null): void {
  node?.focus();
}

/**
 * The one boundary, at the root (#167).
 *
 * React 19 unmounts the whole tree when a render-phase throw reaches the top
 * with no boundary under it, which on a phone is a blank dark page with no
 * control on it — nothing to tap, nothing said, and no way back short of
 * killing the app. This turns that into a screen with one thing on it.
 *
 * A class, because there is still no hook form of `getDerivedStateFromError`
 * in React 19; this is the one place in the app that is not a function
 * component, and it is not a style preference.
 *
 * Three properties it must keep:
 *
 *   - **It never shows `error.message`.** The audience is people who may not
 *     read, and a stack-shaped string in a language they do not speak is worse
 *     than the glyph alone. The cause — with React's component tree beside it —
 *     goes to the sink, which is where a maintainer reads it.
 *   - **It is the app's other full-screen recovery surface, and looks like
 *     it.** Same shape as `SaveFailed`: a named `role="alertdialog"`, the 56px
 *     alert mark in `--s-live`, a `t-title` line, and one `--primary` control
 *     at `size={30}` — the 68px button, well over the 44px touch floor. A
 *     translator who cannot read should recognise "this failed, press the big
 *     round thing" from the shape alone, and the shape should be one shape.
 *   - **The mark carries the meaning, the sentence only supports it.** Two
 *     short lines: what happened, and what the button will do.
 *
 * What it deliberately does NOT do yet: hand a held recording forward. A
 * failed-save take lives in RAM in `App`'s state (`useSaveTake`, #38), and this
 * boundary rendering its fallback means `App` is already unmounted and that
 * slot is already gone. Lifting the slot somewhere both can read it means
 * changing `src/hooks/use-save-take.ts`, which #180's lane owns — so the
 * hand-off is tracked on #167 rather than half-built here, where a Retry
 * control wired to an unmounted hook would report success it cannot observe.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  override state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // The single sink. Typed `Error` because React's types say so; treated as
    // `unknown` on the other side, because a `throw` can carry anything.
    //
    // `componentStack` goes with it. In a production build the cause's own
    // stack is minified, and React's tree is the part that says which component
    // threw — the one log line is only diagnosable off-device with it. It is a
    // third argument to the sink, never a fourth line on the screen.
    reportFailure(error, "render", errorInfo.componentStack ?? undefined);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="app-shell grid h-full place-items-center">
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={TITLE_ID}
          aria-describedby={TEACH_ID}
          className="flex w-full max-w-md flex-col items-center gap-[18px] px-[22px] text-center"
        >
          <span className="text-live">
            <Icon name="alert" size={56} />
          </span>

          <p
            id={TITLE_ID}
            ref={focusOnMount}
            tabIndex={-1}
            className="t-title text-ink"
          >
            {strings.appFailed}
          </p>

          <p id={TEACH_ID} className="text-ink-muted text-[13px]">
            {strings.appReloadTeach}
          </p>

          <Control
            icon="retry"
            label={strings.appReload}
            variant="primary"
            size={30}
            onClick={reload}
          />
        </div>
      </main>
    );
  }
}
