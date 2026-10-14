import { useCallback, useState } from "react";

import { useFailureLogShare } from "@/hooks/use-failure-log-share";
import { readSharePlatform } from "@/hooks/share-target";
import { Control } from "./control";
import { shareControlGlyph } from "./control-affordance";
import { Notice } from "./notice";
import { NOTHING_FAILED_TONE } from "./notice-tone";
import {
  sendLogHandoffView,
  sendLogLabel,
  type SendLogHandoff,
} from "./send-log-control-view";
import { strings } from "@/lib/strings";

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
 *
 * ── #1088: a visible label, and a confirmation after the hand-off ──
 *
 * Two residuals from #948's audit thread. First, this control had NO visible
 * text at all — `Control`'s "visible UI carries no text" default is right for
 * the translator-facing controls around it, but this one is, by its own
 * comment above, "for the facilitator standing next to the translator, not
 * for the translator", and a facilitator can read. The visible span below
 * reads `sendLogLabel` (`send-log-control-view.ts`), which speaks the SAME
 * `strings` entries the two `Control`s' own inline labels do — not a new
 * sentence (#169) — kept as a second small read of that table, rather than
 * one hoisted `const` both share, only so the existing
 * `tests/failure-log-share.test.ts` regression guard (which locates the idle
 * label INSIDE the not-ready `<Control>`'s own JSX) keeps meaning what it
 * already asserts.
 *
 * Second, only an UNPROVEN send ever left a trace — `sendUnconfirmed`
 * relabels the idle control on its next render, but a genuinely handed-off
 * send or a dismissed sheet left the screen exactly as it was a moment
 * before the tap, with no state-in-place answer to "did that do anything?"
 * (AGENTS.md's "Errors have a channel", the same standard a silent success
 * fails too). `handoff` below is local component state, not the hook's: it
 * is a display fact about the LAST send, layered on top of the flow's own
 * `sendUnconfirmed` contract rather than folded into it, so the browser-
 * boundary hook stays exactly what it was. `sendLogHandoffView` reuses the
 * SAME outcome table and copy the chapter/book share overlay settles on
 * (`share-outcome-glyph.ts`'s D16 table, `strings.shareSent`/
 * `shareDismissed`/`shareUnproven`) — never "sent" or "delivered", the same
 * rule those three strings already follow, because this app can only say the
 * log reached the OS share sheet, not what happened after.
 */
export function SendLogControl() {
  const share = useFailureLogShare();
  // The hand-off confirmation (#1088 item 2) — see the docblock above. Reset
  // on a fresh prepare, the same moment `useFailureLogShare.prepare()` itself
  // clears `error` and `sendUnconfirmed`: a new attempt is the acknowledgment
  // of whatever the last one showed.
  const [handoff, setHandoff] = useState<SendLogHandoff | null>(null);

  const onPrepare = useCallback(() => {
    setHandoff(null);
    void share.prepare();
  }, [share]);

  // No `onDone` to close: there is nothing to close, and after a send the
  // control itself stays exactly as it was — only the line under it changes,
  // to whichever settle {@link SendLogHandoff} covers. The flow returns to
  // `idle` on its own either way.
  const onSend = useCallback(() => {
    void share.send().then((outcome) => {
      if (
        outcome === "sent" ||
        outcome === "dismissed" ||
        outcome === "unproven"
      ) {
        setHandoff(outcome);
      }
    });
  }, [share]);

  // `nothing` is not here: it is not a failure, so it renders below as its
  // own Notice in the not-a-failure tone (#147's class, `notice-tone.ts`).
  const errorText =
    share.error === "failed"
      ? strings.shareFailureLogFailed
      : share.error === "restart"
        ? strings.shareFailureLogRestart
        : null;

  // The platform's own mark (#490), not a hardcoded tray — `control-affordance
  // .ts`'s own header names this control as one of the three that must share
  // it (George r1 P3-4, #491): on the Android APK a crash/save-failed screen
  // showed the tray here while every ≡ menu showed three dots. Overridden the
  // same way `failure-log-panel.tsx` is (Frank at `238820a` P2, #491) when
  // the last send was unconfirmed.
  const glyph = share.sendUnconfirmed
    ? "share-closed"
    : shareControlGlyph(readSharePlatform());

  const handoffView = handoff ? sendLogHandoffView(handoff) : null;

  return (
    <div className="flex flex-col items-center gap-[4px]">
      {share.status === "ready" ? (
        <Control icon={glyph} label={strings.shareSend} onClick={onSend} />
      ) : (
        <Control
          icon={glyph}
          label={
            share.sendUnconfirmed
              ? strings.shareFailureLogUnconfirmed
              : strings.shareFailureLog
          }
          variant="quiet"
          onClick={onPrepare}
        />
      )}
      {/* #1088 item 2 — the visible half of the label above. `sendLogLabel`
          is the SAME table the two `Control`s above read inline (kept inline
          there rather than hoisted, so `tests/failure-log-share.test.ts`'s
          existing source-shape assertion for this control's idle label stays
          true): computed a second time here, from the same `strings` table
          entries, not a new sentence. `aria-hidden` because the label above
          already IS the accessible name; this span repeats it on screen
          rather than saying it twice to a screen reader. */}
      <span
        className="send-log-label text-ink-muted text-[12px]"
        aria-hidden="true"
      >
        {sendLogLabel(share.status === "ready", share.sendUnconfirmed)}
      </span>
      {share.status === "preparing" && (
        <Notice tone="busy">{strings.shareFailureLogPreparing}</Notice>
      )}
      {share.error === "nothing" && (
        <Notice tone={NOTHING_FAILED_TONE}>
          {strings.shareFailureLogNothing}
        </Notice>
      )}
      {errorText && <Notice>{errorText}</Notice>}
      {handoffView && (
        <Notice tone={handoffView.tone} icon={handoffView.icon}>
          {handoffView.text}
        </Notice>
      )}
    </div>
  );
}
