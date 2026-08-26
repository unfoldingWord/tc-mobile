import { useCallback, useEffect, useRef, useState } from "react";

import { Checkbox } from "./checkbox";
import { Control } from "./control";
import { Icon } from "./icon";
import { Menu } from "./menu";
import { Notice } from "./notice";
import { SelectionOverlay } from "./selection-overlay";
import { strings } from "./strings";
import { Waveform } from "./waveform";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import { useRecorderSegment } from "@/hooks/use-recorder-segment";
import { useSegmentEditor } from "@/hooks/use-segment-editor";
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
   * Persist the recording as an insert/append into the segment's audio, at the
   * given Finished state. Never rejects — a failure becomes the recovery screen
   * App renders, and `finished` rides the take so a retry keeps it. Held at App
   * level so the take survives this sheet being torn down.
   */
  saveRecording: (
    segmentId: SegmentId,
    existing: Int16Array,
    recorded: Int16Array,
    insertionOffset: number,
    finished: boolean
  ) => Promise<boolean>;
  /**
   * Persist an already-flattened, edited segment buffer (B5 edit-only close —
   * cut/paste with no new recording). Never rejects — a failure becomes App's
   * recovery screen, exactly like `saveRecording`.
   */
  saveEditedSegment: (
    segmentId: SegmentId,
    buffer: Int16Array,
    finished: boolean
  ) => Promise<boolean>;
  /**
   * The cut/paste clipboard, held by App so it outlives this sheet (G3: reaches
   * across a chapter, lost on close). Read for paste; replaced on cut.
   */
  clipboard: Int16Array | null;
  onClipboardChange: (clip: Int16Array | null) => void;
  /**
   * Close the sheet. `dirty` ⇒ the segment changed (a take committed, an edit
   * persisted, or the finished flag toggled), so App reloads the Segments screen
   * behind it.
   */
  onExit: (dirty: boolean) => void;
}

/**
 * The recorder sheet (B4 + B5 editing), over the dimmed Segments list.
 *
 * The waveform pans under a FIXED centerline (the line never travels); record
 * begins at whatever sample sits under it, inserting mid-clip or appending at
 * the end. There is no Stop control drawn: a take is committed when the sheet
 * closes (F8). Pause/resume is one contiguous take at the offset captured when
 * recording began (F9).
 *
 * B5 layers waveform editing on top, over a working buffer (`useSegmentEditor`):
 * a selection frame that cuts to a chapter-scoped clipboard, a paste at the
 * centerline, and an in-memory undo/redo log. Editing is strictly idle (Model A:
 * edits first, then one record commits on close), so a live take disables the
 * edit controls, and the record's splice base is the edited buffer. On close the
 * working buffer is persisted — spliced with the recording, or on its own for an
 * edit-only session (`saveEditedSegment`).
 *
 * The toolbar is [zoom] [select] [record] [undo] [menu]; the finished toggle is
 * in the header, Redo is in the menu. The VU meter and Erase Segment are B6 —
 * absent, not stubbed (§0).
 */
export function Recorder({
  segmentId,
  audio,
  saveRecording,
  saveEditedSegment,
  clipboard,
  onClipboardChange,
  onExit,
}: RecorderProps) {
  const { view, error: loadError, setFinished } = useRecorderSegment(segmentId);

  // The waveform-editing session (B5): a working buffer over the loaded clip,
  // an in-memory undo log, and the shared clipboard. `view.samples` is the base;
  // it is null until the async load resolves and on an empty segment, and the
  // editor is an empty no-op buffer until then.
  const editor = useSegmentEditor(view?.samples ?? null, {
    clip: clipboard,
    set: onClipboardChange,
  });
  const [menuOpen, setMenuOpen] = useState(false);

  // `null` ⇒ resting at the end of the existing audio (append-ready, F7). A
  // derived rest, rather than a value set in an effect once `view` loads: the
  // sheet mounts fresh on every open, so `null` is the open state, and a drag
  // is what replaces it with an absolute sample position.
  const [panState, setPanState] = useState<number | null>(null);
  const [zoom, setZoom] = useState(ZOOM_WHOLE);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const dragStartX = useRef(0);
  const panAtDragStart = useRef(0);
  const [dragging, setDragging] = useState(false);
  /** The insertion offset captured at the idle→recording edge (fixed, F9). */
  const insertionOffset = useRef(0);
  /** A take was committed or the finished flag toggled — App should reload. */
  const dirty = useRef(false);
  /** Guards the async close so a double-tap on Back cannot commit twice. */
  const closing = useRef(false);
  /**
   * The finished checkbox's desired state, or null when the translator has not
   * touched it this session. The write is deferred to `close()` and applied
   * AFTER any take commit (G5-#2): `addTake` demotes an approved segment to
   * draft, so a mark written eagerly is clobbered by a re-record on the same
   * close — and would also hit `setSegmentFinished` before the take it needs
   * exists. The checkbox reflects this immediately; the store learns it on
   * close, like the take itself.
   */
  const [finishedIntent, setFinishedIntent] = useState<boolean | null>(null);
  /**
   * A recording that could not be decoded (round 4). Distinct from a permission
   * miss: the take is unrecoverable, and re-recording is the only recovery, so
   * it shows as a toolbar Notice with Record live — not the permission panel.
   */
  const [stopError, setStopError] = useState<string | null>(null);
  // Drives the UI: once Back is tapped the sheet is tearing down, and the
  // post-stop save is in flight. Record must be dead through that window — the
  // sheet still shows and a first take's waveform is still empty, so a second
  // tap would start a capture that the closing `leave()` then discards (a take
  // lost with no recovery screen).
  const [isClosing, setIsClosing] = useState(false);

  // The edit-aware length: the working buffer, not the loaded clip, is the
  // pan/zoom domain and the append offset — a cut shortens it, a paste grows it.
  const length = editor.workingLength;
  const hasAudio = length > 0;
  const state = audio.recorderState;
  const recording = state === "recording";
  const paused = state === "paused";
  const busy = state === "requesting" || state === "processing";
  // Editing is a strictly-idle activity (Model A: edits, then a record commits
  // on close). It is off while a take is live or the sheet is committing, and
  // off with no segment loaded.
  const idleEditable = view !== null && state === "idle" && !isClosing;

  // A take is being made or committed: any non-idle recorder state, OR the F8
  // close window (Back tapped, the stop→decode→save still in flight). Across all
  // of it the segment is heading for a demote-or-mark, so the checkbox previews
  // that and cannot be toggled — the close window included, or the box refills
  // to the stored flag mid-save and a late tap misses the already-captured
  // close (G10). A refused start returns to idle and lifts this.
  const takeActive = state !== "idle" || isClosing;

  // `finishedIntent` is the translator's EXPLICIT choice, null until they tap
  // the checkbox — never written speculatively (an optimistic reset at Record
  // demoted an untouched approved segment when the mic was then denied, F9/G9).
  // The demote a re-record WILL cause is previewed here instead, by derivation:
  // while a take is active an untouched box reads unchecked; back at idle it
  // reads the stored flag again. The commit path passes `finishedIntent === true`
  // (a plain re-record defaults to draft); the no-commit path writes only a real
  // toggle.
  //
  // A B5 edit demotes the same way a re-record does — the audio changed, so an
  // approved segment returns to draft unless re-marked — so pending edits preview
  // the demote here too. Without this the box would read "finished" all through
  // an idle edit and then silently flip to draft on close.
  const pendingDemote = takeActive || editor.hasEdits;
  const displayedFinished =
    finishedIntent ?? (pendingDemote ? false : (view?.finished ?? false));

  const pan = panState ?? length;
  const win = viewportWindow(length, pan, zoom, CENTER_FRACTION);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Nothing to pan on an empty segment (F11): the baseline does not slide.
      // Also frozen while `busy` (requesting/processing): insertionOffset is
      // captured at the Record tap, so a pan during a slow first-time permission
      // prompt would slide the centerline off the sample the take actually splices
      // into, breaking the drawn promise that record begins under the line (#61).
      // Pan stays available while the selection frame is open: a span can grow
      // past the viewport, and panning is the only way to bring an off-screen
      // handle back within reach (B5, George R2). The handles stop their own
      // pointerdown from bubbling here, so grabbing a handle adjusts an edge and
      // never also starts a pan — only a drag on the bare canvas pans.
      if (!hasAudio || recording || paused || busy) return;
      setDragging(true);
      dragStartX.current = e.clientX;
      panAtDragStart.current = pan;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [hasAudio, recording, paused, busy, pan]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      // Freeze a drag ALREADY in flight the moment the take goes non-idle, not
      // just its start (onPointerDown). A pan begun while idle keeps its pointer
      // capture, so with a second finger the translator can tap Record and keep
      // moving the first finger through the `requesting` window — sliding the
      // centerline off the sample insertionOffset already locked to at the tap
      // (#61). The pointer-down guard alone left this multitouch path open.
      if (!dragging || recording || paused || busy) return;
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
    [dragging, recording, paused, busy, win.visibleSamples, length]
  );

  const onPointerUp = useCallback(() => setDragging(false), []);

  const onRecordButton = useCallback(() => {
    if (closing.current || !view) return;
    if (recording) {
      audio.pauseRecording();
    } else if (paused) {
      audio.resumeRecording();
    } else {
      // Starting a record ends the editing phase (Model A: edits then record).
      // Close the selection frame so the stage drag returns to the pan, and the
      // edit controls disable while the take is live.
      editor.closeSelection();
      // The offset is fixed for the whole take here, at the idle→recording
      // edge; pause/resume continues at the same point (F9). It is an offset
      // into the WORKING buffer, which is also the record's splice base on close.
      setStopError(null);
      insertionOffset.current = win.centerlineSample;
      audio.startRecording();
    }
  }, [recording, paused, view, audio, editor, win.centerlineSample]);

  const onToggleSelection = useCallback(() => {
    if (editor.selectionActive) {
      editor.closeSelection();
      return;
    }
    // Seed a grabbable span around the centerline (~30% of the visible window),
    // so the frame opens with handles under the finger rather than collapsed.
    const half = win.visibleSamples * 0.15;
    editor.openSelection({
      start: win.centerlineSample - half,
      end: win.centerlineSample + half,
    });
  }, [editor, win.centerlineSample, win.visibleSamples]);

  const onPaste = useCallback(() => {
    editor.paste(win.centerlineSample);
  }, [editor, win.centerlineSample]);

  const onToggleFinished = useCallback(() => {
    if (!view) return;
    // Toggle from what the box currently SHOWS (the derived state above), not
    // from the stored flag — while recording the two differ, and toggling off
    // the stored value would leave the visible box unchanged. The store write is
    // deferred to close() (see `finishedIntent`); dirty synchronously so a
    // reload reflects the toggle regardless — a redundant reload is the safe
    // failure, never a lost one.
    dirty.current = true;
    setFinishedIntent(!displayedFinished);
  }, [view, displayedFinished]);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    setIsClosing(true);
    void (async () => {
      // Commit on close (F8): if the mic is live or paused, stop it, then
      // splice what it captured into the segment's audio. `stopRecording`
      // releases the mic and never rejects; `saveRecording` never rejects and
      // turns a failure into the recovery screen App renders.
      let committed = false;
      if (recording || paused || state === "processing") {
        const result = await audio.stopRecording();
        if (result.samples && result.samples.length > 0) {
          // The Finished mark rides the take (applied atomically in addTake, on
          // this attempt or a retry). Only an EXPLICIT mark this session marks
          // it finished; a re-record the translator did not mark stays a
          // demote-to-draft. The boolean saveRecording returns is deliberately
          // not branched on here: on a failure App shows the recovery screen and
          // the mark is preserved in the held take, so close() has nothing left
          // to decide.
          // The splice base is the WORKING buffer, not the loaded clip: any
          // cut/paste this session came first (Model A) and must be part of what
          // the recording splices into. insertionOffset was captured against the
          // same working length.
          await saveRecording(
            segmentId,
            editor.working,
            result.samples,
            insertionOffset.current,
            finishedIntent === true
          );
          dirty.current = true;
          committed = true;
        } else if (result.error) {
          // The stop yielded no usable audio AND has something to say — an empty
          // capture or a decode failure. Its cause travels WITH the result, not
          // the async `error` state a render closure here would read one frame
          // stale (the round-4 regression that reopened the permission panel).
          // Do NOT onExit: leave() would close silently on a take that cannot be
          // recorded again. Surface it as a toolbar Notice (not the permission
          // panel — this is not a permission miss) and re-enable so Back or
          // Record works.
          setStopError(result.error);
          closing.current = false;
          setIsClosing(false);
          return;
        }
        // else: no samples and no error — a superseded stop (a cancel/leave
        // landed during it). Nothing to save and nothing to say, so fall through
        // and close, rather than dead-ending the sheet open (#59). An empty
        // capture is NOT this branch — it returns the "No sound" error above and
        // stays open to retry.
      }
      // An edit-only close (B5): cuts/pastes but no recording this session.
      if (!committed && editor.hasEdits) {
        if (editor.workingLength === 0) {
          // Cut down to nothing clears the take (no 0-frame ghost). Unlike a
          // non-empty save it has NO recovery slot, so a failed clear must keep
          // the sheet open with an in-place error — closing as if the erase
          // happened would leave the original audio on disk under a UI that says
          // it is gone (and a clipboard copy alongside it). Same shape as the
          // finished-flag write failure below.
          const cleared = await saveEditedSegment(
            segmentId,
            editor.working,
            false
          );
          if (!cleared) {
            setStopError(strings.clearFailed);
            closing.current = false;
            setIsClosing(false);
            return;
          }
        } else {
          // A non-empty edit replaces the audio through the same never-lose
          // machinery a recording uses (the owned slot → App's recovery screen on
          // failure), so its boolean is deliberately not branched on here — just
          // like the record path. Like a re-record it demotes an approved segment
          // to draft unless explicitly re-marked, and the mark rides the write.
          await saveEditedSegment(
            segmentId,
            editor.working,
            finishedIntent === true
          );
        }
        dirty.current = true;
        committed = true;
      }
      // A toggle with no new take is a direct write — there is no take to carry
      // it. Only when the translator actually changed it from the stored value,
      // and only when nothing was committed (a commit already carried the mark).
      if (
        !committed &&
        view &&
        finishedIntent !== null &&
        finishedIntent !== view.finished
      ) {
        try {
          await setFinished(finishedIntent);
        } catch (cause) {
          // The store rejects a finished mark on a segment with no take — a take
          // deleted externally between toggle and close. Surface it (F5-#1)
          // rather than only the console, and stay open.
          console.error("Could not change the finished flag", cause);
          setStopError(strings.finishedWriteFailed);
          closing.current = false;
          setIsClosing(false);
          return;
        }
      }
      onExit(dirty.current);
    })().catch((cause: unknown) => {
      // Neither call rejects by contract; this is the last net on the one path
      // where a failure would cost a recording that cannot be made again.
      console.error("Committing the recording on close failed", cause);
      onExit(dirty.current);
    });
  }, [
    recording,
    paused,
    state,
    view,
    audio,
    saveRecording,
    saveEditedSegment,
    editor,
    segmentId,
    onExit,
    finishedIntent,
    setFinished,
  ]);

  // Land focus inside the sheet on open (mirror Menu), so a keyboard/switch/AT
  // user is not stranded on the now-`inert` list behind the modal. Mount-only —
  // App keys the sheet on segmentId, so it remounts per open and per segment.
  // The permission panel autofocuses its own Retry when it later appears, which
  // is after this has run.
  useEffect(() => {
    sheetRef.current?.querySelector<HTMLElement>("button")?.focus();
  }, []);

  const denied =
    !audio.supported ||
    (state === "idle" && audio.error !== null && stopError === null);

  // Enabled once a take WILL exist on close, not only when one already does.
  // `takeActive` covers the FIRST take — recording/closing before any clip
  // exists — so the day-1 path can record and mark done in one sheet (G8); the
  // mark rides the take through `addTake`. `hasAudio` (the WORKING buffer) covers
  // an existing clip and a B5 edit alike — including a paste into an empty
  // segment. Deliberately NOT keyed on the stale `view.hasClip`: that never
  // updates mid-sheet, so a clip edited down to nothing (cut-all) would still
  // read as "will have audio" and could be marked finished onto a 0-frame take.
  const willHaveAudio = view !== null && (takeActive || hasAudio);
  // `willHaveAudio` gates BEFORE `displayedFinished`, so a segment with no audio
  // reads unchecked-and-disabled even if `finishedIntent` is still true — paste,
  // mark finished, then cut-all must not leave a checked box on an empty segment
  // (close clears it and ignores the mark, so this is only the UI catching up).
  const finishedState = !view
    ? "disabled"
    : !willHaveAudio
      ? "disabled"
      : displayedFinished
        ? "finished"
        : "empty";

  return (
    <div className="recorder-scrim" role="dialog" aria-modal="true">
      <div ref={sheetRef} className="recorder-sheet mx-auto max-w-md">
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
              view && displayedFinished
                ? strings.markUnfinished(view.ordinal)
                : strings.markFinished(view?.ordinal ?? 0)
            }
            // Frozen through the requesting/processing/close window, exactly as
            // Record is: a toggle there cannot reach the already-captured close,
            // and the box must not invite one (G10). Live during recording/
            // paused, where marking the in-progress take is the point.
            disabled={isClosing || busy}
            onToggle={
              finishedState === "disabled" ? undefined : onToggleFinished
            }
          />
        </header>

        {denied ? (
          <PermissionPanel
            message={audio.error}
            onRetry={audio.startRecording}
            onBack={close}
          />
        ) : loadError ? (
          <div className="flex-1 p-[12px]">
            <Notice>{loadError}</Notice>
          </div>
        ) : (
          <>
            {stopError && (
              <div className="px-[12px] pt-[8px]">
                <Notice>{stopError}</Notice>
              </div>
            )}
            {editor.error && (
              <div className="px-[12px] pt-[8px]">
                <Notice>{strings.editFailed}</Notice>
              </div>
            )}
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
                  peaks={editor.peaks}
                  height={200}
                  recorded={hasAudio}
                  view={{
                    startFraction: hasAudio ? win.start / length : 0,
                    endFraction: hasAudio ? win.end / length : 1,
                    centerFraction: CENTER_FRACTION,
                  }}
                />
                {editor.selectionActive && editor.selection && (
                  <SelectionOverlay
                    win={win}
                    selection={editor.selection}
                    workingLength={length}
                    onChange={editor.setSelection}
                    startLabel={strings.selectionStartHandle}
                    endLabel={strings.selectionEndHandle}
                  />
                )}
                {idleEditable && editor.canPaste && !editor.selectionActive && (
                  // The paste marker rides the centerline (mockup 5): tapping it
                  // inserts the clipboard there. stopPropagation so the tap does
                  // not also arm a pan on the stage beneath it.
                  <button
                    type="button"
                    className="paste-marker"
                    style={{ left: `${CENTER_FRACTION * 100}%` }}
                    aria-label={strings.paste}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={onPaste}
                  >
                    <Icon name="paste" size={26} />
                  </button>
                )}
              </div>
              {idleEditable && editor.canCut && (
                // The Cut affordance sits under the frame (mockup 4). Cutting
                // drops the selection and turns the paste marker on. Gated on
                // `idleEditable` like every other edit control: without it a Cut
                // tapped during the async close would mutate the working buffer
                // after close() already captured the pre-cut one — a silently
                // dropped edit.
                <div className="recorder-cut flex justify-center">
                  <Control
                    icon="scissors"
                    label={strings.cut}
                    variant="quiet"
                    size={26}
                    onClick={editor.cut}
                  />
                </div>
              )}
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
                icon="selection"
                label={
                  editor.selectionActive
                    ? strings.selectStop
                    : strings.selectStart
                }
                variant={editor.selectionActive ? "primary" : "quiet"}
                size={24}
                disabled={!idleEditable || !hasAudio}
                onClick={onToggleSelection}
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
                disabled={busy || isClosing || !view}
                onClick={onRecordButton}
              />
              <Control
                icon="undo"
                label={strings.undo}
                variant="quiet"
                size={24}
                disabled={!idleEditable || !editor.canUndo}
                onClick={editor.undo}
              />
              <Control
                icon="menu"
                label={strings.recorderMenuOpen}
                variant="quiet"
                size={24}
                disabled={!idleEditable}
                onClick={() => setMenuOpen(true)}
              />
            </div>
          </>
        )}
      </div>
      <Menu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={strings.recorderMenuTitle}
      >
        <Control
          icon="redo"
          label={strings.redo}
          variant="quiet"
          disabled={!editor.canRedo}
          onClick={() => {
            editor.redo();
            setMenuOpen(false);
          }}
        />
      </Menu>
    </div>
  );
}

function PermissionPanel({
  message,
  onRetry,
  onBack,
}: {
  /** The actual error when there is one (a denied mic, or a failed decode) — */
  /** honest over the generic mic-needed title. */
  message: string | null;
  onRetry: () => void;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-[18px] px-[22px] text-center">
      <span style={{ color: "var(--s-live)" }}>
        <Icon name="alert" size={52} />
      </span>
      <p className="t-title" style={{ color: "var(--s-ink)" }}>
        {message ?? strings.micNeededTitle}
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
