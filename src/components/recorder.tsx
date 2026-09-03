import { useCallback, useEffect, useRef, useState } from "react";

import { Control } from "./control";
import { EraseConfirm } from "./erase-confirm";
import { Icon } from "./icon";
import { Menu } from "./menu";
import { Notice } from "./notice";
import { PlayheadOverlay } from "./playhead-overlay";
import { SelectionOverlay } from "./selection-overlay";
import { strings } from "./strings";
import { LiveScope } from "./live-scope";
import { VuMeter } from "./vu-meter";
import { Waveform } from "./waveform";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import { useEraseSegment } from "@/hooks/use-erase-segment";
import { useRecorderSegment } from "@/hooks/use-recorder-segment";
import { useSegmentEditor } from "@/hooks/use-segment-editor";
import { mergeTake } from "@/lib/audio/edit";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { computePeaks } from "@/lib/audio/peaks";
import { panAfterCut, viewportWindow } from "@/lib/audio/viewport";
import { formatDuration } from "@/lib/utils";
import type { Peaks } from "@/types/audio";
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

/** Peak resolution for the paused-take preview (#101), matched to the editor's. */
const PREVIEW_PEAK_BUCKETS = 400;

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
  const {
    view,
    error: loadError,
    retrying: loadRetrying,
    retry: retryLoad,
    setFinished,
  } = useRecorderSegment(segmentId);

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
  /**
   * The in-sheet preview of the paused take-so-far (#101): the decoded capture
   * spliced into `working` by `mergeTake` at the same `insertionOffset` `close()`
   * commits — so the preview lands exactly WHERE Back saves it, though its tail
   * can be up to one 250 ms timeslice short of the final PCM on a browser that
   * rejects a paused `requestData()` flush — plus its peaks for the stage.
   * Prepared on the first Play while paused and reused across replays. Invalidated
   * outright by a resume/re-record (`cancelPreview`, the take grew), and its
   * DECODE aborted while the object is kept on stage by the ≡ menu, Back, and a
   * #59 interruption (`abortPreview`). Consumed on stage across the take-in-flight
   * window — paused, `busy`, and `isClosing` (`previewShown` below) — but never at
   * idle, so a stale object left after a failed close is inert. `previewState` is
   * `"decoding"` while a decode is in flight and `"failed"` when this device could
   * not decode the paused container (iOS writes the moov atom only on stop) — Play
   * then degrades to disabled with a Notice rather than a false or silent preview.
   */
  const [preview, setPreview] = useState<{
    buffer: Int16Array;
    peaks: Peaks | null;
  } | null>(null);
  const [previewState, setPreviewState] = useState<
    "none" | "decoding" | "failed"
  >("none");
  /**
   * The preview request epoch (#101). A first paused Play decodes asynchronously
   * (`previewCapture` + `mergeTake`); this is bumped by every transport tap
   * (`onRecordButton`) and by `close()`, and the decode IIFE captures it at the
   * start and bails if it changed. Without it a resume/Back landing mid-decode
   * would let the stale promise repopulate the preview and play it — into a
   * now-live take (the Frank+George R1 finding: a resumed mic with no floor
   * holder, the preview bleeding into the recording). `previewCapture`'s own
   * generation does not move on resume, so the guard must live here.
   */
  const previewGenRef = useRef(0);
  /**
   * A preview decode is in flight, written SYNCHRONOUSLY so a second Play tap that
   * lands before the `"decoding"` state commits cannot start a second decode —
   * the same reason `playingBufferRef` exists (#101 / George R2). Cleared when the
   * decode settles or the epoch is bumped.
   */
  const previewDecodeRef = useRef(false);
  /**
   * The most recent preview decode promise, so the NEXT paused Play chains behind
   * it (#101 / George R5 #1): a Play→Resume→Play loop leaves the first
   * `decodeToCanonical` running (resume cannot abort it), and chaining keeps the
   * two from allocating a full PCM buffer at once. `close()` deliberately does NOT
   * await this — that would delay `stop()`'s pagehide-safe capture-steal (George R7
   * P1). Null when none is in flight.
   */
  const previewPromiseRef = useRef<Promise<void> | null>(null);

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

  // The prepared preview, shown on the stage across the whole take-in-flight
  // window — paused, `busy` (a #59 interruption's `processing`), and `isClosing`
  // (the F8 stop→decode→save) — so a first take's `LiveScope`, which unmounts for
  // the preview, does not REMOUNT BLANK during a commit or interruption (George R1
  // P4 / R3 #1). Deliberately NOT at idle: a failed close reopens the sheet idle
  // with `preview` still set, and drawing it there would put Record/Pan over a
  // whole-clip preview with no insert line (George R4 #1). A resume/re-record
  // discards the preview (`cancelPreview`); the failed-close paths do too. A single
  // narrowed value so the stage reads `.buffer`/`.peaks` without a null assertion.
  const previewShown = paused || busy || isClosing ? preview : null;

  // The sounding buffer's duration, for the playhead overlay's position fraction
  // (#102). The denominator is the buffer shown: the preview (longer than
  // `working`, #101) while a preview is up, else `working`. The overlay PULLS
  // `audio.readPlaybackElapsed` on its own rAF and moves a DOM line, so buffer
  // playback re-renders nothing — not this sheet, nor the inert list behind it.
  const soundingLength = previewShown ? previewShown.buffer.length : length;
  const soundingDurationMs = (soundingLength / CANONICAL_SAMPLE_RATE) * 1000;

  // Play previews a stored/edited take at idle, and the paused take-so-far while
  // paused (#101). The preview states gate Play ONLY on the paused branch —
  // disabled mid-decode, and after a decode this device could not do (`failed`,
  // with the Notice below). A leftover `"decoding"`/`"failed"` from a preview the
  // translator resumed or backed out of must NOT disable Play at idle over the
  // stored buffer (George R2 #2). Not paused: disabled while recording, closing,
  // or with nothing to play.
  const playDisabled =
    busy ||
    isClosing ||
    (paused
      ? previewState === "decoding" || previewState === "failed"
      : recording || !hasAudio);

  // Show the WHOLE buffer while a preview is up or a buffer plays, so the
  // sweeping playhead is always on screen and the preview's own peaks are not
  // sliced by a pan window measured against `working` (George R1). The pan/zoom
  // window exists to choose an insert point for a record, not to watch playback
  // travel; the record window returns when the preview clears on Resume.
  const wholeView = previewShown !== null || audio.playingBuffer;
  const waveView = {
    startFraction: wholeView ? 0 : hasAudio ? win.start / length : 0,
    endFraction: wholeView ? 1 : hasAudio ? win.end / length : 1,
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

  // Abort an in-flight decode and drop the synchronous guard, but KEEP a prepared
  // preview on the stage (#101). A first take's `LiveScope` remounts blank once it
  // unmounts for the preview, so discarding the preview on Back or a #59
  // interruption would blank the stage for the whole commit — the "looks
  // discarded" class the `isClosing` LiveScope clause exists to prevent (George R3
  // #1). The ≡ menu and Back (`close`) use this; it does not stop playback, so they
  // pair it with `stopBuffer()`. A `"decoding"` state resets to `"none"` (the
  // decode is gone); a `"failed"` one stays. The paused-exit effect does its own
  // lighter subset (epoch + guard + `stopBuffer`, no state reset) to stay out of
  // set-state-in-effect; its leftover `previewState` is inert (`playDisabled` gates
  // it only while paused).
  const abortPreview = useCallback(() => {
    previewGenRef.current++;
    previewDecodeRef.current = false;
    setPreviewState((s) => (s === "decoding" ? "none" : s));
  }, []);

  // Discard the preview outright — abort the decode AND drop the prepared buffer
  // and state. Only a resume or a new record uses this: the take GROWS, so the
  // next Play must re-decode rather than replay stale audio.
  const cancelPreview = useCallback(() => {
    previewGenRef.current++;
    previewDecodeRef.current = false;
    setPreview(null);
    setPreviewState("none");
  }, []);

  // Any exit that never reaches a transport handler — chiefly a #59 mic
  // interruption freezing the take to "processing" while a preview is sounding —
  // must still stop playback and invalidate an in-flight decode, or the preview
  // plays on with Play/Record both disabled by `busy` (George R2 #4). Runs on any
  // leave from `paused`. `stopBuffer` is a callback, not a direct set-state, so
  // this effect stays within the hooks rules; the leftover `previewState` is inert
  // (`playDisabled` gates it only while paused) and the kept `preview` object
  // still draws on stage through `busy`/`isClosing` (`previewShown`) — the R3 #1
  // no-blank-on-interruption behaviour.
  const stopBuffer = audio.stopBuffer;
  useEffect(() => {
    if (paused) return;
    previewGenRef.current++;
    previewDecodeRef.current = false;
    stopBuffer();
  }, [paused, stopBuffer]);

  const onRecordButton = useCallback(() => {
    if (closing.current || !view) return;
    // Any transport action invalidates a prepared preview (#101): a resume may
    // append audio the preview would not include, and a new record replaces the
    // take. Re-decoded fresh on the next Play while paused. (Pausing has no
    // preview yet, so this is a no-op there.)
    cancelPreview();
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
  }, [
    recording,
    paused,
    view,
    audio,
    editor,
    win.centerlineSample,
    cancelPreview,
  ]);

  // Play the in-memory WORKING buffer from offset 0 (D3/D4): the segment's
  // stored recording plus any unsaved edits (cut/paste) made this session. It is
  // NOT a just-captured take — a new recording is decoded and spliced only on
  // close (Model A, commit-on-close), so a fresh capture becomes playable after
  // it commits and the sheet reopens, not before (#101). The pause-glyph the
  // wireframe shows while sounding stops it. Routed through the same single-owner
  // floor as `playTake`, so `startRecording()` stops it for free (no hand-stop
  // in `onRecordButton`, F3).
  const onPlayButton = useCallback(() => {
    // Guard the close window like `onRecordButton` does: Play is enabled while
    // paused now (#101), so a tap racing `close()` before `isClosing` disables the
    // button would otherwise start a preview over the commit (George R9 P3-4).
    if (closing.current) return;
    if (audio.playingBuffer) {
      audio.stopBuffer();
      return;
    }
    // Idle: preview the stored/edited working buffer, as before (#89). The
    // playhead overlay (#102) positions itself off `readPlaybackElapsed`, so no
    // seed is needed on the play edge.
    if (!paused) {
      audio.playBuffer(editor.working);
      return;
    }
    // Paused: preview the take captured SO FAR without committing it (#101).
    // Replay a prepared preview immediately; otherwise decode the paused capture
    // and splice it into `working` at the same `insertionOffset` `close()` commits
    // (`mergeTake`) — so the preview lands where the take will, though its tail can
    // be up to one 250 ms timeslice short of the final save on a browser that
    // rejects a paused `requestData()` flush (Frank+George R2). A decode this
    // device cannot do resolves null and degrades Play to disabled with a Notice,
    // never a false preview. `preemptPausedMic` takes the floor from the paused
    // mic (approach B). `previewDecodeRef` guards a second tap landing before the
    // `"decoding"` state commits — a second decode of a long take (George R2 #3).
    if (previewState === "decoding" || previewDecodeRef.current) return;
    if (preview) {
      audio.playBuffer(preview.buffer, 0, { preemptPausedMic: true });
      return;
    }
    const gen = previewGenRef.current;
    const previous = previewPromiseRef.current;
    previewDecodeRef.current = true;
    setPreviewState("decoding");
    // CHAINED behind any prior decode so two decodeToCanonical passes never
    // allocate together (George R5 #1): a Play→Resume→Play loop leaves the first
    // decode still running (resume does not abort it), and replacing the promise
    // would drop that serialisation. `close()` deliberately does NOT await this —
    // that delayed stop()'s pagehide-safe capture-steal (George R7 P1).
    previewPromiseRef.current = (async () => {
      try {
        // Wait out a prior preview decode's WORK; its RESULT is dropped by the
        // epoch. One full PCM buffer exists at a time, not two.
        if (previous) await previous;
        if (gen !== previewGenRef.current) return;
        const pcm = await audio.previewCapture();
        // A resume/close/re-record/menu/interruption during the decode bumped the
        // epoch: this take is no longer the one being previewed. Drop the result
        // silently — writing `preview`/`playBuffer` now would play stale audio
        // into a live take (Frank+George R1).
        if (gen !== previewGenRef.current) return;
        if (pcm === null) {
          setPreviewState("failed");
          return;
        }
        const buffer = mergeTake(editor.working, pcm, insertionOffset.current);
        const peaks =
          buffer.length > 0 ? computePeaks(buffer, PREVIEW_PEAK_BUCKETS) : null;
        // Re-check after the synchronous splice/peaks, which are not instant on a
        // long take: a transport tap can land in that window too.
        if (gen !== previewGenRef.current) return;
        setPreview({ buffer, peaks });
        setPreviewState("none");
        // Auto-play only if the context is audible NOW. This runs after the decode
        // await, OUTSIDE the Play tap's gesture, so an iOS context left
        // "interrupted" by a route change/Siri/background DURING the decode would
        // sound a silent preview that looks like it is playing (George R9). When it
        // needs a gesture, leave the prepared preview on stage (Play stays enabled,
        // the waveform shows) so the next tap replays it in-gesture and sounds.
        if (!audio.audioNeedsGesture()) {
          audio.playBuffer(buffer, 0, { preemptPausedMic: true });
        }
      } catch (cause) {
        // mergeTake/computePeaks allocate the full result and can throw on a
        // low-memory device (the OOM class the save path already guards). Surface
        // it as a failed preview rather than leaving Play stuck on "decoding"
        // (George R1 P5); only when this epoch still owns the state.
        console.error("Could not prepare the take preview", cause);
        if (gen === previewGenRef.current) setPreviewState("failed");
      } finally {
        // Release the synchronous guard only if this decode still owns the epoch;
        // a cancel already cleared it, and a newer decode would own it next.
        if (gen === previewGenRef.current) previewDecodeRef.current = false;
      }
    })();
  }, [audio, editor, paused, preview, previewState]);

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
  // `abortPreview` extends it to an in-flight decode: without it, a decode that
  // resolves while the menu is up would start the preview behind the inert scrim
  // with no reachable stop (George R2 #1). It keeps a prepared preview so the
  // stage does not blank behind the menu and Play can replay it on close.
  const openMenu = useCallback(() => {
    audio.stopBuffer();
    abortPreview();
    setMenuOpen(true);
  }, [audio, abortPreview]);

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
    // Abort any in-flight preview decode (#101): a decode resolving during the
    // commit below must drop its result rather than start playback over the save,
    // and `previewState` must not stick on "decoding" — a failed commit reopens
    // the sheet at idle, where a stuck "decoding" would disable Play forever
    // (Frank+George R1 P2 / R2 #2). KEEP the prepared preview: it stays on the
    // stage through the stop→decode→save wait so a first take does not blank
    // (R3 #1). `stopBuffer` below silences one already sounding.
    abortPreview();
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
        // Do NOT await the in-flight preview decode here. `stop()` steals the
        // chunks/stream/recorder into locals BEFORE its first await, which is what
        // lets a `pagehide`/`leave()` during the flush cancel the mic without
        // destroying a confirmed take. Delaying `stopRecording()` behind the
        // preview promise re-opened that window: a lock/background between Back and
        // the decode settling would `cancel()` the refs, and the late `stop()`
        // would return no-samples-no-error and drop the take (George R7 P1). The
        // epoch already discards the preview result, and `decodeToCanonical` cannot
        // be aborted, so the await only bought a memory serialisation — a Back
        // landing mid-preview-decode can peak the preview's and stop()'s decodes
        // together (the R4 #2 residual, device-gated), which never justifies losing
        // a take. DROP the prepared preview's PCM first, keeping only its peaks:
        // Waveform reads `peaks`, the overlay is inactive while closing, so holding
        // the ~5.3 MB/min Int16Array across stop()'s decode + mergeTake buys nothing
        // (George R5 #2); `previewShown` still draws the peaks, so no blank.
        setPreview((p) =>
          p ? { buffer: new Int16Array(0), peaks: p.peaks } : p
        );
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
          // Reopening idle: drop the kept preview so the stage reverts to
          // `working` rather than a whole-clip preview with no insert line
          // (George R4 #1).
          cancelPreview();
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
            cancelPreview();
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
          cancelPreview();
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
    abortPreview,
    cancelPreview,
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

        {loadError ? (
          // A load/decode failure (chiefly a finished segment's MP3 on a context
          // left "interrupted", #106) used to render a bare Notice over a null
          // view — the ≡ opener is disabled on `!view`, so in-sheet Erase was
          // unreachable and nothing said the recording was safe (#137). This full
          // panel gives the state-in-place the bar asks for: a recovery tap
          // (resume + re-read), an exit (Back, to the row's Erase), and copy that
          // the audio is untouched. The raw `loadError` is kept for the log, not
          // shown — it is a decoder message, not translator-facing.
          // Checked BEFORE `denied`: a device with no MediaRecorder (`!supported`)
          // is `denied`, but its PermissionPanel Retry only re-arms the mic
          // (`startRecording`), which cannot re-read a clip — so a decode failure
          // there must reach this panel, whose Retry re-decodes (George R1 P3).
          // The two never co-occur otherwise: opening the sheet clears any mic
          // error, so `micError` and `loadError` cannot both be set.
          <LoadErrorPanel
            retrying={loadRetrying}
            onRetry={retryLoad}
            onBack={close}
          />
        ) : denied ? (
          <PermissionPanel
            message={audio.error}
            onRetry={onRetryRecord}
            onBack={close}
          />
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
            {paused && previewState === "failed" && (
              // This device could not decode the paused take for a preview (#101,
              // chiefly iOS before the take is committed on Back). Play is
              // disabled alongside; the take itself is unaffected — Back commits
              // it and it plays from the Segments list.
              <div className="px-[12px] pt-[8px]">
                <Notice>{strings.previewUnavailable}</Notice>
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
                {(recording || paused || state === "processing" || isClosing) &&
                !audio.meterFailed &&
                !hasAudio &&
                !previewShown ? (
                  // A FIRST take with a working tap: the dedicated live scope
                  // grows from the head and scrolls R→L (#120), sidestepping
                  // Waveform's `!recorded` dotted rule. It stays mounted for the
                  // WHOLE take-in-flight window — recording, paused, processing,
                  // AND the F8 close (`isClosing`, the stop→decode→save wait,
                  // where `stop()` has already flipped state to idle but the PCM
                  // is not in `working` yet, so `hasAudio` is still false). That
                  // whole predicate is `takeActive && state !== "requesting"`:
                  // without `isClosing` the frozen take snapped back to the empty
                  // dotted rule for the multi-MB IndexedDB write and read as
                  // discarded (George R2/R4). `active` goes false off "recording"
                  // (pause/processing/close), freezing the last frame (R-B6). A
                  // punch-in/append (`hasAudio`) keeps Waveform instead, so the
                  // existing clip and the #110 insert centerline stay visible.
                  <LiveScope
                    readScope={audio.readScope}
                    active={recording}
                    headFraction={CENTER_FRACTION}
                    height={200}
                    label={strings.liveWaveform}
                  />
                ) : (
                  // Idle / edit / playback, a punch-in/append capture, and the
                  // tap-failed fallback: `capturing` keeps the #110 record
                  // centerline over the existing audio (or the dotted first-take
                  // rule when the tap failed), not a blank stage (George R1/R2).
                  <Waveform
                    // The paused-take preview draws its own peaks over the whole
                    // buffer (#101); everything else shows the working buffer's.
                    // `recorded` is true whenever there is a waveform to mark —
                    // stored audio, or a prepared preview of a first take. The
                    // centerline is suppressed whenever a preview is shown or a
                    // buffer plays (`wholeView`), where a mid-clip red marker over
                    // a whole-clip view would mislead (George R2).
                    peaks={previewShown ? previewShown.peaks : editor.peaks}
                    height={200}
                    recorded={hasAudio || previewShown !== null}
                    capturing={recording || paused}
                    playing={wholeView}
                    view={waveView}
                  />
                )}
                {/* The playback playhead, a pull-model DOM overlay (#102): it
                    polls `readPlaybackElapsed` on its own rAF and moves a line,
                    so buffer playback re-renders neither this sheet nor the
                    inert list behind it. Mounted always; it hides itself when
                    nothing is sounding. */}
                <PlayheadOverlay
                  readElapsedMs={audio.readPlaybackElapsed}
                  active={audio.playingBuffer}
                  durationMs={soundingDurationMs}
                  startFraction={waveView.startFraction}
                  endFraction={waveView.endFraction}
                />
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
                  // Disabled while the buffer plays ONLY when idle: the visible
                  // whole-clip view hides the insert centerline, so a new record
                  // would splice at an offset the translator cannot see (George
                  // R2). While PAUSED the button is Resume, whose offset is already
                  // locked — resuming stops a sounding preview and continues the
                  // take, so it must stay enabled (George R3 #4). Stop playback
                  // (tap Play) first only in the idle case.
                  disabled={
                    busy ||
                    isClosing ||
                    !view ||
                    (audio.playingBuffer && !paused)
                  }
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
                  disabled={playDisabled}
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

/**
 * The segment could not be opened — a load walk or, far more often, a finished
 * segment's MP3 decode that failed (an iOS AudioContext left "interrupted",
 * #106). Same full-panel shape as `PermissionPanel`, and for the same reason:
 * a disabled control with no reason beside it is a tap that does nothing, and
 * the ≡ opener is disabled on a null view so in-sheet Erase is out of reach
 * (#137). Try again resumes the context and re-decodes on this user gesture;
 * Back returns to the Segments list, where the row's Erase does not decode and
 * still works. The recording is never touched by a failed open, so the copy
 * says so. While a retry is in flight (`retrying`) only Try again is swapped for
 * a busy Notice — the tap has visible feedback (a long-segment decode is not
 * instant) and the sheet never flickers to the disabled `!view` body. Back stays
 * mounted throughout: it is the panel's own named exit, and a retry decode
 * cannot be aborted, so hiding it would leave the whole retry window with no
 * labelled way out and drop focus with the removed control (George R1 P2).
 */
function LoadErrorPanel({
  retrying,
  onRetry,
  onBack,
}: {
  retrying: boolean;
  onRetry: () => void;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-[18px] px-[22px] text-center">
      <span style={{ color: "var(--s-live)" }}>
        <Icon name="alert" size={52} />
      </span>
      <p className="t-title" style={{ color: "var(--s-ink)" }}>
        {strings.loadFailedTitle}
      </p>
      <p style={{ color: "var(--s-ink-muted)" }}>{strings.loadFailedBody}</p>
      {retrying ? (
        <Notice tone="busy">{strings.loadRetrying}</Notice>
      ) : (
        <Control
          icon="retry"
          label={strings.loadRetry}
          variant="primary"
          size={30}
          autoFocus
          onClick={onRetry}
        />
      )}
      <Control
        icon="back"
        label={strings.loadBack}
        variant="quiet"
        onClick={onBack}
      />
    </div>
  );
}
