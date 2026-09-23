import { Component, useState, type ErrorInfo, type ReactNode } from "react";

import {
  flushFailureLog,
  renderFailureRefusal,
  renderFailureStored,
  retryRenderFailureWrite,
} from "@/hooks/failure-log";
import { quiesceTranscodeSweep } from "@/hooks/finish-transcode";
import { isTerminalOpenRefusal } from "@/lib/storage/db";
import { reportFailure } from "@/hooks/report-failure";
import { Control } from "./control";
import { Icon } from "./icon";
import { Notice } from "./notice";
import { SendLogControl } from "./send-log-control";
import { strings } from "@/lib/i18n/strings";

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
 * Restart the app from disk, once the failure has actually been written down.
 *
 * This is a reload, and the label says so (`strings.appReload`, not the Books
 * shelf's `tryAgain`): it cannot bring back anything that lived only in memory,
 * and a deterministic boot crash will simply reach the same screen again — an
 * open gap recorded on #167, not something this control can pretend away.
 *
 * **The flush is not a nicety** (George, round 2). `componentDidCatch` reports
 * fire-and-forget, and on a render-phase throw no effect has run yet — so that
 * write is usually the `getDb` open itself, plus the v6 upgrade on a device
 * coming from v5. A synchronous `location.reload()` unloads the page in the
 * middle of it, and this repo already treats an `pagehide` mid-write as a real
 * race rather than a theoretical one. Losing the record of a render crash to
 * the very button offered for recovering from it is the worst trade available.
 *
 * **Waiting is not the same as checking, and this used to confuse the two**
 * (George R5 P2-2). An earlier version of this comment said that a lane which
 * never settles means IndexedDB is wedged, so the reload simply would not
 * happen. That was wrong about the unchanged code, and I wrote it: `db.ts`'s
 * `blocked()` REJECTS with `DatabaseBlockedError` rather than hanging, `getDb`
 * rethrows, `writeEntry` swallows it — correctly; that function is the channel's
 * terminal — and `enqueue` keeps the lane settled so one failed write cannot
 * stop the next. All three are right on their own, and together they meant
 * `flushFailureLog()` resolved cheerfully on exactly the case where reloading
 * destroys the only record of the crash and lands on the same blocked open.
 *
 * So the wait is now followed by a question. `renderFailureStored()` answers
 * whether THIS page's `render` row reached the store — not whether some write
 * did, which a sweep append queued behind a failed one would have satisfied.
 * `false` means the document must not be replaced. `null` means no boundary
 * write was attempted, which is not a failure and must not block Restart.
 *
 * **And holding is only honest for a refusal that can clear** (George R7 P2-1).
 * Two refusals reach here and they are opposites. A blocked open ends when the
 * other copy of the app closes, which is precisely what this screen asks for —
 * holding there protects a row that is about to be storable. The yield latch
 * does not end at all: once this page has given its connection up, `getDb()`
 * rejects with `DatabaseDowngradeError` for the rest of its life (`db.ts`), so
 * every tap refuses identically while the screen says "try again". Both controls
 * on this screen are then dead — Send reads the same database — and on the
 * installed app there is no browser chrome to reload from, which leaves
 * force-quitting from the OS app switcher as the only exit and nothing on a
 * screen built for non-readers to suggest it. The row is already lost in that
 * state and no amount of holding retrieves it, so Restart reloads: that is the
 * pre-#440 behaviour, and reloading is also what picks up the newer build this
 * copy stepped aside for. The Send and failure-log panel controls also surface
 * terminal refusals as restart-only (#455).
 *
 * **There is still deliberately no timeout** (George R4 P2-3, decided by the DRI
 * on 2026-09-17: `busy` yes, timeout no, and unchanged by this round). The
 * preference it encodes — keep the crash row rather than recover the screen — is
 * the same one the check below now actually implements instead of merely
 * claiming, and it is bounded by the paragraph above: keeping the row is worth
 * waiting for only while the row can still be kept.
 *
 * **Not covered end to end by any test, and not claimed to be.** The predicate
 * below is pure and is asserted directly in `tests/failure-log.test.ts`; the
 * `window.location.reload()` it guards has no seam in a node suite and is
 * browser-boundary code. Nothing here is device-verified.
 */
async function reload(): Promise<boolean> {
  await flushFailureLog();
  // `false` only. `null` is a boundary that caught something the sink never
  // tried to store, which is not evidence that storage refused anything.
  //
  // And a refusal is retried HERE rather than treated as final (Frank, round 6),
  // because SOME of what lands here is recoverable and the person holding the
  // phone is who recovers it: a blocked open means another copy of the app is
  // holding an upgrade, and closing it is precisely what this screen's copy asks
  // for. A held Restart that could never succeed would spend the one recovery
  // they have — and the copy under it would be a promise the code does not keep.
  if (renderFailureStored() === false && !(await retryRenderFailureWrite())) {
    // Which is why the hold is conditional on the refusal being clearable. A
    // terminal one cannot become storable no matter how long this screen stays,
    // so holding would cost the reload and save nothing.
    if (!isTerminalOpenRefusal(renderFailureRefusal())) return false;
  }
  window.location.reload();
  return true;
}

/**
 * Restart, with the wait shown.
 *
 * A function component for the same reason `SendLogControl` is one:
 * `ErrorBoundary` is a class (there is still no hook form of
 * `getDerivedStateFromError`) and this needs state.
 *
 * What it fixes (George R4 P2-3): `reload()` awaits the whole log lane, and on a
 * device coming from v3/v4/v5 the crash row's own write is often the first
 * `getDb` open — so it runs the v4 and v5 backfills before `failures` is even
 * created, with any queued transcode-sweep appends on the lane in front of it.
 * Until that settles the screen's PRIMARY recovery control did nothing visible,
 * and `SendLogControl.prepare` is queued on the same lane, so BOTH controls on
 * the screen were inert at once with no affordance. On a screen with almost no
 * text, for a person who may not read, two dead controls is the worst state to
 * be in and the hardest to describe over a phone call.
 *
 * `busy` is never cleared, and that is right rather than lazy: there are exactly
 * two ends to this. The reload happens and the document is replaced, or the
 * flush never settles and the control should still be saying so. A control that
 * quietly went un-busy while nothing had changed would be the dead button again,
 * wearing a spinner first.
 */
function RestartControl() {
  const [restarting, setRestarting] = useState(false);
  // The reload was declined because the crash row was refused by storage. The
  // screen stays, and it says why: a control that returns to idle having done
  // nothing is indistinguishable from a dead button.
  const [held, setHeld] = useState(false);
  return (
    <>
      <Control
        icon="retry"
        label={restarting ? strings.appReloading : strings.appReload}
        variant="primary"
        size={30}
        busy={restarting}
        onClick={() => {
          setHeld(false);
          setRestarting(true);
          void reload().then((reloading) => {
            if (reloading) return;
            // Tappable again on purpose: the blocking copy of the app may have
            // been closed since, which is the whole recovery this state has.
            // Since George R7 P2-1 that is the ONLY way to arrive here —
            // `reload()` no longer holds for a refusal that cannot clear — so
            // `appReloadHeld`'s "Send it, or try again" is now an offer both
            // halves of which can actually succeed.
            setRestarting(false);
            setHeld(true);
          });
        }}
      />
      {restarting && <Notice tone="busy">{strings.appReloading}</Notice>}
      {held && <Notice>{strings.appReloadHeld}</Notice>}
    </>
  );
}

/**
 * Put the reader on the alert's name when the fallback mounts.
 *
 * The heading, not the button. `autoFocus` on an icon-only `Control` moves a
 * screen reader straight to "Restart the app" and can swallow the alert that
 * mounted with it — the action announced with no reason. Focusing the labelled
 * heading inside the `alertdialog` announces the dialog and what happened
 * first, and leaves Restart — the primary action — the very next stop, with
 * Send after it.
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
 * What it deliberately does NOT do: hand a held recording forward. A
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
    // BEFORE the report, so the row this queues has as few competing appends
    // behind it as possible (George R5 P2-3). The sweep is module-scoped and
    // `App`'s unmount does not cancel it, so without this it keeps encoding
    // clips and appending one row per failure into the 50-row ring the screen
    // below is about to send — and can prune this very row before the
    // facilitator finishes the two-gesture Send. PCM is kept and the next launch
    // retries, which is the sweep's own contract.
    quiesceTranscodeSweep();
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

          <RestartControl />

          {/* The log's only door once the tree is gone. */}
          <SendLogControl />
        </div>
      </main>
    );
  }
}
