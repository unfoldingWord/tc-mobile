import { useCallback, useRef, useState } from "react";

import { Control } from "./control";
import { shareControlGlyph } from "./control-affordance";
import { EraseConfirm } from "./erase-confirm";
import { Notice } from "./notice";
import { strings } from "./strings";
import { clearFailureLog } from "@/hooks/failure-log";
import { readSharePlatform } from "@/hooks/share-target";
import type { ScreenLayerBehavior } from "@/hooks/use-screen-layers";
import { useFailureLogShare } from "@/hooks/use-failure-log-share";

interface FailureLogPanelProps {
  /** How many failures the log holds, from the screen that renders the marker. */
  count: number;
  /** Close the surrounding menu — after a send that left the sheet, or a clear. */
  onDone: () => void;
  /**
   * Register the Clear confirm as a system-Back layer (#452 PR3, #374).
   *
   * This panel portals that confirm OVER the surrounding menu rather than
   * replacing it, so it is a second layer, not the same one: without its own
   * registration a Back here would dismiss the MENU underneath and leave the
   * confirm standing over nothing.
   *
   * The panel supplies the behaviour because it owns the state; the screen
   * owns the id and the registration. Both closures are built fresh in the
   * opening handler and close over nothing that can go stale — a ref for
   * `busy()`, a `useState` setter for `dismiss()`.
   */
  onClearConfirmOpen: (behavior: ScreenLayerBehavior) => void;
  /** Unregister it. Called from every path that takes the confirm down. */
  onClearConfirmClose: () => void;
}

/**
 * The failure log's entries in the global menu (#205).
 *
 * ── What this deliberately does not do ──
 *
 * It does not render a single entry. Not one message, not a count of contexts,
 * not a "last failure" line. This app is for people who may not read, and a
 * failure's text is a minified stack in a language the person holding the phone
 * may not speak — #172 is the standing rule that raw browser exception text
 * never reaches a screen here, and a translator-facing panel is the last place
 * to break it. The entries exist to LEAVE the phone; the panel is the door, not
 * a reader.
 *
 * So the whole visible surface is: that something was recorded, how many times,
 * and two actions — send it, or discard it. A non-reader gets the count as a
 * numeral and the alert glyph from {@link Notice}; a screen-reader user gets the
 * same facts as the controls' accessible names.
 *
 * Only mounted while the log is non-empty, so there is no empty state to design
 * and no dead menu row on a phone that has never failed.
 */
export function FailureLogPanel({
  count,
  onDone,
  onClearConfirmOpen,
  onClearConfirmClose,
}: FailureLogPanelProps) {
  // The bin is behind a confirm, like every other destructive write in this app
  // (George R2 P3-3): the segment Erase and the book Delete both go through
  // `EraseConfirm`, and this clear is less recoverable than either — the log is
  // the only record of what went wrong, there is no undo, and the bin sits
  // directly under the Share the thumb has just been using.
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  // The live half of `clearing`, for the confirm's `Layer.busy()` (#452 PR3,
  // invariant 4): the system-Back handler reads it from a `popstate`, with no
  // render between the flip below and the read. `clearing` above stays the
  // rendered one, driving `EraseConfirm`'s own `busy`.
  const clearingRef = useRef(false);

  // Open the Clear confirm AND register it, in the one handler (invariant 6).
  const openClearConfirm = useCallback(() => {
    setConfirmingClear(true);
    onClearConfirmOpen({
      busy: () => clearingRef.current,
      dismiss: () => {
        setConfirmingClear(false);
        onClearConfirmClose();
      },
    });
  }, [onClearConfirmOpen, onClearConfirmClose]);

  // Cancel / Escape / scrim. `EraseConfirm` already refuses these while `busy`,
  // and the layer's own `busy()` refuses Back on the same ref, so this never
  // runs mid-clear from either direction.
  const closeClearConfirm = useCallback(() => {
    setConfirmingClear(false);
    onClearConfirmClose();
  }, [onClearConfirmClose]);
  // `clearFailureLog` directly, not through a hook that also LOADS the entries
  // (George #6, round 1). The panel renders no entry, so reading every stack
  // into React state to render a count would defeat the reason `countFailures`
  // exists — the Books screen already has the number this panel is given.
  // The armed-snapshot drop is NOT here any more (George R4 P2-1). It belongs
  // to the flow — `useFailureLogShare` owns it, so the crash screen's
  // `SendLogControl` gets it too, and so does anything built next. A copy here
  // would be the defect wearing its own fix: two places to remember, one of
  // which was already forgotten once.
  const share = useFailureLogShare();

  // Tap 1 — read the log and render it to a text File, arming the send gesture.
  const onPrepare = useCallback(() => {
    void share.prepare();
  }, [share]);

  // Tap 2 — hand the armed File to the OS share sheet, in a fresh activation.
  // Close on the outcomes that end the flow, and NOT on `retry` (the File is
  // still armed for another tap) or `failed` (its Notice lives in this panel and
  // has to stay visible), exactly as the chapter and book shares do.
  //
  // A failure landing AFTER tap 2 already keeps the menu open, and no extra
  // guard here is what does it (George R2 P3-4, refuted with a test rather than
  // patched). `send` leaves the status on "ready" for its whole duration — it
  // only goes back to "idle" once the chooser has resolved — so the flow's own
  // drop still sees a live payload when the generation moves, resets, and that
  // bumps `runId`. The in-flight send then falls into its `if (!current())
  // return "superseded"` arm, which is not one of the two outcomes that close
  // the menu. The panel is back on tap 1 with the new count beside it, which is
  // exactly the behaviour asked for. `a failure landing while the share sheet is
  // open keeps the menu open` in `e2e/failure-log.spec.ts` pins it: removing the
  // flow's generation-keyed reset kills that case.
  const onSend = useCallback(() => {
    void share.send().then((outcome) => {
      if (outcome === "sent" || outcome === "dismissed") onDone();
    });
  }, [share, onDone]);

  // Clearing empties the store, which drops the count to 0 and unmounts this
  // panel's marker. Close the menu with it rather than leaving an emptied panel
  // standing over two controls that now do nothing.
  const onClear = useCallback(() => {
    // The ref flips first and synchronously — a Back landing in this same task
    // must already see the clear as in flight.
    clearingRef.current = true;
    setClearing(true);
    void clearFailureLog().then(
      () => {
        // `onDone` closes the surrounding menu, and that close unregisters BOTH
        // this confirm's layer and the menu's own (`closeGlobalMenu`), so no
        // separate `onClearConfirmClose()` is owed here. The ref is cleared for
        // the same reason `clearing` is not: this panel unmounts with the menu.
        clearingRef.current = false;
        onDone();
      },
      () => {
        clearingRef.current = false;
        setClearing(false);
        setConfirmingClear(false);
        // The confirm comes down on a failed clear, so its layer does too.
        onClearConfirmClose();
        // A failed clear leaves the log exactly as it was, which is the safe
        // side of this write — nothing is lost, and the marker keeps its count,
        // so the panel stays put and a second tap can try again. Deliberately
        // no copy: a fourth string for a case a retry resolves is not worth the
        // reading load on a screen built for people who may not read.
        //
        // NOT silent, which is what AGENTS.md forbids: `clearFailureLog`
        // reports the reason through the funnel on its way past, so it lands in
        // the very log the clear failed to empty and leaves with the next send
        // (Frank #2 ≡ George #4, round 1 for the channel; Frank, takeover round
        // 9, for making that channel the durable one rather than the console).
      }
    );
  }, [onClearConfirmClose, onDone]);

  const errorText =
    share.error === "nothing"
      ? strings.shareFailureLogNothing
      : share.error === "failed"
        ? strings.shareFailureLogFailed
        : null;
  // The platform's own share mark (#490), so this build never shows a
  // different share glyph here than on the chapter and book menus — unless
  // the last send was unconfirmed (Frank at `238820a` P2, #491), which
  // overrides it the same way `shareControlAffordance`'s idle cell does for
  // chapter/book: `share-closed`, the dismissed outcome's own mark, not a
  // new glyph.
  const shareGlyph = share.sendUnconfirmed
    ? "share-closed"
    : shareControlGlyph(readSharePlatform());

  return (
    <>
      {/* The count, with the alert glyph — the state-in-place read for a
          non-reader, and the panel's only statement of what is wrong. */}
      <Notice>
        <span className="min-w-0 flex-1">{strings.failuresMarker(count)}</span>
      </Notice>
      <Notice tone="info">{strings.failuresTeach}</Notice>

      {share.status === "ready" ? (
        <Control
          icon={shareGlyph}
          label={strings.shareSend}
          variant="primary"
          autoFocus
          onClick={onSend}
        />
      ) : (
        <Control
          icon={shareGlyph}
          label={
            share.sendUnconfirmed
              ? strings.shareFailureLogUnconfirmed
              : strings.shareFailureLog
          }
          variant="quiet"
          onClick={onPrepare}
        />
      )}
      {share.status === "preparing" && (
        <Notice tone="busy">{strings.shareFailureLogPreparing}</Notice>
      )}
      {errorText && <Notice>{errorText}</Notice>}

      {/* Discard, after the send. Below Share on purpose: the destructive
          action is never the first thing under the thumb, and it is never the
          menu's open-edge focus target while Share is enabled. */}
      <Control
        icon="trash"
        label={strings.clearFailureLog}
        variant="quiet"
        onClick={openClearConfirm}
      />
      <EraseConfirm
        open={confirmingClear}
        title={strings.clearFailureLogConfirmTitle}
        confirmLabel={strings.clearFailureLogConfirm}
        cancelLabel={strings.eraseCancel}
        busy={clearing}
        onConfirm={onClear}
        onCancel={closeClearConfirm}
      />
    </>
  );
}
