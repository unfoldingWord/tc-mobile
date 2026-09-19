import { useCallback } from "react";

import { useFailureLogShare } from "@/hooks/use-failure-log-share";
import { readSharePlatform } from "@/hooks/share-target";
import { Control } from "./control";
import { shareControlGlyph } from "./control-affordance";
import { Notice } from "./notice";
import { strings } from "./strings";

/**
 * Send the durable failure log from a full-screen recovery surface (#456).
 *
 * Why this exists at all (George, round 2 on #440, for the first caller):
 * `ErrorBoundary` REPLACES the tree, so the `≡` marker and the menu that
 * normally sends the log are unmounted with `BooksScreen`. On a deterministic
 * render throw on the home path, Restart reaches that same screen again — so
 * without a control there, the one failure the durable log most exists to
 * carry is the one failure that could never leave the phone.
 *
 * `SaveFailed` shares the exact same shape (#456): it also REPLACES the tree
 * — a held take deliberately blocks the way back to `BooksScreen`'s `≡` menu
 * — and a facilitator whose save just failed is in exactly the moment the
 * problem report is worth sending. `DatabasePanel` does NOT get this control:
 * #456 itself calls that a design call — if the database is unreachable the
 * log cannot be read from it either, so a control there could only say so
 * honestly, which is different work.
 *
 * Extracted out of `error-boundary.tsx` into its own module (rather than
 * `save-failed.tsx` importing from `error-boundary.tsx`, or being copied) so
 * both full-screen callers share one implementation and one place to change
 * the copy or the gesture.
 *
 * A function component because both callers need hooks and one of them
 * (`ErrorBoundary`) is a class — there is still no hook form of
 * `getDerivedStateFromError` in React 19.
 *
 * Same two-gesture contract as everywhere else, and deliberately SECOND in
 * render order after each screen's primary action (Restart / Retry-Restart):
 * this control is quiet — it is for the facilitator standing next to the
 * translator, not for the translator.
 *
 * The armed gesture DOES change the control's paint (`default`, not `quiet`),
 * and that is not decoration. Both taps are the same glyph in the same place,
 * so with one paint for both states the only thing separating "prepare" from
 * "send" was the accessible name — text, on screens this app is least
 * willing to make anyone read. The menu panel solves it by going `primary`;
 * here `primary` is taken by each screen's primary control and a second one
 * would compete with the action a non-reader should reach first, so the
 * armed state steps up one level instead of two.
 */
export function SendLogControl() {
  const share = useFailureLogShare();

  const onPrepare = useCallback(() => {
    void share.prepare();
  }, [share]);

  // No `onDone` to close: there is nothing to close, and after a send the
  // screen stays exactly as it was. The flow returns to `idle` on its own.
  const onSend = useCallback(() => {
    void share.send();
  }, [share]);

  const errorText =
    share.error === "nothing"
      ? strings.shareFailureLogNothing
      : share.error === "failed"
        ? strings.shareFailureLogFailed
        : null;

  // The platform's own mark (#490), not a hardcoded tray — `control-affordance
  // .ts`'s own header names this control as one of the three that must share
  // it (George r1 P3-4, #491): on the Android APK a crash/save-failed screen
  // showed the tray here while every ≡ menu showed three dots.
  const glyph = shareControlGlyph(readSharePlatform());

  return (
    <>
      {share.status === "ready" ? (
        <Control icon={glyph} label={strings.shareSend} onClick={onSend} />
      ) : (
        <Control
          icon={glyph}
          label={strings.shareFailureLog}
          variant="quiet"
          onClick={onPrepare}
        />
      )}
      {share.status === "preparing" && (
        <Notice tone="busy">{strings.shareFailureLogPreparing}</Notice>
      )}
      {errorText && <Notice>{errorText}</Notice>}
    </>
  );
}
