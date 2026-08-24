import { Control } from "./control";
import { Icon } from "./icon";
import { Notice } from "./notice";
import { Waveform } from "./waveform";
import type { RecorderState } from "@/hooks/use-recorder";
import { formatDuration } from "@/lib/utils";
import type { ChapterCard, SectionCard } from "@/types/view";

interface SectionViewProps {
  chapter: ChapterCard;
  section: SectionCard;
  /**
   * The whole recorder state, not just "is it recording".
   *
   * A boolean hid `"requesting"` — the seconds the permission prompt is up —
   * and back and the stepper were fully live in it. Tapping next there let the
   * microphone open for a section the translator had already left.
   */
  recorderState: RecorderState;
  elapsedMs: number;
  playing: boolean;
  referencePlaying: boolean;
  /** Whether this device can record at all. Silent everywhere before. */
  supported: boolean;
  /**
   * A finished take is still being written.
   *
   * The app holds one unsaved take at a time, so recording again is refused
   * while a save is in flight — and a refusal the screen does not show is the
   * same defect the `Notice` exists for: the button simply does nothing. So the
   * refusal is rendered instead of hidden.
   */
  saving: boolean;
  /** Which section the in-flight save belongs to, when it is known. */
  savingOrdinal: number | null;
  error: string | null;
  onBack: () => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  onRecord: () => void;
  onStop: () => void;
  onPlay: () => void;
  onToggleReference: () => void;
}

/**
 * One section, filling the screen.
 *
 * This is where the work happens, so it holds only what the work needs. From
 * the moment the microphone is asked for until it is released, everything that
 * leaves this section is removed — back and **the stepper** — so there is
 * nothing to press by accident mid-take, and a take is the one thing here that
 * cannot be undone.
 */
export function SectionView({
  chapter,
  section,
  recorderState,
  elapsedMs,
  playing,
  referencePlaying,
  supported,
  saving,
  savingOrdinal,
  error,
  onBack,
  onPrev,
  onNext,
  onRecord,
  onStop,
  onPlay,
  onToggleReference,
}: SectionViewProps) {
  const recorded = section.durationMs !== null;
  const art = section.imageUrl ?? section.thumbUrl;
  /** Capturing: the red dot and the timer mean sound is going in right now. */
  const capturing = recorderState === "recording";
  /** Anything but idle: the microphone is spoken for, so leaving is locked. */
  const busy = recorderState !== "idle";

  return (
    <div className="flex h-full flex-col gap-[14px]">
      <div className="flex items-center justify-between px-[4px] py-[2px]">
        {busy ? (
          <span className="w-[40px]" />
        ) : (
          <Control
            icon="back"
            label="Back to the section list"
            variant="quiet"
            onClick={onBack}
          />
        )}

        {capturing ? (
          <span
            className="flex items-center gap-[8px] text-[12px] font-semibold tracking-[0.12em]"
            style={{ color: "var(--s-live)" }}
          >
            <span
              className="rec-dot h-[8px] w-[8px] rounded-full"
              style={{ background: "var(--s-live)" }}
            />
            REC
          </span>
        ) : (
          <span className="t-count">
            {section.ordinal} / {chapter.sections.length}
          </span>
        )}
        <span className="w-[40px]" />
      </div>

      <div
        className="w-full overflow-hidden rounded-[16px]"
        style={{ aspectRatio: "1", background: "var(--s-surface)" }}
      >
        {art && <img src={art} alt="" className="h-full w-full object-cover" />}
      </div>

      {capturing ? (
        <div className="t-timer flex justify-center">
          {formatDuration(elapsedMs)}
        </div>
      ) : (
        <>
          <div className="px-[4px]">
            <Waveform peaks={section.peaks} height={44} recorded={recorded} />
          </div>
          <div className="t-count flex justify-center">
            {section.durationMs === null
              ? "—"
              : formatDuration(section.durationMs)}
          </div>

          {chapter.referenceAudioUrl && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={onToggleReference}
                disabled={busy}
                aria-label={
                  referencePlaying
                    ? "Stop the story narration"
                    : "Play the story narration for reference"
                }
                className="flex items-center gap-[7px] rounded-full px-[14px] py-[7px] text-[12px] font-medium"
                style={{
                  border: "1px solid var(--s-edge)",
                  background: "var(--s-surface)",
                  color: "var(--s-ink-muted)",
                }}
              >
                <Icon name={referencePlaying ? "pause" : "speaker"} size={18} />
                {chapter.title}
              </button>
            </div>
          )}
        </>
      )}

      {/* One line, one place. A recorder failure is what the translator just
          did, so it outranks the quieter save-in-progress status.

          `chapter.audioFaults` is deliberately NOT shown here. It is a chapter
          total, and this screen is one section: standing on an intact section
          it would put a red alert beside a red "record again" control on a
          good take, and recording would demote it. Saying which section is
          broken needs a per-section flag on `SectionCard`, which does not
          exist — B2/B3 own that. The browser, which is chapter-scoped, is
          where the chapter-scoped count belongs. */}
      {error ? (
        <Notice>{error}</Notice>
      ) : (
        saving && (
          <Notice tone="busy">
            {savingOrdinal === null
              ? "Saving your recording."
              : `Saving section ${savingOrdinal}.`}
          </Notice>
        )
      )}

      <div className="mt-auto flex items-center justify-between px-[2px] pt-[4px] pb-[2px]">
        {busy ? (
          <div className="flex w-full justify-center">
            <Control
              icon="stop"
              label="Stop recording"
              variant="record"
              size={28}
              className="control--primary"
              // Nothing to stop until the microphone is actually open. The
              // control stays in place rather than appearing late, so the one
              // button that ends a take is never somewhere new.
              disabled={!capturing}
              onClick={onStop}
            />
          </div>
        ) : (
          <>
            <Control
              icon="prev"
              label="Previous section"
              variant="quiet"
              onClick={onPrev ?? undefined}
              disabled={!onPrev}
            />
            {recorded ? (
              <Control
                icon={playing ? "pause" : "play"}
                label={playing ? "Pause" : "Play this section"}
                variant="play"
                size={28}
                className="control--primary"
                onClick={onPlay}
              />
            ) : (
              <Control
                icon="record"
                label="Record this section"
                variant="record"
                size={26}
                className="control--primary"
                disabled={!supported || saving}
                onClick={onRecord}
              />
            )}
            {recorded ? (
              <Control
                icon="record"
                label="Record this section again"
                variant="quiet"
                onClick={onRecord}
                disabled={!supported || saving}
                className="text-[var(--s-live)]"
              />
            ) : (
              <Control
                icon="next"
                label="Next section"
                variant="quiet"
                onClick={onNext ?? undefined}
                disabled={!onNext}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
