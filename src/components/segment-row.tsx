import { useCallback, useEffect, useRef, useState } from "react";

import { Control } from "./control";
import { Icon } from "./icon";
import { Menu } from "./menu";
import { strings } from "./strings";
import { Waveform } from "./waveform";
import { cn } from "@/lib/utils";
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
 * One segment, as a row (mockup 2, v0.1.2 rework):
 *   [ status + ordinal ] [ waveform ] [ transport ] [ menu | spacer ]
 *
 * The three states are derived clip-presence-first (`segmentRowState`): a
 * dangling clip reads as never-recorded so the only offer is re-record, never
 * amber bars over audio the database cannot play.
 *
 * The whole left zone is one `.row-open` button in all three states (#79):
 * tapping the status slot or the ordinal opens the segment in the recorder/
 * editor. The status slot holds a green check-circle only on a finished row and
 * otherwise reserves its 22px so ordinals stay left-aligned down the list. A
 * finished row is tinted green throughout (#81) — waveform, play button, a
 * quiet surface wash. The per-row overflow menu (#80) carries Edit / Finished /
 * Delete, and renders only on a recorded row: a never-recorded segment has no
 * audio to erase and, since Finished lives only in that menu, cannot be marked
 * finished — the finished-invariant made structural. A never-recorded row opens
 * the recorder from its record button, sized to match play (#82).
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

  // The left zone opens the segment in all three states (#79). The finished
  // aria-label is now the ONLY place the finished state reaches AT on the row —
  // the checkbox's `aria-checked` is gone and the menu is closed — so it carries
  // "finished" explicitly. `openSegment` on an empty row stays distinct from the
  // record button's "Record segment N" so the two do not collide.
  const openLabel =
    state === "finished"
      ? strings.editSegmentFinished(ordinal)
      : hasClip
        ? strings.editSegment(ordinal)
        : strings.openSegment(ordinal);

  return (
    <div className={cn("row", state === "finished" && "row--finished")}>
      <button
        type="button"
        onClick={onOpenRecorder}
        disabled={busy}
        aria-label={openLabel}
        className="row-open"
      >
        <span className="row-status">
          {state === "finished" && <Icon name="check" size={16} />}
        </span>
        <span className="t-ordinal">{ordinal}</span>
      </button>

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
        <>
          <Control
            icon="record"
            label={strings.recordSegment(ordinal)}
            variant="record"
            size={20}
            className="flex-none"
            disabled={busy}
            onClick={onOpenRecorder}
          />
          {/* Reserve the menu's footprint an empty row lacks, so the record
              button lands on the same axis as a recorded row's play button and
              the flex-1 waveform gets identical width in both (#82). */}
          <span className="row-menu-spacer" aria-hidden="true" />
        </>
      )}

      {/* The per-row overflow (#80): Edit / Finished / Delete. Only on a
          recorded row — a never-recorded segment has no audio to erase, and
          gating Finished here is what keeps the finished-invariant structural:
          an empty row has no menu, so `onSetFinished(true)` is unreachable from
          it. The same Erase hook and confirm the recorder menu uses live in the
          screen, so both entry points erase one way. */}
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
              icon="edit"
              label={strings.editSegment(ordinal)}
              variant="quiet"
              onClick={() => {
                setMenuOpen(false);
                onOpenRecorder();
              }}
            />
            <Control
              icon="check"
              label={
                row.finished
                  ? strings.markUnfinished(ordinal)
                  : strings.markFinished(ordinal)
              }
              variant="quiet"
              // Green while already finished. A standalone class, not inheritance
              // — the menu is portalled to <body>, outside `.row--finished`.
              className={row.finished ? "is-done" : undefined}
              onClick={() => {
                setMenuOpen(false);
                onSetFinished(!row.finished);
              }}
            />
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
