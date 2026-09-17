import { useCallback, useEffect, useRef, useState } from "react";

import { Control } from "./control";
import { EraseConfirm } from "./erase-confirm";
import { Notice } from "./notice";
import { strings } from "./strings";
import { clearFailureLog } from "@/hooks/failure-log";
import { useFailureLogShare } from "@/hooks/use-failure-log-share";

interface FailureLogPanelProps {
  /** How many failures the log holds, from the screen that renders the marker. */
  count: number;
  /** Close the surrounding menu — after a send that left the sheet, or a clear. */
  onDone: () => void;
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
export function FailureLogPanel({ count, onDone }: FailureLogPanelProps) {
  // The bin is behind a confirm, like every other destructive write in this app
  // (George R2 P3-3): the segment Erase and the book Delete both go through
  // `EraseConfirm`, and this clear is less recoverable than either — the log is
  // the only record of what went wrong, there is no undo, and the bin sits
  // directly under the Share the thumb has just been using.
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  // `clearFailureLog` directly, not through a hook that also LOADS the entries
  // (George #6, round 1). The panel renders no entry, so reading every stack
  // into React state to render a count would defeat the reason `countFailures`
  // exists — the Books screen already has the number this panel is given.
  const share = useFailureLogShare();

  // Drop an armed payload when a NEW failure lands between the two gestures
  // (George P3-D, round 2). Tap 1 renders a snapshot of the log; the count
  // beside it is live. Without this, a failure arriving during that window made
  // the Notice say "2 problems recorded" while Share still held the one-entry
  // file — the screen and the file disagreeing about what is being sent, which
  // is exactly the kind of quiet mismatch a maintainer cannot detect from the
  // file alone. Re-arming costs one tap and is the honest answer.
  const armedAt = useRef(count);
  useEffect(() => {
    if (share.status === "idle") {
      armedAt.current = count;
      return;
    }
    if (count !== armedAt.current) {
      armedAt.current = count;
      share.reset();
    }
  }, [count, share]);

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
  // only goes back to "idle" once the chooser has resolved — so the effect above
  // still sees a live payload when the count moves, calls `share.reset()`, and
  // that bumps `runId`. The in-flight send then falls into its `if (!current())
  // return "superseded"` arm, which is not one of the two outcomes that close
  // the menu. The panel is back on tap 1 with the new count beside it, which is
  // exactly the behaviour asked for. `a failure landing while the share sheet is
  // open keeps the menu open` in `e2e/failure-log.spec.ts` pins it: reverting
  // the count-change `share.reset()` kills that case.
  const onSend = useCallback(() => {
    void share.send().then((outcome) => {
      if (outcome === "sent" || outcome === "dismissed") onDone();
    });
  }, [share, onDone]);

  // Clearing empties the store, which drops the count to 0 and unmounts this
  // panel's marker. Close the menu with it rather than leaving an emptied panel
  // standing over two controls that now do nothing.
  const onClear = useCallback(() => {
    setClearing(true);
    void clearFailureLog().then(
      () => onDone(),
      () => {
        setClearing(false);
        setConfirmingClear(false);
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
  }, [onDone]);

  const errorText =
    share.error === "nothing"
      ? strings.shareFailureLogNothing
      : share.error === "failed"
        ? strings.shareFailureLogFailed
        : null;

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
          icon="share"
          label={strings.shareSend}
          variant="primary"
          autoFocus
          onClick={onSend}
        />
      ) : (
        <Control
          icon="share"
          label={strings.shareFailureLog}
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
        onClick={() => setConfirmingClear(true)}
      />
      <EraseConfirm
        open={confirmingClear}
        title={strings.clearFailureLogConfirmTitle}
        confirmLabel={strings.clearFailureLogConfirm}
        cancelLabel={strings.eraseCancel}
        busy={clearing}
        onConfirm={onClear}
        onCancel={() => setConfirmingClear(false)}
      />
    </>
  );
}
