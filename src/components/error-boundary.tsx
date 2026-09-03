import { Component, type ReactNode } from "react";

import { reportFailure } from "@/hooks/report-failure";
import { Control } from "./control";
import { Notice } from "./notice";
import { strings } from "./strings";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  readonly failed: boolean;
}

/** Start the app again from disk. Everything saved lives in IndexedDB. */
function reload(): void {
  window.location.reload();
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
 * Two properties it must keep:
 *
 *   - **It never shows `error.message`.** The audience is people who may not
 *     read, and a stack-shaped string in a language they do not speak is worse
 *     than the glyph alone. The cause goes to the sink, which is where a
 *     maintainer reads it.
 *   - **The fallback is state-in-place**, not a paragraph: an alert `Notice`
 *     carrying the mark and the colour, and one large control that restarts
 *     the app. The control is `--primary` (68px), well over the 44px touch
 *     floor this repo builds to.
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

  override componentDidCatch(error: Error): void {
    // The single sink. Typed `Error` because React's types say so; treated as
    // `unknown` on the other side, because a `throw` can carry anything.
    reportFailure(error, "render");
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="app-shell items-center justify-center">
        <div className="flex w-full max-w-md flex-col items-center gap-[18px]">
          <Notice>{strings.appFailed}</Notice>
          <Control
            icon="retry"
            label={strings.tryAgain}
            variant="primary"
            autoFocus
            onClick={reload}
          />
        </div>
      </main>
    );
  }
}
