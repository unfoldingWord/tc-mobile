import { useCallback, useEffect, useRef, useState } from "react";

import { Control } from "./control";
import { EraseConfirm } from "./erase-confirm";
import { Icon } from "./icon";
import { Menu } from "./menu";
import { Notice } from "./notice";
import { SelectionOverlay } from "./selection-overlay";
import { strings } from "./strings";
import { LiveScope } from "./live-scope";
import { VuMeter } from "./vu-meter";
import { Waveform } from "./waveform";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import { useEraseSegment } from "@/hooks/use-erase-segment";
import { useRecorderSegment } from "@/hooks/use-recorder-segment";
import { useSegmentEditor } from "@/hooks/use-segment-editor";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { panAfterCut, viewportWindow } from "@/lib/audio/viewport";
import { formatDuration } from "@/lib/utils";
import type { SegmentId } from "@/types/domain";

/**
 * Where the fixed centerline sits across the waveform viewport (F6).
 *
 * Centered. Sitting it right-of-centre gave the recorded audio room to the
 * right to grow into on an append (mockup 3), but Tim's v0.1.2 review asked for
 * it centered on every screen — that overrides the append-headroom tradeoff.
 * One constant to retune.
 */
const CENTER_FRACTION = 0.5;

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
 * The sheet is two modes (#89). RECORD mode is the hero Record + Play pair with
 * the menu opener in the header; the finished toggle lives in that menu. EDIT
 * mode — entered deliberately from the record menu, strictly idle — is the
 * [zoom] [select] [undo] [redo] [menu] spread with the selection frame, paste
 * marker and floating Cut, marked by a header "Editing" pill that also exits.
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
  // The sheet is two modes over one segment (#89): a record mode (the hero
  // Record + Play pair) and an edit mode (the waveform-editing toolbar). The
  // sheet always opens in record; App keys it on `segmentId` so it remounts per
  // open, so `"record"` is the open state with no reset effect needed. Edit is
  // entered deliberately from the record menu and is strictly idle.
  const [mode, setMode] = useState<"record" | "edit">("record");
  // The VU strip is visible by default when the sheet opens (D-VU-DEFAULT); the
  // menu toggles it. Per-session local state — there is no prefs layer to
  // persist it across opens.
  const [vuVisible, setVuVisible] = useState(true);
  // The Erase Segment confirmation (D-CONFIRM), opened from the menu.
  const [confirmOpen, setConfirmOpen] = useState(false);

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

  // Clamp to the current length: an edit (a cut) can shorten `working` past a
  // `panState` set before it, and a stale pan beyond the end would sit the record
  // offset at the new end rather than where the translator was looking (George
  // R4). `viewportWindow` also clamps `centerlineSample`, so drawing was already
  // safe; this keeps the offset honest too.
  const pan = Math.min(panState ?? length, length);
  const win = viewportWindow(length, pan, zoom, CENTER_FRACTION);

  // The record-mode playback playhead (#89), as a fraction of the WHOLE working
  // buffer — the same clip-fraction domain `Waveform`'s `view` bars are drawn
  // through, so `playheadViewportX` lands it over the sample it marks. Null
  // whenever the buffer is not sounding; guarded on a non-zero duration so an
  // empty buffer never divides to NaN (Play is disabled there anyway).
  const workingDurationMs = (length / CANONICAL_SAMPLE_RATE) * 1000;
  const playhead =
    audio.playingBuffer && workingDurationMs > 0
      ? // Clamp to [0,1]: `elapsed()` clamps to the AudioBuffer duration and
        // `workingDurationMs` is derived from the same sample count, but a float
        // overshoot > 1 would make `playheadViewportX` skip the final tick
        // (George R5). Elapsed is never negative, so the floor is belt-only.
        Math.min(1, Math.max(0, audio.playbackElapsedMs / workingDurationMs))
      : null;

  // While the buffer plays, show the WHOLE working buffer so the sweeping
  // playhead is always on screen (George R1). The pan/zoom window exists to
  // choose an insert point for a record, not to watch playback travel — resting
  // at the append-ready end it hides the first half of the clip from a playhead
  // that starts at 0. Playback overrides it with a full-clip view; the record
  // window returns the moment playback stops.
  const waveView = {
    startFraction: audio.playingBuffer ? 0 : hasAudio ? win.start / length : 0,
    endFraction: audio.playingBuffer ? 1 : hasAudio ? win.end / length : 1,
    centerFraction: CENTER_FRACTION,
  };

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
      // Frozen during playback too: the canvas is showing the whole-clip view,
      // so a drag would move the hidden record `pan`/insert offset the translator
      // cannot see, and the viewport would jump when playback stops (Frank/George
      // R2). Playback is listen-only — no scrub in v1 (D4).
      if (!hasAudio || recording || paused || busy || audio.playingBuffer)
        return;
      setDragging(true);
      dragStartX.current = e.clientX;
      panAtDragStart.current = pan;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [hasAudio, recording, paused, busy, audio.playingBuffer, pan]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      // Freeze a drag ALREADY in flight the moment the take goes non-idle, not
      // just its start (onPointerDown). A pan begun while idle keeps its pointer
      // capture, so with a second finger the translator can tap Record and keep
      // moving the first finger through the `requesting` window — sliding the
      // centerline off the sample insertionOffset already locked to at the tap
      // (#61). The pointer-down guard alone left this multitouch path open.
      // Also frozen once playback starts mid-drag (same whole-clip desync, R2).
      if (!dragging || recording || paused || busy || audio.playingBuffer)
        return;
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
    [
      dragging,
      recording,
      paused,
      busy,
      audio.playingBuffer,
      win.visibleSamples,
      length,
    ]
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
      // menu, so a Redo left open cannot rematerialise the working buffer out
      // from under the offset just locked below (George R4).
      editor.closeSelection();
      setMenuOpen(false);
      // The offset is fixed for the whole take here, at the idle→recording
      // edge; pause/resume continues at the same point (F9). It is an offset
      // into the WORKING buffer, which is also the record's splice base on close.
      setStopError(null);
      insertionOffset.current = win.centerlineSample;
      audio.startRecording();
    }
  }, [recording, paused, view, audio, editor, win.centerlineSample]);

  // Play the in-memory WORKING buffer from offset 0 (D3/D4): the segment's
  // stored recording plus any unsaved edits (cut/paste) made this session. It is
  // NOT a just-captured take — a new recording is decoded and spliced only on
  // close (Model A, commit-on-close), so a fresh capture becomes playable after
  // it commits and the sheet reopens, not before (#101). The pause-glyph the
  // wireframe shows while sounding stops it. Routed through the same single-owner
  // floor as `playTake`, so `startRecording()` stops it for free (no hand-stop
  // in `onRecordButton`, F3).
  const onPlayButton = useCallback(() => {
    if (audio.playingBuffer) audio.stopBuffer();
    else audio.playBuffer(editor.working);
  }, [audio, editor]);

  // Enter edit mode from the record menu. Play is a record-only control, so any
  // live buffer playback is stopped first — else it would orphan itself with no
  // control to stop it.
  const onEnterEdit = useCallback(() => {
    audio.stopBuffer();
    setMode("edit");
    setMenuOpen(false);
  }, [audio]);

  // The permission panel's Retry. It bypasses `onRecordButton`, so it must force
  // record mode itself: Edit is reachable while the panel is up (empty segment +
  // full clipboard), and a Retry from there would otherwise start the mic with
  // the edit toolbar on screen and no Record/Pause/VU — "Editing" over a live
  // capture (George R3). Any path that starts the mic belongs in record mode.
  const onRetryRecord = useCallback(() => {
    setMode("record");
    audio.startRecording();
  }, [audio]);

  // Open the ≡ menu. Stops buffer playback first: the menu is the one gateway to
  // every idle-time action reachable while a buffer sounds (Edit, Finished, VU,
  // Erase), and opening it inerts the sheet — so Play, the only stop control,
  // goes unreachable, and Erase locks a confirm behind that scrim (George R5).
  // Stopping here closes that whole class at the boundary, like entering edit.
  const openMenu = useCallback(() => {
    audio.stopBuffer();
    setMenuOpen(true);
  }, [audio]);

  // Exit edit mode — the header "Editing" pill and the edit-menu "Done editing"
  // row share this. Close any open selection AND reset zoom to whole: record
  // mode has no zoom control, so a quarter-zoom carried out of edit would leave
  // the record view stuck zoomed with no way to widen it (George R1). It only
  // switches mode, it never closes the sheet (that is Back/`close`).
  const onExitEdit = useCallback(() => {
    editor.closeSelection();
    setZoom(ZOOM_WHOLE);
    setMode("record");
    setMenuOpen(false);
  }, [editor]);

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

  const onCut = useCallback(() => {
    const removed = editor.cut();
    // Keep the centerline on the same audio: a cut before it shortens the buffer
    // to its left, so shift an absolute pan by what was removed (George R5). A
    // null/resting pan already follows the new end.
    if (removed !== null) {
      setPanState((p) => (p === null ? null : panAfterCut(p, removed)));
    }
  }, [editor]);

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

  // Erase Segment (D-ERASE-OP / D-TWO-ENTRIES): the same hook the Segments-row
  // overflow uses. It clears the stored take and returns the segment to
  // never-recorded, then this sheet closes dirty so App reloads the list. Only
  // offered on a segment that has stored audio — a first, uncommitted recording
  // in this session has nothing on disk to erase.
  const erase = useEraseSegment();
  const onConfirmErase = useCallback(() => {
    // Stop any buffer playback before the delete: EraseConfirm latches its
    // in-flight guard synchronously and the sheet is inert, so Play — the only
    // stop control — is unreachable across the whole IDB write (George R5).
    // Reaching the confirm already goes through `openMenu`, which stops it; this
    // is the belt to that suspenders, and matches the Segments list's leave().
    audio.stopBuffer();
    void (async () => {
      const result = await erase.erase(segmentId);
      // "ok": success unmounts this sheet; the working buffer and any pending
      // edits go with it, which is the point. "failed": keep the sheet, drop the
      // confirm, show the notice. "busy": a double-tap's refused second call —
      // ignore it, the first call still owns the dialog (else the confirm would
      // vanish mid-erase, exposing Back and its save path over the delete).
      if (result === "ok") onExit(true);
      else if (result === "failed") setConfirmOpen(false);
    })();
  }, [erase, segmentId, onExit, audio]);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    setIsClosing(true);
    // Silence buffer playback now, not at the eventual unmount `leave()`: the
    // async commit below can run a save while a long buffer keeps sounding, and
    // Play goes `disabled` on `isClosing` so nothing on screen can stop it
    // (George R1). `stopBuffer` only releases its own "take" floor — never a
    // capture, so it is safe ahead of the `stopRecording` commit path.
    audio.stopBuffer();
    void (async () => {
      // Commit on close (F8): if the mic is live or paused, stop it, then
      // splice what it captured into the segment's audio. `stopRecording`
      // releases the mic and never rejects; `saveRecording` never rejects and
      // turns a failure into the recovery screen App renders.
      let committed = false;
      // A take was in play at close (live, paused, or an interruption froze it to
      // processing). Its stop can be SUPERSEDED — a leave()/pagehide bumped the
      // generation mid-flush — returning no samples and no error. B4 just closed
      // then, original intact. B5 must keep that: the edit-only block below must
      // NOT run on a superseded capture, or a cut-to-empty would clear the
      // original recording (gone) with the replacement never landed and the cut
      // audio only in RAM on the clipboard — unrecoverable field loss (George R5).
      const attemptedCapture = recording || paused || state === "processing";
      if (attemptedCapture) {
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
      // An edit-only close (B5): cuts/pastes with no take committed. Gated on
      // `!attemptedCapture` so a superseded capture stop (above) abandons the
      // session like B4 — persisting or clearing there is the George-R5 loss.
      if (!committed && !attemptedCapture && editor.hasEdits) {
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

  // A mic permission/start failure, at idle (distinct from a decode failure,
  // which travels as `stopError`). Keyed on `recorderError`, NOT the merged
  // `audio.error`: `playBuffer` is the first in-sheet path that can set a
  // playback error, and a failed Play must not raise the mic permission panel
  // (whose Retry starts the mic) — it stays a toolbar Notice via `audio.error`
  // below (George R4). `audio.error` still equals `recorderError` when this is
  // true, so the panel message is unchanged.
  const micError =
    state === "idle" && audio.recorderError !== null && stopError === null;
  // The full-body permission panel REPLACES the sheet body, so it may only take
  // over when there is nothing on screen to lose: the device cannot record, or a
  // mic error on a segment with no audio and no pending edits. With audio or
  // edits present, the error shows in place (the `audio.error` Notice below,
  // Record acting as Retry) so the waveform — and undo — stay reachable; hiding
  // them once lost an edit that Back then persisted with no way to undo (George
  // R3). Same principle a decode failure already follows via `stopError`.
  const denied =
    !audio.supported || (micError && !hasAudio && !editor.hasEdits);

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
      {/* `inert` the sheet while the menu is open. Nested aria-modal dialogs do
          not reliably hide the background for AT/switch users — G8 already
          refused to trust that on the Segments list — so without this an AT user
          could reach the covered Record while the menu is up and mutate the
          splice base under a Redo (George R4). */}
      <div
        ref={sheetRef}
        className="recorder-sheet mx-auto max-w-md"
        inert={menuOpen || confirmOpen || undefined}
      >
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
          {mode === "record" ? (
            // The menu opener lives in the header in record mode (the toolbar is
            // just the Record + Play pair). Same gate the old toolbar opener
            // used — reachable mid-take for the VU toggle, blocked only through
            // the close window.
            <Control
              icon="menu"
              label={strings.recorderMenuOpen}
              variant="quiet"
              // Also closed while `denied`: the permission panel owns the body
              // and its Retry/Back, and opening the menu inerts the sheet — which
              // would put the scrim over the panel's Retry with no way to reach it
              // until the menu is dismissed (George R4).
              disabled={!view || isClosing || denied}
              onClick={openMenu}
            />
          ) : (
            // The "Editing" pill (D2): the visible mode marker for a sighted
            // non-reader AND the Done exit in one element — text says the mode,
            // aria-label/title speak the action, tapping exits to record.
            <button
              type="button"
              className="modepill"
              aria-label={strings.doneEditing}
              title={strings.doneEditing}
              // Frozen through the close window, same gate as the record-mode
              // menu opener: a mode flip mid-save would drop the translator into
              // record mode over unsaved edits if that save then fails (George R2).
              disabled={isClosing}
              onClick={onExitEdit}
            >
              {strings.modepillEditing}
            </button>
          )}
        </header>

        {denied ? (
          <PermissionPanel
            message={audio.error}
            onRetry={onRetryRecord}
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
            {erase.error && (
              <div className="px-[12px] pt-[8px]">
                <Notice>{strings.eraseFailed}</Notice>
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
                {(recording || paused) && !audio.meterFailed ? (
                  // Capturing with a working tap: a dedicated live scope replaces
                  // the static waveform — it grows from the head and scrolls R→L
                  // (#120). `active={recording}` freezes it on pause (the mic
                  // still emits frames, R-B6). Its own draw path sidesteps
                  // Waveform's `!recorded` gate, which would blank a first take.
                  <LiveScope
                    readScope={audio.readScope}
                    active={recording}
                    headFraction={CENTER_FRACTION}
                    height={200}
                    label={strings.liveWaveform}
                  />
                ) : (
                  // Idle / edit / playback — AND the tap-failed capture fallback:
                  // `readScope` is null there, so keep Waveform with `capturing`
                  // so the #110 record centerline stays up over the existing
                  // audio (or the dotted first-take rule), not a blank stage
                  // (George R1). The VU strip already signals the tap failure.
                  <Waveform
                    peaks={editor.peaks}
                    height={200}
                    recorded={hasAudio}
                    capturing={recording || paused}
                    playhead={playhead}
                    view={waveView}
                  />
                )}
                {mode === "edit" &&
                  editor.selectionActive &&
                  editor.selection && (
                    <SelectionOverlay
                      win={win}
                      selection={editor.selection}
                      workingLength={length}
                      onChange={editor.setSelection}
                      startLabel={strings.selectionStartHandle}
                      endLabel={strings.selectionEndHandle}
                    />
                  )}
                {mode === "edit" &&
                  idleEditable &&
                  editor.canPaste &&
                  !editor.selectionActive && (
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
              {mode === "edit" && (
                <div className="recorder-cut flex justify-center">
                  {/* The Cut affordance sits under the frame (mockup 4). Cutting
                      drops the selection and turns the paste marker on. Edit-mode
                      only — the block is absent from the record-mode tree — but
                      still `disabled` on the same `idleEditable` safety: without
                      it a Cut tapped during the async close would mutate the
                      working buffer after close() already captured the pre-cut
                      one — a silently dropped edit. */}
                  <Control
                    icon="scissors"
                    label={strings.cut}
                    variant="quiet"
                    size={26}
                    disabled={!idleEditable || !editor.canCut}
                    onClick={onCut}
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

            {mode === "record" && vuVisible && (
              // Under the waveform (mockup 3), visible by default. Record-mode
              // only — no mic take can exist in edit mode. `active` gates
              // its own rAF loop, so it only animates while a take is live and
              // rests empty otherwise — the sheet never re-renders per frame
              // (D-LEVEL-PULL: it polls `audio.readLevel` on its own clock).
              <div className="px-[16px]">
                <VuMeter
                  readLevel={audio.readLevel}
                  // Only while actually recording — NOT paused. MediaRecorder
                  // pause does not pause the mic track, so the analyser keeps
                  // reading; a live bar over a paused take reads as "still
                  // recording" for audio that is not being captured (George R-B6).
                  active={recording}
                  unavailable={audio.meterFailed}
                  label={strings.vuMeterLabel}
                  unavailableLabel={strings.vuMeterUnavailable}
                />
              </div>
            )}

            {audio.error && <Notice>{audio.error}</Notice>}

            {mode === "record" ? (
              // Record mode: the centered hero pair. Record (xl 68px) is THE
              // action; Play (lg 52px) sits to its right, dead while any take is
              // live/committing or the mic is spinning up, live at idle with
              // audio. The menu opener is in the header, not here.
              <div className="recorder-toolbar pair flex items-center px-[16px]">
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
                  // Disabled while the buffer plays: the visible whole-clip view
                  // no longer shows the insert centerline, so a record started
                  // here would splice at the hidden append offset the translator
                  // cannot see (George R2). Stop playback (tap Play) first.
                  disabled={busy || isClosing || !view || audio.playingBuffer}
                  onClick={onRecordButton}
                />
                <Control
                  icon={audio.playingBuffer ? "pause" : "play"}
                  label={
                    audio.playingBuffer
                      ? strings.stopPlayback
                      : strings.playRecording
                  }
                  variant="play"
                  disabled={takeActive || busy || !hasAudio}
                  onClick={onPlayButton}
                />
              </div>
            ) : (
              // Edit mode: the spread editing toolbar. Redo is a visible button
              // here (out of the menu); the menu opener lives at the end.
              <div className="recorder-toolbar edit flex items-center px-[16px]">
                <Control
                  icon={zoom === ZOOM_WHOLE ? "zoom-in" : "zoom-out"}
                  label={
                    zoom === ZOOM_WHOLE
                      ? strings.zoomQuarter
                      : strings.zoomWhole
                  }
                  variant="quiet"
                  size={24}
                  onClick={() =>
                    setZoom((z) =>
                      z === ZOOM_WHOLE ? ZOOM_QUARTER : ZOOM_WHOLE
                    )
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
                  icon="undo"
                  label={strings.undo}
                  variant="quiet"
                  size={24}
                  disabled={!idleEditable || !editor.canUndo}
                  onClick={editor.undo}
                />
                <Control
                  icon="redo"
                  label={strings.redo}
                  variant="quiet"
                  size={24}
                  // Same guard the menu Redo had (George R4): a Redo mid-take
                  // would rematerialise the working buffer under the locked
                  // insertion offset — but `idleEditable` forbids that, and edit
                  // mode is idle-only regardless.
                  disabled={!idleEditable || !editor.canRedo}
                  onClick={editor.redo}
                />
                <Control
                  icon="menu"
                  label={strings.recorderMenuOpen}
                  variant="quiet"
                  size={24}
                  disabled={!view || isClosing}
                  onClick={openMenu}
                />
              </div>
            )}
          </>
        )}
      </div>
      <Menu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={strings.recorderMenuTitle}
      >
        {mode === "record" ? (
          <>
            <Control
              icon="edit"
              label={strings.enterEdit}
              variant="quiet"
              // Idle-only. Editable when there is audio to edit OR a full
              // clipboard to paste — a never-recorded segment with a pending clip
              // must still open edit mode to receive it, or the chapter-wide
              // clipboard (G3) could never land on an empty segment (George R2).
              // Never while `denied`: the permission panel owns the body, and
              // entering edit there strands the edit toolbar over a Retry that
              // starts the mic (George R3, with onRetryRecord as the other half).
              disabled={
                !idleEditable || denied || (!hasAudio && !editor.canPaste)
              }
              onClick={onEnterEdit}
            />
            <Control
              icon="check"
              // Green AND the mark/unmark label both key on `finishedState`, the
              // resolved state the store will actually write — NOT the raw
              // `displayedFinished` intent. They diverge on an emptied segment:
              // mark finished, Edit, cut all, Done → `finishedState` is
              // "disabled" (a 0-frame take cannot be finished, and close writes
              // `finished: false`), but `displayedFinished` is still true, so
              // keying the paint on it would show a green, "Unmark finished" row
              // that lies until close (George R1). `finishedState === "finished"`
              // is true only when the mark will stick.
              label={
                view && finishedState === "finished"
                  ? strings.markUnfinished(view.ordinal)
                  : strings.markFinished(view?.ordinal ?? 0)
              }
              variant="quiet"
              // Same `onToggleFinished`/`finishedIntent` semantics the header
              // checkbox carried (D1) — only the trigger moved. It does NOT close
              // the menu: the row re-renders in place so the check turns green as
              // the translator taps, the record-and-mark-done-in-one-sheet flow.
              // Frozen through the requesting/processing/close window exactly as
              // Record is (G10), plus the never-recorded `finishedState ===
              // "disabled"` the Checkbox encoded via `state`.
              className={finishedState === "finished" ? "is-done" : undefined}
              disabled={finishedState === "disabled" || isClosing || busy}
              onClick={onToggleFinished}
            />
            <Control
              icon={vuVisible ? "eye-off" : "eye"}
              label={vuVisible ? strings.vuHide : strings.vuShow}
              variant="quiet"
              // Close the menu so the change to the strip behind it is visible.
              onClick={() => {
                setVuVisible((v) => !v);
                setMenuOpen(false);
              }}
            />
            <Control
              icon="trash"
              label={strings.eraseSegment}
              variant="quiet"
              // Only when there is stored audio to erase (a first, uncommitted
              // recording has nothing on disk yet) AND only at idle: erasing the
              // stored take out from under a live capture is nonsensical, and the
              // menu opener is reachable mid-take for the VU toggle, so this
              // entry must refuse there itself (George R-B6).
              disabled={!idleEditable || !view?.hasClip}
              onClick={() => {
                setMenuOpen(false);
                setConfirmOpen(true);
              }}
            />
          </>
        ) : (
          <>
            <Control
              icon="check"
              label={strings.doneEditing}
              variant="quiet"
              onClick={onExitEdit}
            />
            <Control
              icon="trash"
              label={strings.eraseSegment}
              variant="quiet"
              // Kept reachable from edit mode too — erasing is a segment-level op
              // useful in either mode. Same idle + has-stored-clip guard.
              disabled={!idleEditable || !view?.hasClip}
              onClick={() => {
                setMenuOpen(false);
                setConfirmOpen(true);
              }}
            />
          </>
        )}
      </Menu>
      <EraseConfirm
        open={confirmOpen}
        title={strings.eraseConfirmTitle}
        confirmLabel={strings.eraseConfirm}
        cancelLabel={strings.eraseCancel}
        busy={erase.erasing}
        onConfirm={onConfirmErase}
        onCancel={() => setConfirmOpen(false)}
      />
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
