import { useState } from "react";

import { Control } from "./control";
import { Icon } from "./icon";
import {
  recoveryAttempts,
  recoverySafetyLine,
  recoveryTitle,
  restartLabel,
} from "./recovery-copy";
import type { SaveFailureKind } from "@/hooks/save-failure";

/**
 * Restart the app from disk — the same exit `DatabasePanel` and `ErrorBoundary`
 * offer, and for the same reason: everything already saved is in IndexedDB, and
 * a reload is what picks up the newer build the service worker has activated.
 */
function reload(): void {
  window.location.reload();
}

interface SaveFailedProps {
  state: "saving" | "failed";
  kind: SaveFailureKind | null;
  /**
   * An edit-only save (B5) rather than a recording. It words this screen
   * honestly: discarding a failed edit-save drops the edited buffer while the
   * previously stored recording survives on disk, so the record path's "delete
   * this recording for good" would be a lie about an edit.
   */
  editOnly: boolean;
  /** Which segment the held recording belongs to, when it is in this chapter. */
  ordinal: number | null;
  attempts: number;
  onRetry: () => void;
  onDiscard: () => void;
}

/**
 * The screen that stands between a failed save and losing the recording.
 *
 * It takes the whole screen and offers no way out that is not a decision.
 * There is no backdrop to tap through and no Escape to press, because the only
 * two honest answers are "try again" and "throw this away", and the second one
 * costs a translator work that cannot be recovered — the audio only ever
 * existed on this device, in this session.
 *
 * Discard is two taps for the same reason. Retry is the large one.
 */
export function SaveFailed({
  state,
  kind,
  editOnly,
  ordinal,
  attempts,
  onRetry,
  onDiscard,
}: SaveFailedProps) {
  // The arming remembers WHICH attempt it belongs to, rather than just that it
  // happened. The buttons unmount during a retry but this component does not,
  // so a plain boolean would carry the confirmation across Retry — and the next
  // single tap would delete the only copy of the take. Deriving it means a new
  // attempt, or a retry in flight, disarms on its own. Two taps mean two taps.
  const [armedAt, setArmedAt] = useState<number | null>(null);
  // Armed separately from Discard, and derived the same way for the same reason:
  // restarting destroys the held recording exactly as discarding does, so it
  // takes two taps too (Frank R4 P1). Two slots rather than one so arming one
  // control never arms the other.
  const [restartArmedAt, setRestartArmedAt] = useState<number | null>(null);
  const saving = state === "saving";
  const armed = armedAt === attempts && !saving;
  const restartArmed = restartArmedAt === attempts && !saving;

  // Shown on every failed save, never an instruction to leave the app: a failed
  // save is RAM-only (the commit is one transaction, #38) whatever the cause, so
  // sending the translator off to free space would risk the OS discarding the
  // only copy. The attempt count is a fainter extra line beside it, not instead.
  const safetyLine = saving ? null : recoverySafetyLine(editOnly, kind);
  const attemptsLine = saving ? null : recoveryAttempts(kind, attempts);

  // The one failure this screen cannot offer a retry for: a newer copy of the
  // app has moved the database past this build, so `getDb()` fails the version
  // check before any transaction and will do so on every attempt. Offering "Try
  // saving again" here teaches retry-and-stay for a condition that is already
  // decided, and leaves the honest exit reachable only through Discard — which
  // deletes the only copy (George R2 P2-1). The control becomes the same
  // restart `DatabasePanel` and `ErrorBoundary` offer, which is what picks up
  // the newer build. Discard stays, unchanged and still two taps.
  const terminal = kind === "downgrade";

  // The held work: a fresh recording, or the edited buffer of one. Every visible
  // line names it correctly, because on the edit path the previously stored
  // recording is untouched — discarding drops only the edit.
  const subject = editOnly ? "edited recording" : "recording";
  const stillHere =
    ordinal === null
      ? `Your ${subject} is still here.`
      : `Your ${subject} of segment ${ordinal} is still here.`;
  const discardLabel = armed
    ? editOnly
      ? "Tap again to discard these changes"
      : "Tap again to delete this recording for good"
    : editOnly
      ? "Discard these changes"
      : "Delete this recording";

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={
        editOnly ? "Your changes are not saved" : "This recording is not saved"
      }
      className="flex w-full max-w-md flex-col items-center gap-[18px] px-[22px] text-center"
    >
      <span style={{ color: saving ? "var(--s-ink-muted)" : "var(--s-live)" }}>
        <Icon name={saving ? "retry" : "alert"} size={56} />
      </span>

      <p className="t-title" style={{ color: "var(--s-ink)" }}>
        {saving ? "Saving" : recoveryTitle(kind ?? "unknown", editOnly)}
      </p>

      <p className="text-[13px]" style={{ color: "var(--s-ink-muted)" }}>
        {stillHere}
      </p>

      {!saving && (
        <>
          <Control
            icon="retry"
            label={
              terminal
                ? restartLabel(editOnly, restartArmed)
                : "Try saving again"
            }
            variant="primary"
            size={30}
            className={
              terminal && restartArmed ? "text-[var(--s-live)]" : undefined
            }
            autoFocus
            onClick={
              terminal
                ? () => (restartArmed ? reload() : setRestartArmedAt(attempts))
                : onRetry
            }
          />

          {terminal && restartArmed && (
            <p className="text-[12px]" style={{ color: "var(--s-live)" }}>
              {editOnly
                ? "Tap again and these changes are gone."
                : "Tap again and this recording is gone."}
            </p>
          )}

          {safetyLine && (
            <p className="text-[13px]" style={{ color: "var(--s-ink-muted)" }}>
              {safetyLine}
            </p>
          )}

          {attemptsLine && (
            <p className="text-[12px]" style={{ color: "var(--s-ink-faint)" }}>
              {attemptsLine}
            </p>
          )}

          <div className="mt-[10px] flex flex-col items-center gap-[8px]">
            <Control
              icon="trash"
              label={discardLabel}
              variant="quiet"
              className={armed ? "text-[var(--s-live)]" : undefined}
              onClick={() => (armed ? onDiscard() : setArmedAt(attempts))}
            />
            {armed && (
              <p className="text-[12px]" style={{ color: "var(--s-live)" }}>
                {editOnly
                  ? "Tap again to discard them."
                  : "Tap again to delete it."}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
