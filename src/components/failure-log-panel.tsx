import { useCallback } from "react";

import { Control } from "./control";
import { Notice } from "./notice";
import { strings } from "./strings";
import { useFailureEntries } from "@/hooks/failure-log";
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
  // Mounted only while the panel is up, so the stacks are in memory only while
  // someone is looking at the door to them.
  const { clear } = useFailureEntries();
  const share = useFailureLogShare();

  // Tap 1 — read the log and render it to a text File, arming the send gesture.
  const onPrepare = useCallback(() => {
    void share.prepare();
  }, [share]);

  // Tap 2 — hand the armed File to the OS share sheet, in a fresh activation.
  // Close on the outcomes that end the flow, and NOT on `retry` (the File is
  // still armed for another tap) or `failed` (its Notice lives in this panel and
  // has to stay visible), exactly as the chapter and book shares do.
  const onSend = useCallback(() => {
    void share.send().then((outcome) => {
      if (outcome === "sent" || outcome === "dismissed") onDone();
    });
  }, [share, onDone]);

  // Clearing empties the store, which drops the count to 0 and unmounts this
  // panel's marker. Close the menu with it rather than leaving an emptied panel
  // standing over two controls that now do nothing.
  const onClear = useCallback(() => {
    void clear().then(
      () => onDone(),
      () => {
        // A failed clear leaves the log exactly as it was, which is the safe
        // side of this write — nothing is lost. Saying so would need a fourth
        // string for a case a second tap resolves, so the panel stays put and
        // the marker keeps its count. The write's own reason went to the
        // console for a maintainer.
      }
    );
  }, [clear, onDone]);

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
        onClick={onClear}
      />
    </>
  );
}
