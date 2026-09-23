import { useEffect, useState } from "react";

import { Control } from "./control";
import { Icon } from "./icon";
import { Notice } from "./notice";
import {
  recoveryAttempts,
  recoverySafetyLine,
  recoveryTitle,
  restartLabel,
} from "./recovery-copy";
import { SendLogControl } from "./send-log-control";
import { strings } from "./strings";
import { flushFailureLog } from "@/hooks/failure-log";
import {
  pauseTranscodeSweep,
  resumeTranscodeSweep,
} from "@/hooks/finish-transcode";
import type { SaveFailureKind } from "@/hooks/save-failure";
import { restartAfterFlush } from "@/lib/restart-after-flush";

/**
 * Restart the app from disk — the same exit `DatabasePanel` and `ErrorBoundary`
 * offer, and for the same reason: everything already saved is in IndexedDB, and
 * a reload is what picks up the newer build the service worker has activated.
 */
function reload(): void {
  window.location.reload();
}

const SAVE_FAILED_SWEEP_PAUSE = "save-failed";

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
  /**
   * The chapter clipboard also holds a cut phrase, which the terminal restart
   * below destroys along with the recording.
   *
   * The same bit `DatabasePanel` takes, and it is here because this screen
   * OUTRANKS that panel: while a take is held, `databasePanel` is null, so the
   * panel's two-tap — the one that names the cut phrase — cannot mount, and this
   * screen's restart is the only control the translator is offered. Naming only
   * the recording would make the confirmation incomplete on exactly the tap that
   * destroys both (George R5 P2).
   */
  holdsCutAudio: boolean;
  attempts: number;
  onRetry: () => void;
  onDiscard: () => void;
}

/**
 * The screen that stands between a failed save and losing the recording.
 *
 * It takes the whole screen and offers no way out that is not a decision.
 * There is no backdrop to tap through and no Escape to press, because the only
 * exits must acknowledge held work that cannot be recovered after discard.
 *
 * Discard takes two taps. Retry is primary for retryable failures; downgrade
 * offers Restart, and a stale target makes Discard the primary exit.
 */
export function SaveFailed({
  state,
  kind,
  editOnly,
  ordinal,
  holdsCutAudio,
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
  // Set on the second tap of the terminal restart, before the flush; never
  // cleared, on purpose (#458) — the two ends of this are the reload happening
  // (the document is replaced) or the flush never settling, and a control that
  // quietly went un-busy while nothing had changed would be a dead button
  // wearing a spinner first, the same reasoning `RestartControl` documents.
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    pauseTranscodeSweep(SAVE_FAILED_SWEEP_PAUSE);
    return () => resumeTranscodeSweep(SAVE_FAILED_SWEEP_PAUSE);
  }, []);

  const saving = state === "saving";
  const armed = armedAt === attempts && !saving;
  const restartArmed = restartArmedAt === attempts && !saving;

  // Shown on every failed save, never an instruction to leave the app: a failed
  // save is RAM-only (the commit is one transaction, #38) whatever the cause, so
  // sending the translator off to free space would risk the OS discarding the
  // only copy. The attempt count is a fainter extra line beside it, not instead.
  const safetyLine = saving ? null : recoverySafetyLine(editOnly, kind);
  const attemptsLine = saving ? null : recoveryAttempts(kind, attempts);

  // Two failures this screen cannot offer a retry for:
  //
  // - `downgrade`: a newer copy of the app has moved the database past this
  //   build, so `getDb()` fails before any transaction and will do so on every
  //   attempt. The control becomes the same restart `DatabasePanel` and
  //   `ErrorBoundary` offer, which is what picks up the newer build (George R2
  //   P2-1).
  // - `stale`: another live copy deleted the chapter/segment this take belongs
  //   to (#378). There is no row a Retry could write, and a restart would only
  //   lose the held RAM audio under a different label, so no retry/restart
  //   control is rendered; Discard is promoted to the primary exit.
  const terminal = kind === "downgrade";
  const stale = kind === "stale";

  // The held work: a fresh recording, or the edited buffer of one. Every visible
  // line names it correctly, because on the edit path the previously stored
  // recording is untouched — discarding drops only the edit. The wording lives
  // in `strings.ts`, where the recovery panel reads the same three sentences
  // (#169) — the two screens each held their own copy of them until then.
  const stillHere = strings.saveFailedStillHere(editOnly, ordinal);
  const discardLabel = armed
    ? editOnly
      ? strings.discardChangesArmed
      : strings.discardRecordingArmed
    : editOnly
      ? strings.discardChanges
      : strings.discardRecording;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={strings.saveFailedLabel(editOnly)}
      className="flex w-full max-w-md flex-col items-center gap-[18px] px-[22px] text-center"
    >
      <span className={saving ? "text-ink-muted" : "text-live"}>
        <Icon name={saving ? "retry" : "alert"} size={56} />
      </span>

      <p className="t-title text-ink">
        {saving
          ? strings.saveFailedSaving
          : recoveryTitle(kind ?? "unknown", editOnly)}
      </p>

      <p className="text-ink-muted text-[13px]">{stillHere}</p>

      {!saving && (
        <>
          {!stale && (
            <Control
              icon="retry"
              label={
                terminal
                  ? restarting
                    ? strings.appReloading
                    : restartLabel(
                        editOnly ? "changes" : "recording",
                        restartArmed,
                        holdsCutAudio
                      )
                  : strings.saveFailedRetry
              }
              variant="primary"
              size={30}
              className={terminal && restartArmed ? "text-live" : undefined}
              busy={terminal && restarting}
              autoFocus
              onClick={
                terminal
                  ? () =>
                      restartArmed
                        ? void restartAfterFlush(
                            restarting,
                            () => setRestarting(true),
                            flushFailureLog,
                            reload
                          )
                        : setRestartArmedAt(attempts)
                  : onRetry
              }
            />
          )}

          {terminal && restarting && (
            <Notice tone="busy">{strings.appReloading}</Notice>
          )}

          {terminal && restartArmed && !restarting && (
            <p className="text-live text-[12px]">
              {strings.restartLossLine(
                editOnly ? "changes" : "recording",
                holdsCutAudio
              )}
            </p>
          )}

          {/* The log's other door (#456): this screen REPLACES the tree the
              same way `ErrorBoundary`'s does — a held take blocks the way
              back to Books' `≡` menu — and a facilitator whose save just
              failed is in exactly the moment the problem report is worth
              sending. Same order as `ErrorBoundary`: primary action first,
              this one quiet, right after it. `DatabasePanel` does not get
              this — #456 calls that a design call, not this PR's scope.

              Withheld on the terminal (downgrade) arm, same condition that
              already swaps Retry for Restart: a `DatabaseDowngradeError` has
              latched `getDb()` for the life of the page, so
              `prepare()` -> `readFailureLog()` -> `getDb()` would reject on
              every tap here too, offering a door that can never open
              (George R1 P2-1). This is the same reason `DatabasePanel`
              carries no Send control.

              `ErrorBoundary` can one-way quiesce the transcode sweep because
              its only exit is a reload. This screen's primary exit is Retry on
              the SAME page, so it pauses the module-scoped sweep while mounted
              and resumes on unmount instead; otherwise a live failing sweep can
              churn the armed share and prune the 50-row ring before a Send tap
              lands (unfoldingWord/tc-mobile#514). */}
          {!terminal && <SendLogControl />}

          {safetyLine && (
            <p className="text-ink-muted text-[13px]">{safetyLine}</p>
          )}

          {attemptsLine && (
            <p className="text-ink-faint text-[12px]">{attemptsLine}</p>
          )}

          <div className="mt-[10px] flex flex-col items-center gap-[8px]">
            <Control
              icon="trash"
              label={discardLabel}
              variant={stale ? "primary" : "quiet"}
              className={armed ? "text-live" : undefined}
              autoFocus={stale}
              onClick={() => (armed ? onDiscard() : setArmedAt(attempts))}
            />
            {armed && (
              <p className="text-live text-[12px]">
                {editOnly
                  ? strings.discardChangesHint
                  : strings.discardRecordingHint}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
