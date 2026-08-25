import { useCallback, useRef, useState } from "react";

import { Checkbox } from "./checkbox";
import { Control } from "./control";
import { Icon } from "./icon";
import { Notice } from "./notice";
import { strings } from "./strings";
import { Waveform } from "./waveform";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import { useRecorderSegment } from "@/hooks/use-recorder-segment";
import { viewportWindow } from "@/lib/audio/viewport";
import { formatDuration } from "@/lib/utils";
import type { SegmentId } from "@/types/domain";

/**
 * Where the fixed centerline sits across the waveform viewport (F6).
 *
 * Right of centre, so the recorded audio sits to its left with room to the
 * right to grow into on an append (mockup 3). One constant to retune.
 */
const CENTER_FRACTION = 0.66;

/** The two zoom levels: the whole clip in view, or a quarter of it (§4.4). */
const ZOOM_WHOLE = 1;
const ZOOM_QUARTER = 4;

interface RecorderProps {
  segmentId: SegmentId;
  /** The single audio owner, held by App so `leave()` fires on every nav. */
  audio: UseAudioSession;
  /**
   * Persist the recording as an insert/append into the segment's audio. Never
   * rejects — a failure becomes the recovery screen App renders. Held at App
   * level so the take survives this sheet being torn down.
   */
  saveRecording: (
    segmentId: SegmentId,
    recorded: Int16Array,
    insertionOffset: number
  ) => Promise<boolean>;
  /**
   * Close the sheet. `dirty` ⇒ the segment changed (a take committed or the
   * finished flag toggled), so App reloads the Segments screen behind it.
   */
  onExit: (dirty: boolean) => void;
}

/**
 * B4 — the recorder sheet, over the dimmed Segments list.
 *
 * The waveform pans under a FIXED centerline (the line never travels); record
 * begins at whatever sample sits under it, inserting mid-clip or appending at
 * the end. There is no Stop control drawn: a take is committed when the sheet
 * closes (F8), which is also the only place the merged buffer is spliced and
 * saved. Pause/resume is one contiguous take at the offset captured when
 * recording began (F9).
 *
 * The toolbar is exactly two controls — zoom and record/pause — plus the
 * finished toggle in the header. Selection, cut, undo, the VU meter and the
 * recorder menu are all later batches and are absent, not stubbed (§0).
 */
export function Recorder({
  segmentId,
  audio,
  saveRecording,
  onExit,
}: RecorderProps) {
  const { view, error: loadError, setFinished } = useRecorderSegment(segmentId);

  // `null` ⇒ resting at the end of the existing audio (append-ready, F7). A
  // derived rest, rather than a value set in an effect once `view` loads: the
  // sheet mounts fresh on every open, so `null` is the open state, and a drag
  // is what replaces it with an absolute sample position.
  const [panState, setPanState] = useState<number | null>(null);
  const [zoom, setZoom] = useState(ZOOM_WHOLE);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragStartX = useRef(0);
  const panAtDragStart = useRef(0);
  const [dragging, setDragging] = useState(false);
  /** The insertion offset captured at the idle→recording edge (fixed, F9). */
  const insertionOffset = useRef(0);
  /** A take was committed or the finished flag toggled — App should reload. */
  const dirty = useRef(false);
  /** Guards the async close so a double-tap on Back cannot commit twice. */
  const closing = useRef(false);
  // Drives the UI: once Back is tapped the sheet is tearing down, and the
  // post-stop save is in flight. Record must be dead through that window — the
  // sheet still shows and a first take's waveform is still empty, so a second
  // tap would start a capture that the closing `leave()` then discards (a take
  // lost with no recovery screen).
  const [isClosing, setIsClosing] = useState(false);

  const length = view?.lengthSamples ?? 0;
  const hasAudio = length > 0;
  const state = audio.recorderState;
  const recording = state === "recording";
  const paused = state === "paused";
  const busy = state === "requesting" || state === "processing";

  const pan = panState ?? length;
  const win = viewportWindow(length, pan, zoom, CENTER_FRACTION);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Nothing to pan on an empty segment (F11): the baseline does not slide.
      if (!hasAudio || recording || paused) return;
      setDragging(true);
      dragStartX.current = e.clientX;
      panAtDragStart.current = pan;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [hasAudio, recording, paused, pan]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      const width = stageRef.current?.clientWidth ?? 1;
      // Drag right reveals earlier audio: the sample under the centerline
      // decreases. The move is scaled by what the viewport spans at this zoom,
      // so a fixed thumb travel pans less when zoomed in.
      const dx = e.clientX - dragStartX.current;
      const delta = -(dx / width) * win.visibleSamples;
      setPanState(
        Math.max(0, Math.min(panAtDragStart.current + delta, length))
      );
    },
    [dragging, win.visibleSamples, length]
  );

  const onPointerUp = useCallback(() => setDragging(false), []);

  const onRecordButton = useCallback(() => {
    if (closing.current) return;
    if (recording) {
      audio.pauseRecording();
    } else if (paused) {
      audio.resumeRecording();
    } else {
      // The offset is fixed for the whole take here, at the idle→recording
      // edge; pause/resume continues at the same point (F9).
      insertionOffset.current = win.centerlineSample;
      audio.startRecording();
    }
  }, [recording, paused, audio, win.centerlineSample]);

  const onToggleFinished = useCallback(() => {
    if (!view) return;
    void setFinished(!view.finished)
      .then(() => {
        dirty.current = true;
      })
      .catch((cause: unknown) => {
        console.error("Could not change the finished flag", cause);
      });
  }, [view, setFinished]);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    setIsClosing(true);
    void (async () => {
      // Commit on close (F8): if the mic is live or paused, stop it, then
      // splice what it captured into the segment's audio. `stopRecording`
      // releases the mic and never rejects; `saveRecording` never rejects and
      // turns a failure into the recovery screen App renders.
      if (recording || paused || state === "processing") {
        const samples = await audio.stopRecording();
        if (samples && samples.length > 0) {
          await saveRecording(segmentId, samples, insertionOffset.current);
          dirty.current = true;
        }
      }
      onExit(dirty.current);
    })().catch((cause: unknown) => {
      // Neither call rejects by contract; this is the last net on the one path
      // where a failure would cost a recording that cannot be made again.
      console.error("Committing the recording on close failed", cause);
      onExit(dirty.current);
    });
  }, [recording, paused, state, audio, saveRecording, segmentId, onExit]);

  const denied = !audio.supported || (state === "idle" && audio.error !== null);

  const finishedState = !view
    ? "disabled"
    : view.finished
      ? "finished"
      : view.hasClip
        ? "empty"
        : "disabled";

  return (
    <div className="recorder-scrim" role="dialog" aria-modal="true">
      <div className="recorder-sheet mx-auto max-w-md">
        <header className="flex items-center gap-[8px] px-[4px] py-[2px]">
          <Control
            icon="back"
            label={strings.closeRecorder}
            variant="quiet"
            onClick={close}
          />
          <span
            className="min-w-0 flex-1 truncate"
            style={{ color: "var(--s-ink)" }}
          >
            {view
              ? strings.recorderBreadcrumb(
                  view.bookName,
                  view.chapterNumber,
                  view.ordinal
                )
              : ""}
          </span>
          <Checkbox
            state={finishedState}
            label={
              view && view.finished
                ? strings.markUnfinished(view.ordinal)
                : strings.markFinished(view?.ordinal ?? 0)
            }
            onToggle={
              finishedState === "disabled" ? undefined : onToggleFinished
            }
          />
        </header>

        {denied ? (
          <PermissionPanel onRetry={audio.startRecording} onBack={close} />
        ) : loadError ? (
          <div className="flex-1 p-[12px]">
            <Notice>{loadError}</Notice>
          </div>
        ) : (
          <>
            <div className="recorder-stage flex-1">
              <div
                ref={stageRef}
                className="recorder-canvas"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              >
                <Waveform
                  peaks={hasAudio ? (view?.peaks ?? null) : null}
                  height={200}
                  recorded={hasAudio}
                  view={{
                    startFraction: hasAudio ? win.start / length : 0,
                    endFraction: hasAudio ? win.end / length : 1,
                    centerFraction: CENTER_FRACTION,
                  }}
                />
              </div>
              {(recording || paused) && (
                <div
                  className="recorder-status flex items-center gap-[8px]"
                  role="status"
                >
                  <span
                    className={recording ? "rec-dot" : undefined}
                    style={{ color: "var(--s-live)" }}
                  >
                    <Icon name="record" size={14} />
                  </span>
                  <span className="t-timer">
                    {formatDuration(audio.elapsedMs)}
                  </span>
                </div>
              )}
            </div>

            {audio.error && <Notice>{audio.error}</Notice>}

            <div className="recorder-toolbar flex items-center justify-between px-[16px]">
              <Control
                icon={zoom === ZOOM_WHOLE ? "zoom-in" : "zoom-out"}
                label={
                  zoom === ZOOM_WHOLE ? strings.zoomQuarter : strings.zoomWhole
                }
                variant="quiet"
                size={24}
                onClick={() =>
                  setZoom((z) => (z === ZOOM_WHOLE ? ZOOM_QUARTER : ZOOM_WHOLE))
                }
              />
              <Control
                icon={recording ? "pause" : "record"}
                label={
                  recording
                    ? strings.pause
                    : paused
                      ? strings.resume
                      : strings.record
                }
                variant="record"
                disabled={busy || isClosing}
                onClick={onRecordButton}
              />
              {/* Balances the toolbar so record sits central under the line. */}
              <span
                aria-hidden="true"
                style={{ width: "var(--c-control-sm)" }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PermissionPanel({
  onRetry,
  onBack,
}: {
  onRetry: () => void;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-[18px] px-[22px] text-center">
      <span style={{ color: "var(--s-live)" }}>
        <Icon name="alert" size={52} />
      </span>
      <p className="t-title" style={{ color: "var(--s-ink)" }}>
        {strings.micNeededTitle}
      </p>
      <Control
        icon="retry"
        label={strings.micRetry}
        variant="primary"
        size={30}
        autoFocus
        onClick={onRetry}
      />
      <Control
        icon="back"
        label={strings.micBack}
        variant="quiet"
        onClick={onBack}
      />
    </div>
  );
}
