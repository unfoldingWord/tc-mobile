import { useCallback, useEffect, useRef, useState } from "react";

import { Checkbox } from "./checkbox";
import { Control } from "./control";
import { strings } from "./strings";
import { Waveform } from "./waveform";
import { segmentRowState } from "@/types/view";
import type { SegmentRow as SegmentRowModel } from "@/types/view";

interface SegmentRowProps {
  row: SegmentRowModel;
  /** This row is the one currently sounding (only one row plays at a time). */
  playing: boolean;
  /** Milliseconds into the sounding take; meaningful only while `playing`. */
  playbackElapsedMs: number;
  /**
   * Toggle playback from a scrub offset (seconds). Maps to `playTake`, which
   * toggles: called while this row plays, it stops — so the offset is read
   * only when starting.
   */
  onPlay: (offsetSeconds: number) => void;
  /** Open the recorder sheet for this segment (never-recorded rows only). */
  onOpenRecorder: () => void;
  onSetFinished: (finished: boolean) => void;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/**
 * One segment, as a row (mockup 2): [checkbox] [ordinal] [waveform] [transport].
 *
 * The three states are derived clip-presence-first (`segmentRowState`): a
 * dangling clip reads as never-recorded so the only offer is re-record, never
 * amber bars over audio the database cannot play. There is no per-row overflow
 * menu — that is deferred (#29). A recorded row can be played and finished; the
 * recorder is entered only from a never-recorded row this lane.
 */
export function SegmentRow({
  row,
  playing,
  playbackElapsedMs,
  onPlay,
  onOpenRecorder,
  onSetFinished,
}: SegmentRowProps) {
  const state = segmentRowState(row);
  const hasClip = row.hasClip;
  const durationMs = row.durationMs ?? 0;
  const ordinal = row.ordinal;

  // The resting scrub position, [0,1]. While playing, the dot tracks the take's
  // elapsed instead; when playback ends or is stopped, it rests where it
  // reached (F4/§3.4), so `position` catches up to the last elapsed fraction.
  const [position, setPosition] = useState(0);
  const [dragging, setDragging] = useState(false);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const lastElapsedFraction = useRef(0);
  const wasPlaying = useRef(false);

  const playingFraction =
    playing && durationMs > 0 ? clamp01(playbackElapsedMs / durationMs) : 0;

  useEffect(() => {
    if (playing && durationMs > 0) {
      lastElapsedFraction.current = clamp01(playbackElapsedMs / durationMs);
    }
  }, [playing, playbackElapsedMs, durationMs]);

  useEffect(() => {
    // When playback ends or is stopped, leave the dot where it reached rather
    // than snapping back to the old start position.
    if (wasPlaying.current && !playing) {
      setPosition(lastElapsedFraction.current);
    }
    wasPlaying.current = playing;
  }, [playing]);

  const fraction = playing ? playingFraction : position;

  const fractionFromEvent = useCallback((clientX: number): number => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    return rect.width > 0 ? clamp01((clientX - rect.left) / rect.width) : 0;
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!hasClip) return;
      // Dragging while a row plays stops it and moves the dot (F4); the user
      // presses play again to hear from the new spot.
      if (playing) onPlay(0);
      setDragging(true);
      setPosition(fractionFromEvent(e.clientX));
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [hasClip, playing, onPlay, fractionFromEvent]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      setPosition(fractionFromEvent(e.clientX));
    },
    [dragging, fractionFromEvent]
  );

  const onPointerUp = useCallback(() => setDragging(false), []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!hasClip) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setPosition((p) => clamp01(p - 0.05));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setPosition((p) => clamp01(p + 0.05));
      }
    },
    [hasClip]
  );

  const checkbox =
    state === "finished" ? (
      <Checkbox
        state="finished"
        label={strings.markUnfinished(ordinal)}
        onToggle={() => onSetFinished(false)}
      />
    ) : state === "recorded" ? (
      <Checkbox
        state="empty"
        label={strings.markFinished(ordinal)}
        onToggle={() => onSetFinished(true)}
      />
    ) : (
      <Checkbox state="disabled" label={strings.segmentNoRecording(ordinal)} />
    );

  return (
    <div className="row">
      {checkbox}

      <span
        className="t-ordinal flex-none"
        style={{ color: "var(--s-ink-muted)", minWidth: "16px" }}
      >
        {ordinal}
      </span>

      {hasClip ? (
        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label={strings.scrubSegment(ordinal)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fraction * 100)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onKeyDown={onKeyDown}
          className="scrub min-w-0 flex-1"
        >
          <Waveform peaks={row.peaks} height={26} />
          <span
            className="scrub-dot"
            style={{ left: `${fraction * 100}%` }}
            aria-hidden="true"
          />
        </div>
      ) : (
        <div className="min-w-0 flex-1">
          <Waveform peaks={null} height={26} recorded={false} />
        </div>
      )}

      {hasClip ? (
        <Control
          icon={playing ? "pause" : "play"}
          label={
            playing
              ? strings.pauseSegment(ordinal)
              : strings.playSegment(ordinal)
          }
          variant="play"
          size={20}
          className="flex-none"
          onClick={() => onPlay(fraction * (durationMs / 1000))}
        />
      ) : (
        <Control
          icon="record"
          label={strings.recordSegment(ordinal)}
          variant="record"
          size={22}
          className="flex-none"
          onClick={onOpenRecorder}
        />
      )}
    </div>
  );
}
