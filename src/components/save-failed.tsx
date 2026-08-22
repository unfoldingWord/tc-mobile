import { useState } from "react";

import { Control } from "./control";
import { Icon } from "./icon";
import type { SaveFailureKind } from "@/hooks/save-failure";

interface SaveFailedProps {
  state: "saving" | "failed";
  kind: SaveFailureKind | null;
  /** Which section the held recording belongs to, when it is in this chapter. */
  ordinal: number | null;
  attempts: number;
  onRetry: () => void;
  onDiscard: () => void;
}

const MESSAGE: Record<SaveFailureKind, string> = {
  quota: "No room left on this phone.",
  unknown: "This recording could not be saved.",
};

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
  ordinal,
  attempts,
  onRetry,
  onDiscard,
}: SaveFailedProps) {
  const [armed, setArmed] = useState(false);
  const saving = state === "saving";

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="This recording is not saved"
      className="flex w-full max-w-md flex-col items-center gap-[18px] px-[22px] text-center"
    >
      <span style={{ color: saving ? "var(--s-ink-muted)" : "var(--s-live)" }}>
        <Icon name={saving ? "retry" : "alert"} size={56} />
      </span>

      <p className="t-title" style={{ color: "var(--s-ink)" }}>
        {saving ? "Saving" : MESSAGE[kind ?? "unknown"]}
      </p>

      <p className="text-[13px]" style={{ color: "var(--s-ink-muted)" }}>
        {ordinal === null
          ? "Your recording is still here."
          : `Your recording of section ${ordinal} is still here.`}
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
              label={
                armed
                  ? "Tap again to delete this recording for good"
                  : "Delete this recording"
              }
              variant="quiet"
              className={armed ? "text-[var(--s-live)]" : undefined}
              onClick={() => (armed ? onDiscard() : setArmed(true))}
            />
            {armed && (
              <p className="text-[12px]" style={{ color: "var(--s-live)" }}>
                Tap again to delete it.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
