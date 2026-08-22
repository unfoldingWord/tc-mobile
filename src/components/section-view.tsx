import { Control } from "./control";
import { Icon } from "./icon";
import { Waveform } from "./waveform";
import { formatDuration } from "@/lib/utils";
import type { ChapterCard, SectionCard } from "@/types/view";

interface SectionViewProps {
  chapter: ChapterCard;
  section: SectionCard;
  recording: boolean;
  elapsedMs: number;
  playing: boolean;
  referencePlaying: boolean;
  onBack: () => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  onRecord: () => void;
  onStop: () => void;
  onPlay: () => void;
  onToggleReference: (() => void) | null;
}

/**
 * One section, filling the screen.
 *
 * This is where the work happens, so it holds only what the work needs. While
 * recording, everything but the frame, the elapsed time and stop is removed —
 * **including the stepper** — so there is nothing to press by accident
 * mid-take, and a take is the one thing here that cannot be undone.
 */
export function SectionView({
  chapter,
  section,
  recording,
  elapsedMs,
  playing,
  referencePlaying,
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

  return (
    <div className="flex h-full flex-col gap-[14px]">
      <div className="flex items-center justify-between px-[4px] py-[2px]">
        {recording ? (
          <span className="w-[40px]" />
        ) : (
          <Control
            icon="back"
            label="Back to the section list"
            variant="quiet"
            onClick={onBack}
          />
        )}

        {recording ? (
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

      {recording ? (
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

          {onToggleReference && chapter.referenceAudioUrl && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={onToggleReference}
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

      <div className="mt-auto flex items-center justify-between px-[2px] pt-[4px] pb-[2px]">
        {recording ? (
          <div className="flex w-full justify-center">
            <Control
              icon="stop"
              label="Stop recording"
              variant="record"
              size={28}
              className="control--primary"
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
                onClick={onRecord}
              />
            )}
            {recorded ? (
              <Control
                icon="record"
                label="Record this section again"
                variant="quiet"
                onClick={onRecord}
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
