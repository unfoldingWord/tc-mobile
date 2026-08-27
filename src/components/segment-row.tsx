import { useCallback, useEffect, useRef, useState } from "react";

import { Checkbox } from "./checkbox";
import { Control } from "./control";
import { Menu } from "./menu";
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
  /** Open the recorder sheet for this segment — to record an empty one, or to
   * edit (insert/append/re-record) one that already has audio. */
  onOpenRecorder: () => void;
  onSetFinished: (finished: boolean) => void;
  /**
   * Ask to erase this segment's recording (B6, D-TWO-ENTRIES). Picked from the
   * row's overflow menu; the screen owns the confirm and the store op, so both
   * Erase entry points share one implementation and one dialog. Only wired on a
   * recorded row — a never-recorded row has no audio to erase, so it shows no
   * overflow.
   */
  onErase: () => void;
  /**
   * Reports this row's overflow menu opening and closing, so the screen can go
   * `inert` behind it for AT/switch users (the menu is portalled out, so it
   * stays reachable while the list does not). Optional — a consumer that does
   * not manage list inertness can ignore it.
   */
  onMenuOpenChange?: (open: boolean) => void;
  /**
   * A save is landing (the list is refreshing). Opening the recorder is held
   * off until it does: the row still reads by its pre-save state, so entering
   * now would open on stale audio. Play stays live.
   */
  busy?: boolean;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/**
 * One segment, as a row (mockup 2): [checkbox] [ordinal] [waveform] [transport].
 *
 * The three states are derived clip-presence-first (`segmentRowState`): a
 * dangling clip reads as never-recorded so the only offer is re-record, never
 * amber bars over audio the database cannot play. The per-row overflow menu
 * (G5) is held until its occupants exist — Erase Segment is B6 and Share
 * Segment is B7 — so B3 ships without it rather than an empty affordance
 * (recorded on #29). A never-recorded row opens the recorder from its record
 * button; a recorded row opens it (to insert/append/re-record — the pivot's
 * unit of work) by tapping the ordinal, keeping play/pause as the transport.
 */
export function SegmentRow({
  row,
  playing,
  playbackElapsedMs,
  onPlay,
  onOpenRecorder,
  onSetFinished,
  onErase,
  onMenuOpenChange,
  busy = false,
}: SegmentRowProps) {
  const state = segmentRowState(row);
  const [menuOpen, setMenuOpen] = useState(false);
  // Report the menu's open state up so the screen can inert the list behind it.
  // An effect, not a call inside each setter, so it fires once per real change;
  // the cleanup releases the list if the row unmounts while its menu is open.
  // Re-reporting `false` when already closed is a no-op React bails out on.
  useEffect(() => {
    onMenuOpenChange?.(menuOpen);
    return () => {
      if (menuOpen) onMenuOpenChange?.(false);
    };
  }, [menuOpen, onMenuOpenChange]);
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

  // A 1:1 re-record replaces the clip under the SAME row instance (same key),
  // so the resting scrub must snap back to the start when the audio identity
  // changes — otherwise the dot points into a clip that no longer exists
  // (G5-#4). Keyed on the clip's id, a TRUE identity: a re-record mints a fresh
  // ClipId, so this fires even when the replacement is the same length (a
  // duration key collided — F7). Reset during render against the previous id
  // held in state, React's recommended shape for "reset state when a prop
  // changes" (no effect, no extra commit). `lastElapsedFraction` needs no reset:
  // it is only read after a playback session, which rewrites it every frame.
  const [prevClipId, setPrevClipId] = useState(row.clipId);
  if (row.clipId !== prevClipId) {
    setPrevClipId(row.clipId);
    setPosition(0);
  }

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
      const frac = fractionFromEvent(e.clientX);
      // Dragging while a row plays stops it and moves the dot (F4). Point the
      // rest position at the tapped spot BEFORE stopping: the playing→false
      // effect rests the dot at `lastElapsedFraction`, so without this a
      // tap-to-seek would snap back to wherever playback had reached.
      if (playing) {
        lastElapsedFraction.current = frac;
        onPlay(0);
      }
      setDragging(true);
      setPosition(frac);
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
        disabled={busy}
        onToggle={() => onSetFinished(false)}
      />
    ) : state === "recorded" ? (
      <Checkbox
        state="empty"
        label={strings.markFinished(ordinal)}
        disabled={busy}
        onToggle={() => onSetFinished(true)}
      />
    ) : (
      <Checkbox state="disabled" label={strings.segmentNoRecording(ordinal)} />
    );

  return (
    <div className="row">
      {checkbox}

      {hasClip ? (
        <button
          type="button"
          onClick={onOpenRecorder}
          disabled={busy}
          aria-label={strings.editSegment(ordinal)}
          className="t-ordinal flex-none border-0 bg-transparent p-0 text-left disabled:opacity-50"
          style={{ color: "var(--s-ink-muted)", minWidth: "16px" }}
        >
          {ordinal}
        </button>
      ) : (
        <span
          className="t-ordinal flex-none"
          style={{ color: "var(--s-ink-muted)", minWidth: "16px" }}
        >
          {ordinal}
        </span>
      )}

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
          // Held with the other controls while a save refreshes the list: the
          // row still carries the pre-save durationMs, so an offset computed
          // from it would seek the wrong place in the clip just written.
          disabled={busy}
          onClick={() => onPlay(fraction * (durationMs / 1000))}
        />
      ) : (
        <Control
          icon="record"
          label={strings.recordSegment(ordinal)}
          variant="record"
          size={22}
          className="flex-none"
          disabled={busy}
          onClick={onOpenRecorder}
        />
      )}

      {/* The per-row overflow (G5), shipped Erase-only in B6 — Share Segment is
          B7. Only on a recorded row: a never-recorded segment has no audio to
          erase. The same hook and the same confirm the recorder menu uses live
          in the screen, so both entry points erase one way. */}
      {hasClip && (
        <>
          <Control
            icon="menu"
            label={strings.segmentMenu(ordinal)}
            variant="quiet"
            size={20}
            className="flex-none"
            disabled={busy}
            onClick={() => setMenuOpen(true)}
          />
          <Menu
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            title={strings.recorderMenuTitle}
          >
            <Control
              icon="trash"
              label={strings.eraseSegment}
              variant="quiet"
              onClick={() => {
                setMenuOpen(false);
                onErase();
              }}
            />
          </Menu>
        </>
      )}
    </div>
  );
}
