import { useState } from "react";

import { Control } from "./control";
import { Icon } from "./icon";
import type { SaveFailureKind } from "@/hooks/save-failure";

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
 * The headline. `quota` is the same either way — the phone is full whether the
 * held work is a recording or an edit — but the `unknown` line names what could
 * not be saved so the two paths read honestly.
 */
function failureTitle(kind: SaveFailureKind, editOnly: boolean): string {
  if (kind === "quota") return "No room left on this phone.";
  return editOnly
    ? "Your changes could not be saved."
    : "This recording could not be saved.";
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
  const saving = state === "saving";
  const armed = armedAt === attempts && !saving;

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
        {saving ? "Saving" : failureTitle(kind ?? "unknown", editOnly)}
      </p>

      <p className="text-[13px]" style={{ color: "var(--s-ink-muted)" }}>
        {stillHere}
      </p>

      {!saving && (
        <>
          <Control
            icon="retry"
            label="Try saving again"
            variant="primary"
            size={30}
            autoFocus
            onClick={onRetry}
          />

          {attempts > 1 && (
            <p className="text-[12px]" style={{ color: "var(--s-ink-faint)" }}>
              {kind === "quota"
                ? "Free some space on the phone, then try again."
                : `Attempts: ${attempts}`}
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
