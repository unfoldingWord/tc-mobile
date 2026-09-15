import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import { Control } from "./control";
import { EraseConfirm } from "./erase-confirm";
import { Icon } from "./icon";
import { Menu } from "./menu";
import { Notice } from "./notice";
import { PlayheadOverlay } from "./playhead-overlay";
import { recorderStatusKind } from "./processing-status";
import { SelectionOverlay } from "./selection-overlay";
import { strings } from "./strings";
import { LiveScope } from "./live-scope";
import {
  editRowReason,
  eraseRowReason,
  markRowReason,
  rowHint,
} from "./menu-row-state";
import { VuMeter } from "./vu-meter";
import { Waveform } from "./waveform";
import { classifyShareError } from "@/hooks/share-flow";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import { useEraseSegment } from "@/hooks/use-erase-segment";
import { useRecorderSegment } from "@/hooks/use-recorder-segment";
import { useSegmentEditor } from "@/hooks/use-segment-editor";
import { auditionPlan } from "@/lib/audio/audition";
import { mergeTake } from "@/lib/audio/edit";
import { framesToMs } from "@/lib/audio/format";
import { computePeaks } from "@/lib/audio/peaks";
import { panAfterCut, viewportWindow } from "@/lib/audio/viewport";
import { overlayBlocksClose, overlayDismissal } from "@/lib/nav/navigation";
import { formatDuration } from "@/lib/utils";
import type { Peaks, SampleRange } from "@/types/audio";
import type { SegmentId } from "@/types/domain";

/**
 * Where the fixed centerline sits across the waveform viewport (F6).
 *
 * Centered. Sitting it right-of-centre gave the recorded audio room to the
 * right to grow into on an append (mockup 3), but the requirements owner's v0.1.2 review asked for
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
  /**
   * Request a Back through the browser history (#168). The on-screen Back
   * controls call THIS, not `close()` directly, so an on-screen Back and the
   * system gesture travel the one popstate path — which is what gives the
   * on-screen Back the same commit-window protection App re-arms for the system
   * one (Frank R1 F1). App answers the resulting popstate by invoking
   * `requestClose()`, so the commit still runs; erase is the one exit that
   * bypasses this and calls `onExit` directly (it must not re-commit).
   */
  onRequestBack: () => void;
}

/**
 * The imperative surface App reaches on a system Back (#168): `requestClose`
 * runs the SAME `close()` the on-screen Back does — stop, decode, save — and
 * resolves whether the sheet exited, so App can re-arm the history trap when a
 * failed commit keeps it open. This is the only way in: everything else the
 * recorder does stays inside it.
 */
export interface RecorderHandle {
  requestClose: () => Promise<boolean>;
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
 * centerline, and an in-memory undo/redo log. Editing itself runs strictly idle
 * (Model A: edits first, then one record commits on close). A live/paused take no
 * longer blocks reaching Edit (#134): the record menu's Edit commits the take
 * first (`onEnterEdit`), then reopens in edit mode over the committed audio; the
 * record's splice base is the edited buffer. On close the working buffer is
 * persisted — spliced with the recording, or on its own for an edit-only session
 * (`saveEditedSegment`).
 *
 * The sheet is two modes (#89). RECORD mode is the hero Record + Play pair with
 * the menu opener in the header; the finished toggle lives in that menu. EDIT
 * mode — entered deliberately from the record menu, strictly idle — is the
 * [play] [zoom] [select] [undo] [redo] [menu] spread with the selection frame,
 * paste marker and floating Cut, marked by a header "Editing" pill that also
 * exits. Edit-mode Play is the audition (#284): it sounds the picked span, and
 * only that span, so a cut can be heard before it is made.
 */
export const Recorder = forwardRef<RecorderHandle, RecorderProps>(
  function Recorder(
    {
      segmentId,
      audio,
      saveRecording,
      saveEditedSegment,
      clipboard,
      onClipboardChange,
      onExit,
      onRequestBack,
    },
    ref
  ) {
    const {
      view,
      error: loadError,
      retrying: loadRetrying,
      retry: retryLoad,
      reload: reloadView,
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
    /**
     * Guards the async close so a double-tap on Back cannot commit twice — and,
     * since #134, the commit `onEnterEdit` runs too: it is the single "a commit is
     * in flight" latch, so a Back tapped mid-Edit-commit (or the reverse) is
     * refused rather than double-committing the same take.
     */
    const closing = useRef(false);
    /**
     * Which entry set `heldTake` — the failed-decode recovery panel (#165) now has
     * two setters with different post-conditions, the second-setter split George's
     * R3 P2 #1 caught. Back's close() sets the take and its `retryHeldTake` success
     * must EXIT to Segments; `onEnterEdit`'s commit (#134) sets the take and its
     * retry must instead reach EDIT mode over the committed samples. This ref is the
     * discriminator: `onEnterEdit`'s blob branch sets it true, every other setter
     * (close()) leaves it false, and `retryHeldTake` consumes it. A ref, not state —
     * read synchronously in retry's async tail, no render depends on it.
     */
    const enterEditAfterRecover = useRef(false);
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
    // A take whose decode failed on Stop, held as its raw container bytes so it is
    // NOT lost (#165). While set, the recovery panel owns the body: Try again
    // re-decodes on a fresh gesture, Share hands the bytes to the OS. There is no
    // silent discard — the take exists nowhere else, so the header Back is disabled
    // for as long as this is held.
    const [heldTake, setHeldTake] = useState<Blob | null>(null);
    const [heldRetrying, setHeldRetrying] = useState(false);
    const [heldShareError, setHeldShareError] = useState<string | null>(null);
    // Retry failures read under Try again, share failures under Share (George R1
    // G6): a failed re-decode is NOT a share failure, and one shared slot mislabels
    // whichever action it was not written by. Each Notice sits under its own control.
    const [heldRetryError, setHeldRetryError] = useState<string | null>(null);
    // A successful share of the held bytes. The recording is now off the phone, so
    // the panel offers a Done exit even though the decode never succeeded (George R1
    // G1 / Frank F2) — a permanent decode failure is no longer a dead-ended app.
    const [heldShared, setHeldShared] = useState(false);
    // A share is in flight (its OS sheet may still be up). Mirrors `heldRetrying`:
    // it disables Try again in the panel while sharing (George R3 G-2), the visible
    // half of the `heldSharingRef` guard, symmetric with G7's Share-while-retrying.
    const [heldSharing, setHeldSharing] = useState(false);
    // The synchronous double-tap latch for Try again, ahead of the `heldRetrying`
    // render state (Frank F3 / George G3): two taps in one frame both read
    // `heldRetrying === false` and each mint a fresh clip through `saveRecording`,
    // orphaning one. A ref answers for the current moment — the same shape as
    // `closing.current` and `use-save-take`'s `savingRef`, which exist for this race.
    const heldRetryingRef = useRef(false);
    // The synchronous in-flight latch for Share (George R2 B-6): a same-gesture
    // double-tap before the OS sheet paints could fire a second `navigator.share`,
    // whose rejection paints `takeShareFailed` even beside the first's success. The
    // same shape `useShareFlow.send`'s `sendingRef` uses for exactly this race.
    const heldSharingRef = useRef(false);
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
    /**
     * Where the sounding buffer starts inside the buffer that is DRAWN, in
     * milliseconds (#284). Zero for every record-mode play — the working buffer
     * and the paused-take preview are each sounded whole, from their own frame 0
     * — and the audition range's start when edit mode sounds a picked span,
     * which is a view of the middle of `working`. `readSoundingElapsed` adds it,
     * so the playhead overlay keeps its one job (a position within the drawn
     * waveform) and needs no second coordinate system. A ref, not state: it is
     * read on the overlay's own rAF clock, never during render, and it is pinned
     * at the play tap so a selection changing underneath cannot move a line that
     * is already travelling.
     */
    const soundingOffsetRef = useRef(0);

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

    // The DRAWN buffer's duration, for the playhead overlay's position fraction
    // (#102). The denominator is the buffer shown: the preview (longer than
    // `working`, #101) while a preview is up, else `working`. It is deliberately
    // the drawn buffer and not the sounding one — an edit-mode audition sounds a
    // view of the middle of `working` (#284) while the whole of `working` stays
    // on screen, and the line has to travel across what the eye can see. The
    // overlay PULLS `readSoundingElapsed` on its own rAF and moves a DOM line, so
    // buffer playback re-renders nothing — not this sheet, nor the inert list
    // behind it.
    const drawnLength = previewShown ? previewShown.buffer.length : length;
    const drawnDurationMs = framesToMs(drawnLength);

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

    // Show the WHOLE buffer while a preview is up or a RECORD-mode buffer plays,
    // so the sweeping playhead is always on screen and the preview's own peaks
    // are not sliced by a pan window measured against `working` (George R1). The
    // pan/zoom window exists to choose an insert point for a record, not to watch
    // playback travel; the record window returns when the preview clears on
    // Resume.
    //
    // An edit-mode audition of a PICKED SPAN (#284) is the one exception, and it
    // is exactly as wide as its reason: the selection frame is positioned through
    // `win` (the pan/zoom window) while `Waveform` would be drawing clip fractions
    // 0..1, so a whole-clip swap under a zoomed or panned selection would leave
    // the band marking one span and the audio under it showing another — while the
    // whole point of that audition is to hear precisely the span the band marks.
    // So it plays in place.
    //
    // With NO band up there is nothing to keep aligned, and keeping the pan window
    // would reinstate the very defect the swap exists to prevent: at the F7 rest
    // (line at the end) a quarter-zoom window shows only the last quarter, while
    // the audition sounds from frame 0 — the translator hears the start of the
    // take looking at the end, with the playhead off-screen and hidden, and pan
    // frozen so it cannot be brought back (George R1 G1). A "line"/"whole"
    // audition therefore takes the whole-clip view, like record mode.
    const wholeView =
      previewShown !== null ||
      (audio.playingBuffer && (mode === "record" || !editor.selectionActive));
    const waveView = {
      startFraction: wholeView ? 0 : hasAudio ? win.start / length : 0,
      endFraction: wholeView ? 1 : hasAudio ? win.end / length : 1,
      centerFraction: CENTER_FRACTION,
    };

    // What edit-mode Play sounds (#284): the picked span when one is up, else
    // the working buffer from the centerline on. `null` ⇒ there is nothing to
    // audition (no audio, or a span collapsed to a point), which is the cue to
    // leave the control inert — state-in-place, no message. The decision is pure
    // and unit-tested in `auditionPlan`; all this does is hand it the editor's
    // current span and the viewport's line. Record mode never builds a plan: its
    // Play is the whole-buffer preview `onPlayButton` already owns.
    const audition =
      mode === "edit"
        ? auditionPlan(
            length,
            editor.selectionActive ? editor.selection : null,
            win.centerlineSample
          )
        : null;

    // The playhead's position within the DRAWN buffer (#102 + #284). Buffer
    // playback reports milliseconds into whatever was handed to `playBuffer`,
    // which for an audition of a picked span is a view starting partway through
    // `working`; adding the pinned offset here is what keeps the line over the
    // samples being heard, and keeps the overlay itself free of any notion of a
    // selection. `null` — the hide sentinel, distinct from 0 — passes through
    // untouched.
    const readPlaybackElapsed = audio.readPlaybackElapsed;
    const readSoundingElapsed = useCallback(() => {
      const ms = readPlaybackElapsed();
      return ms === null ? null : soundingOffsetRef.current + ms;
    }, [readPlaybackElapsed]);

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
        // Frozen during playback too. For a record-mode play (and a "line"/"whole"
        // audition) the canvas is showing the whole-clip view, so a drag would move
        // the hidden record `pan`/insert offset the translator cannot see, and the
        // viewport would jump when playback stops (Frank/George R2). An audition of
        // a PICKED SPAN draws through this same pan window (#284), so there the
        // freeze is holding the band still over the audio it marks while it sounds.
        // Either way, playback is listen-only — no scrub in v1 (D4).
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
      // Record-mode playback always sounds a buffer from its own frame 0 — the
      // whole working buffer, or a whole paused-take preview — so the playhead
      // needs no offset into the drawn waveform (#284). Pinned once here rather
      // than at each of the three `playBuffer` calls below, one of which fires
      // after an await.
      soundingOffsetRef.current = 0;
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
          const buffer = mergeTake(
            editor.working,
            pcm,
            insertionOffset.current
          );
          const peaks =
            buffer.length > 0
              ? computePeaks(buffer, PREVIEW_PEAK_BUCKETS)
              : null;
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

    /**
     * Edit-mode Play — the audition (#284).
     *
     * The first external tester, cold, tried to play a highlighted part of a
     * segment before deleting it, found no way to, and fell back to memorising
     * the shape of the waveform. That fallback is all a translator who cannot
     * read would have had either, on a cut they cannot undo once the sheet
     * closes. So a selection sounds ONLY the selection — the exact samples the
     * scissors would remove, `auditionPlan` sharing `cut`'s normalisation — and
     * with nothing picked it sounds the working buffer from the centerline on,
     * which is the record-mode preview when the line is resting.
     *
     * The range is sounded as a `subarray` — a VIEW, not a copy: the audition
     * allocates nothing, so it cannot be the OOM a cut of the same span can be
     * on a low-memory phone. (`playBuffer`'s own Int16→Float32 conversion is the
     * one allocation, it is no larger than the record-mode Play already makes,
     * and it is already inside that path's guard.)
     *
     * Tapping while it sounds stops it, through the same `stopBuffer` every
     * other control in this sheet uses — there is one stop path, and every edit
     * action below calls it before changing the buffer or the span beneath it.
     */
    const onAuditionButton = useCallback(() => {
      // Guard the close window like the other transport handlers: a tap racing
      // `close()` before `isClosing` disables the button must not start a sound
      // over the commit.
      if (closing.current) return;
      if (audio.playingBuffer) {
        audio.stopBuffer();
        return;
      }
      if (!idleEditable || !audition) return;
      // Pinned BEFORE the play, so the playhead is offset by the range that is
      // actually sounding rather than by whatever the selection becomes next.
      soundingOffsetRef.current = framesToMs(audition.range.start);
      audio.playBuffer(
        editor.working.subarray(audition.range.start, audition.range.end)
      );
    }, [audio, audition, editor.working, idleEditable]);

    // Enter edit mode from the record menu. Play is a record-only control, so any
    // live buffer playback is stopped first — else it would orphan itself with no
    // control to stop it.
    //
    // With a live or paused take in hand this COMMITS it first (#134): editing
    // works on `view.samples`, and an in-progress take is not there yet (Model A),
    // so it is persisted through the same stop → decode → save `close()` runs on
    // Back — minus the exit — then the segment is reopened at idle on the committed
    // audio and edit mode entered. Without this the enabled row would drop the
    // translator into edit mode over the STALE stored clip, editing the wrong audio
    // — the leak the old idle-only gate prevented and the reason the fix cannot
    // live in the view alone.
    const onEnterEdit = useCallback(() => {
      // Stop any buffer playback (Play is record-only) and, on the no-take path,
      // invalidate any in-flight preview decode — Edit is a record-menu action,
      // the same boundary `openMenu` and a record tap clean up.
      audio.stopBuffer();
      setMenuOpen(false);
      // No live/paused take: edit the stored/edited working buffer as before (#89).
      // The gate only offers Edit with a take while recording or paused, so nothing
      // else reaches the commit branch below.
      if (!(recording || paused)) {
        cancelPreview();
        setMode("edit");
        return;
      }
      // A live or paused take: commit it, then reopen in edit mode on the committed
      // audio. `closing.current` is the shared "a commit is in flight" latch, so a
      // Back tapped during this cannot double-commit the same take.
      if (closing.current) return;
      closing.current = true;
      setIsClosing(true);
      // Abort any in-flight preview decode, then drop the preview's PCM but keep its
      // peaks on stage through the commit — exactly the pair `close()` runs, so a
      // first take does not blank while it saves.
      abortPreview();
      setPreview((p) =>
        p ? { buffer: new Int16Array(0), peaks: p.peaks } : p
      );
      void (async () => {
        const result = await audio.stopRecording();
        if (result.samples && result.samples.length > 0) {
          // Splice the take into the WORKING buffer at the locked offset, exactly
          // as `close()` does; the mark rides the take through `addTake`. UNLIKE
          // `close()`, whose next step is always onExit, this path means to STAY
          // and open edit mode — so it MUST branch on saveRecording's boolean.
          // A quota/IDB failure returns false and turns into App's recovery screen,
          // which early-returns SaveFailed and unmounts this sheet; if we ignored
          // the boolean and entered edit mode, App's `recorder` state would stay set
          // under that screen and a Discard/Retry would REMOUNT the sheet instead of
          // returning to Segments — the recovery post-condition (`recorder === null`)
          // broken (George R1 P2). The held take carries the samples and the mark;
          // retry/discard live on the recovery screen, not here.
          const saved = await saveRecording(
            segmentId,
            editor.working,
            result.samples,
            insertionOffset.current,
            finishedIntent === true
          );
          dirty.current = true;
          if (!saved) {
            // Take the SAME exit `close()`'s capture path takes: it always reaches
            // `onExit(dirty)` after the save (`commitPendingAndExit` with
            // `committed`), so App clears `recorder` and the recovery screen owns
            // the body with nothing mounted behind it. Do NOT enter edit mode.
            onExit(dirty.current);
            return;
          }
          // The take — with its mark, `finishedIntent === true` above — is now on
          // disk. Reset the session's finished intent so the reopened sheet matches a
          // real close-and-reopen (a remount resets it to null): a subsequent in-sheet
          // re-record or edit then demotes "unless re-marked" exactly as it would
          // after a remount, rather than silently carrying THIS mark onto changed
          // audio (George R3 P2 #2). Only on SUCCESS — the !saved / blob / error arms
          // keep the intent so the held take and the recovery screen still carry the
          // mark. The checkbox does not flip: `displayedFinished` falls back to the
          // just-saved `view.finished` (true) until an edit sets `pendingDemote`.
          // (Confirmed by Tim 2026-09-09: "Re-record should drop to draft until
          // finished is manually chosen again.")
          setFinishedIntent(null);
          // Re-read the segment and AWAIT the fresh view, so the editor re-bases on
          // the committed samples (`useSegmentEditor` resets when `view.samples`
          // changes) BEFORE edit mode opens — the mode switch below then batches
          // with the new view in one render, with no window where edit mode is live
          // over the pre-take buffer. Awaited in this handler, not an effect, to
          // stay clear of set-state-in-effect.
          const next = await reloadView();
          closing.current = false;
          setIsClosing(false);
          if (!next) {
            // The commit SUCCEEDED but the reopen's reload threw (`setView(null)`).
            // Do NOT stay on the resulting LoadErrorPanel: for a never-recorded
            // segment the editor does not rebase — its base is the `EMPTY` singleton,
            // so `setView(null)` is a no-op reset (`use-segment-editor.ts:99,113`) —
            // and a pending paste's stale `working` survives. LoadErrorPanel's Back
            // then runs `close()`'s edit-only save and OVERWRITES the take just
            // committed (George R5, data loss). The take is on disk, so exit to
            // Segments exactly as the `!saved` arm does.
            onExit(dirty.current);
            return;
          }
          setMode("edit");
          return;
        }
        // No usable audio. Mirror close()'s precedence exactly (:1063): a decode
        // failure whose captured bytes survived (#165/#106) is the take's ONLY
        // copy — HOLD it and hand the body to the recovery panel, checked BEFORE
        // the plain error Notice so a superseded stop (blob kept, error withheld)
        // cannot fall through and silently drop it. Only an empty/silent capture
        // (blob-less, error set) stays in record mode to retry. Either way, do NOT
        // enter edit mode.
        if (result.blob) {
          // The decode FAILED (or a leave() superseded the stop) but the bytes are
          // the only copy of the take — exactly close()'s :1063 branch. Route to the
          // recovery panel (re-decode on a fresh gesture, or share off-phone); do
          // NOT onExit and do NOT enter edit mode. Retry/discard/share live there.
          // Unlike close()'s identical branch, mark this recovery as Edit-initiated
          // so a successful Try again reaches edit mode instead of exiting to
          // Segments — the take was committed to be EDITED (#134), and the recovery
          // is a detour, not a Back (George R3 P2 #1).
          setHeldTake(result.blob);
          enterEditAfterRecover.current = true;
          setHeldShareError(null);
          setHeldRetryError(null);
          setHeldShared(false);
          cancelPreview();
          closing.current = false;
          setIsClosing(false);
          return;
        }
        if (result.error) {
          setStopError(result.error);
          cancelPreview();
        }
        closing.current = false;
        setIsClosing(false);
      })().catch((cause: unknown) => {
        // Last net (mirror close() :1110): neither stopRecording nor saveRecording
        // rejects by contract, but were one ever to reject after the `closing` latch
        // was set, the latch would stick and Back/Record/Play/menu would all refuse
        // with no recovery panel. Exit as close() does so the sheet unmounts and the
        // latch releases; the recovery slot carries anything a failed commit held.
        console.error("Committing the recording to enter edit failed", cause);
        onExit(dirty.current);
      });
    }, [
      audio,
      recording,
      paused,
      saveRecording,
      segmentId,
      editor,
      finishedIntent,
      reloadView,
      abortPreview,
      cancelPreview,
      onExit,
    ]);

    // The permission panel's Retry. It bypasses `onRecordButton`, so it must force
    // record mode itself: Edit is reachable while the panel is up (empty segment +
    // full clipboard), and a Retry from there would otherwise start the mic with
    // the edit toolbar on screen and no Record/Pause/VU — "Editing" over a live
    // capture (George R3). Any path that starts the mic belongs in record mode.
    const onRetryRecord = useCallback(() => {
      setMode("record");
      // Drop any latched `menuOpen`. The menu is already HIDDEN while `denied`
      // (`menuShown`), but the raw flag survives, so a Retry that succeeds would
      // otherwise pop the drawer back up over a live recorder — a menu the
      // translator never re-opened (George, round 4).
      setMenuOpen(false);
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
      // Silence an audition on the way out (#284). Record mode's Play is the
      // whole-buffer preview and its own control would stop it, but the two are
      // different sounds over different views: leaving edit mode mid-audition
      // would drop the translator into the record bar with a selection's worth
      // of audio still playing and the Play glyph showing a stop for a sound the
      // mode no longer explains. This is also what makes "a record never starts
      // over an audition" true — every route from edit to record passes here, and
      // record-mode Record is already disabled while a buffer sounds.
      audio.stopBuffer();
      editor.closeSelection();
      setZoom(ZOOM_WHOLE);
      setMode("record");
      setMenuOpen(false);
    }, [audio, editor]);

    // Every edit action stops an audition first (#284), through the ONE stop path
    // the sheet already uses (`stopBuffer`, a no-op when nothing is sounding).
    // The reason is not tidiness: a cut, a paste, an undo or a redo
    // rematerialises `working`, and the sounding view is a window onto the buffer
    // as it was — audio the segment no longer contains, under a waveform that has
    // already changed shape, with a playhead travelling over samples that moved.
    // Moving the span the audition was OF is the same class.
    const onToggleSelection = useCallback(() => {
      audio.stopBuffer();
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
    }, [audio, editor, win.centerlineSample, win.visibleSamples]);

    // A handle drag moves the span the audition is OF, so it silences it too.
    // `stopBuffer` returns immediately when nothing is sounding, so this costs a
    // predicate per pointermove, not a stop.
    const onSelectionChange = useCallback(
      (range: SampleRange) => {
        audio.stopBuffer();
        editor.setSelection(range);
      },
      [audio, editor]
    );

    const onUndo = useCallback(() => {
      audio.stopBuffer();
      editor.undo();
    }, [audio, editor]);

    const onRedo = useCallback(() => {
      audio.stopBuffer();
      editor.redo();
    }, [audio, editor]);

    const onCut = useCallback(() => {
      audio.stopBuffer();
      const removed = editor.cut();
      // Keep the centerline on the same audio: a cut before it shortens the buffer
      // to its left, so shift an absolute pan by what was removed (George R5). A
      // null/resting pan already follows the new end.
      if (removed !== null) {
        setPanState((p) => (p === null ? null : panAfterCut(p, removed)));
      }
    }, [audio, editor]);

    const onPaste = useCallback(() => {
      audio.stopBuffer();
      editor.paste(win.centerlineSample);
    }, [audio, editor, win.centerlineSample]);

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

    // The no-capture commit tail, shared by `close()` (when nothing was captured)
    // and `leaveHeldTake` (the recovery-panel exit). ONE path for both halves of
    // the session work an exit still owes — a pending B5 edit AND a pending
    // Finished toggle — so a recovery exit can never drop one of them again (the
    // root of the class George raised as R2 B-4, the edits half, and R4-G1, the
    // flag half; Seth's round-5 direction). `committed`/`attemptedCapture` are
    // threaded from the caller so the same `!committed && !attemptedCapture` gates
    // hold; returns whether it exited (false keeps the sheet open on a write
    // failure, with the reason in place).
    const commitPendingAndExit = useCallback(
      async (
        committed: boolean,
        attemptedCapture: boolean
      ): Promise<boolean> => {
        try {
          // An edit-only close (B5): cuts/pastes with no take committed. Gated on
          // `!attemptedCapture` so a superseded capture stop abandons the session
          // like B4 — persisting or clearing there is the George-R5 loss.
          if (!committed && !attemptedCapture && editor.hasEdits) {
            if (editor.workingLength === 0) {
              // Cut down to nothing clears the take (no 0-frame ghost). A failed
              // clear must keep the sheet open with an in-place error — closing as
              // if the erase happened would leave the original on disk under a UI
              // that says it is gone. Same shape as the finished-flag write below.
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
                return false;
              }
            } else {
              // A non-empty edit replaces the audio through the same never-lose
              // machinery a recording uses (owned slot → App recovery on failure),
              // so its boolean is not branched on here. It demotes an approved
              // segment to draft unless re-marked, and the mark rides the write.
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
              // The store rejects a finished mark on a segment with no take — a
              // take deleted externally between toggle and close. Surface it
              // (F5-#1) rather than only the console, and stay open.
              console.error("Could not change the finished flag", cause);
              setStopError(strings.finishedWriteFailed);
              cancelPreview();
              closing.current = false;
              setIsClosing(false);
              return false;
            }
          }
          onExit(dirty.current);
          return true;
        } catch (cause) {
          // Last net — neither save rejects by contract, but a rejection here would
          // cost a recording; exit rather than strand the sheet (the recovery slot
          // carries anything a failed commit held).
          console.error("Committing the recording on close failed", cause);
          onExit(dirty.current);
          return true;
        }
      },
      [
        editor,
        saveEditedSegment,
        segmentId,
        finishedIntent,
        view,
        setFinished,
        cancelPreview,
        onExit,
      ]
    );

    const close = useCallback((): Promise<boolean> => {
      // Resolves true when the sheet actually exits (`onExit` fired), false when a
      // commit failure keeps it open with an in-place error. App's history routing
      // (#168) reads that: a Back gesture that fails to save must NOT leave the
      // recorder's history entry consumed — it re-arms the trap so the next Back
      // retries rather than escaping to Segments over an unsaved take.
      if (closing.current) return Promise.resolve(false);
      // The decode-failed recovery panel owns the body (#165): its Try again /
      // Share / two-tap discard are the only exits, and the header Back is disabled
      // while it is up. A system Back still reaches close() through the imperative
      // handle (#168 / George R2 G1), so refuse it here too — committing would run
      // the idle-close path and drop the held take, the only copy. The panel's own
      // actions are the way out. (Merge of #258 held-take + #168 system Back.)
      if (heldTake !== null) return Promise.resolve(false);
      // A system Back reaches close() through the imperative handle even while an
      // overlay is up — the sheet's `inert` blocks the on-screen Back but not the
      // ref call (George R2 G1). When the ≡ menu or the erase-confirm owns the
      // screen, the Back must dismiss IT and stay, never commit over an in-flight
      // erase (the R-B6 last-writer race) or a menu selection. Resolve false so
      // App keeps the sheet's protective history entry and the sheet itself.
      if (overlayBlocksClose(menuOpen, confirmOpen, erase.erasing)) {
        // Dismiss the overlay the Back landed on — but NOT the erase-confirm while
        // its delete is in flight (Frank R4-1): clearing `confirmOpen` mid-erase
        // un-inerts the sheet (its `inert` is driven by `confirmOpen`), exposing
        // Record, whose new capture the erase's `onExit` then discards. Let the
        // erase's own completion tear the confirm down.
        const dismiss = overlayDismissal(menuOpen, confirmOpen, erase.erasing);
        if (dismiss.closeMenu) setMenuOpen(false);
        if (dismiss.closeConfirm) setConfirmOpen(false);
        return Promise.resolve(false);
      }
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
      // (George R1). `stopBuffer` releases its own "take" floor and, when the
      // recorder is paused, hands the floor back to the still-open mic
      // (`reclaimAfterPreview`, #129) — it never ENDS a capture, which is the
      // property that makes it safe ahead of the `stopRecording` commit path:
      // `claim("mic")` moves the floor, it does not touch the MediaRecorder, and
      // `stopRecording`'s `finally` stops whichever claim is current (George G4).
      audio.stopBuffer();
      return (async () => {
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
          } else if (result.blob) {
            // The decode FAILED but the captured bytes survive (#165) — the take
            // exists only here. Hold them and hand the body to the recovery panel
            // (re-decode on a fresh gesture, or share the bytes off the phone),
            // never a bare Notice that drops the only copy. Checked BEFORE
            // `result.error` so a SUPERSEDED stop — a leave()/pagehide bumped the
            // generation mid-decode, so `error` is withheld but `blob` is now kept
            // (George R1 G2) — holds its bytes instead of falling through to the
            // silent close below. That interruption is the #106 case #165 exists to
            // recover, and it was the one this panel never appeared on. Do NOT
            // onExit: leave() would close silently on a take that cannot be recorded
            // again. An empty or silent capture carries no blob and falls to the
            // Notice below.
            setHeldTake(result.blob);
            // A Back-initiated recovery exits to Segments on a successful retry — the
            // opposite of onEnterEdit's. Stamp the discriminator false so a stale true
            // from an earlier Edit-commit recovery cannot redirect this one into edit
            // mode (George R3 P2 #1).
            enterEditAfterRecover.current = false;
            setHeldShareError(null);
            setHeldRetryError(null);
            setHeldShared(false);
            // Reopening idle: drop the kept preview so the stage reverts to
            // `working` rather than a whole-clip preview with no insert line
            // (George R4 #1).
            cancelPreview();
            closing.current = false;
            setIsClosing(false);
            return false;
          } else if (result.error) {
            // The stop yielded no usable audio, no bytes worth keeping, AND has
            // something to say — an empty or silent capture. Its cause travels WITH
            // the result, not the async `error` state a render closure here would
            // read one frame stale (the round-4 regression that reopened the
            // permission panel). A toolbar Notice (not the permission panel — this
            // is not a permission miss), and re-enable so Back or Record works. Do
            // NOT onExit.
            setStopError(result.error);
            cancelPreview();
            closing.current = false;
            setIsClosing(false);
            return false;
          }
          // else: no samples, no bytes, and no error — a superseded stop whose
          // capture yielded nothing to keep (a cancel/leave landed during it).
          // Nothing to save and nothing to say, so fall through and close, rather
          // than dead-ending the sheet open (#59). An empty capture is NOT this
          // branch — it returns the "No sound" error above and stays open to retry.
        }
        // Persist any pending edit and Finished flag, then exit — the shared
        // no-capture tail (`leaveHeldTake` runs the SAME one, George R4-G1 root).
        return commitPendingAndExit(committed, attemptedCapture);
      })().catch((cause: unknown) => {
        // Neither call rejects by contract; this is the last net on the one path
        // where a failure would cost a recording that cannot be made again.
        console.error("Committing the recording on close failed", cause);
        onExit(dirty.current);
        // The sheet still exits — `onExit` ran — so a Back gesture is satisfied and
        // must not re-arm; the recovery slot carries anything the failed commit held.
        return true;
      });
    }, [
      recording,
      paused,
      state,
      audio,
      saveRecording,
      editor,
      segmentId,
      onExit,
      finishedIntent,
      abortPreview,
      cancelPreview,
      commitPendingAndExit,
      menuOpen,
      confirmOpen,
      erase.erasing,
      heldTake,
    ]);

    // The only handle App holds on the sheet: a system Back routes here (#168) and
    // runs the same commit path the on-screen Back does.
    useImperativeHandle(ref, () => ({ requestClose: close }), [close]);

    // Recovery for a take whose decode failed on Stop (#165). Re-decode the held
    // container bytes on THIS tap — `retryDecode` resumes the shared context first,
    // the one moment iOS un-interrupts it (#106), the likeliest cause. On success
    // the take commits through the same never-lose path a normal close uses and the
    // sheet closes; on failure the bytes stay held and the panel says why.
    const retryHeldTake = useCallback(() => {
      const blob = heldTake;
      // Synchronous latch FIRST (Frank F3 / George G3): the render-state
      // `heldRetrying` only hides Try again once the busy re-render lands, so two
      // taps in one frame both read it false and each mint a fresh clip through
      // `saveRecording`, orphaning one. Refuse also while a re-decode OR a share is
      // in flight (George R3 G-2): a Try again tapped before the share sheet paints
      // would re-decode while the OS sheet interrupts the context, and a silent
      // result there could then lose the take. The ref answers for this instant.
      if (!blob || heldRetryingRef.current || heldSharingRef.current) return;
      heldRetryingRef.current = true;
      setHeldRetrying(true);
      setHeldRetryError(null);
      void (async () => {
        try {
          const result = await audio.retryDecode(blob);
          if (result.samples && result.samples.length > 0) {
            const saved = await saveRecording(
              segmentId,
              editor.working,
              result.samples,
              insertionOffset.current,
              finishedIntent === true
            );
            dirty.current = true;
            if (enterEditAfterRecover.current) {
              // Edit-initiated recovery (#134): this branch owes App and the recorder
              // the SAME three post-conditions onEnterEdit's success arm has, and a
              // bare onExit is not enough. Mirror it faithfully (Frank R4 F1/F2,
              // George R4 #1/#2/#3):
              enterEditAfterRecover.current = false;
              // (1) Branch on saveRecording's boolean. A quota/IDB failure returns
              // false and becomes App's SaveFailed, which unmounts this sheet; enter
              // edit mode and App's `recorder` stays set under it, so a Discard/Retry
              // REMOUNTS the sheet instead of returning to Segments (George R1 P2, the
              // post-condition onEnterEdit protects at its success arm). Exit instead.
              if (!saved) {
                setHeldTake(null);
                setHeldRetrying(false);
                heldRetryingRef.current = false;
                onExit(dirty.current);
                return;
              }
              // (2) Reset the session mark so the reopened sheet matches a remount —
              // a later in-sheet edit/re-record then demotes "unless re-marked"
              // (George R4 #3 / R3 P2 #2). (3) KEEP the recovery panel mounted
              // (`heldTake` still owns the body, `heldRetrying` still true) ACROSS the
              // reload: dropping it here paints the record-mode hero over the still
              // pre-take `working` buffer, and a Record or punch-in Erase in that
              // window 1:1-replaces the take just recovered (George R4 #1, a data-loss
              // race). Swap panel → edit mode in ONE batched render after the reload.
              setFinishedIntent(null);
              const next = await reloadView();
              setHeldTake(null);
              setHeldRetrying(false);
              heldRetryingRef.current = false;
              if (!next) {
                // Same reload-null hazard as onEnterEdit's success arm (George R5):
                // the editor does not rebase for a never-recorded segment, so a
                // pending paste's stale `working` would let LoadErrorPanel's Back
                // overwrite the take just committed. The take is on disk — exit to
                // Segments rather than leave the stale editor behind the panel.
                onExit(dirty.current);
                return;
              }
              setMode("edit");
              return;
            }
            // Back-initiated recovery: unchanged. The committed take (its mark carried
            // by saveRecording) exits to Segments; a save failure still lands on App's
            // SaveFailed via onExit clearing `recorder` (parity with the pre-#134
            // behaviour George R3 accepted — the boolean is not branched here).
            setHeldTake(null);
            setHeldRetrying(false);
            heldRetryingRef.current = false;
            onExit(true);
            return;
          }
          // The re-decode produced no usable audio — a throw OR a zero-sample
          // decode. On the RETRY path a zero-sample decode is NOT proven silence
          // (the bytes are held only because the FIRST decode threw), so NEVER drop
          // the held take here — that would lose the only copy (George R3 G-1). Keep
          // the bytes and the panel and say why UNDER Try again (George R1 G6);
          // Share and the two-tap discard are the exits that keep this from
          // trapping (the concern G5 raised, now met without dropping the take).
          setHeldRetrying(false);
          heldRetryingRef.current = false;
          setHeldRetryError(result.error);
        } catch (cause: unknown) {
          // saveRecording is contracted never to reject; this is the last net so a
          // thrown save cannot strand the panel busy with the take still held. A
          // save failure is not a share failure (George R1 G6).
          console.error("Saving the recovered recording failed", cause);
          setHeldRetrying(false);
          heldRetryingRef.current = false;
          setHeldRetryError(strings.takeRetryFailed);
        }
      })();
    }, [
      heldTake,
      audio,
      saveRecording,
      segmentId,
      editor,
      finishedIntent,
      reloadView,
      onExit,
    ]);

    // The last-resort escape: hand the raw container bytes to the OS share sheet so
    // the recording leaves the phone in some form rather than none (#165). Called
    // synchronously in the tap — `navigator.share` needs the gesture's activation,
    // so the File is built and shared with no await before it.
    const shareHeldTake = useCallback(() => {
      const blob = heldTake;
      // Ignore a Share tap while a re-decode is in flight (George R1 G7): the retry
      // just resumed the shared AudioContext, and opening the OS share sheet can
      // re-interrupt it. The panel also disables Share while `heldRetrying`; this is
      // the synchronous backstop. `heldSharingRef` additionally refuses a
      // same-gesture double-tap before the OS sheet paints, whose second
      // `navigator.share` would be classified `failed` and paint an error beside the
      // first's success (George R2 B-6).
      if (!blob || heldRetryingRef.current || heldSharingRef.current) return;
      setHeldShareError(null);
      // Strip the codec parameters off the capture MIME (George R1 G4): iOS records
      // `audio/mp4;codecs=mp4a.40.2`, and a parameterised type can make
      // `canShare({files})` return false on the one platform that reaches this
      // panel. Share the bare container family instead.
      const container = blob.type.includes("mp4")
        ? { ext: "m4a", type: "audio/mp4" }
        : blob.type.includes("aac")
          ? // A real `CANDIDATE_MIME_TYPES` entry (George R3 G-4): without this an
            // aac capture fell to `application/octet-stream`, which `canShare` often
            // refuses on the very iOS path that reaches this panel to rescue bytes.
            { ext: "aac", type: "audio/aac" }
          : blob.type.includes("webm")
            ? { ext: "webm", type: "audio/webm" }
            : blob.type.includes("ogg")
              ? { ext: "ogg", type: "audio/ogg" }
              : blob.type.includes("mpeg") || blob.type.includes("mp3")
                ? { ext: "mp3", type: "audio/mpeg" }
                : { ext: "audio", type: "application/octet-stream" };
      const file = new File([blob], `recording.${container.ext}`, {
        type: container.type,
      });
      if (
        typeof navigator.share !== "function" ||
        (typeof navigator.canShare === "function" &&
          !navigator.canShare({ files: [file] }))
      ) {
        setHeldShareError(strings.takeShareUnavailable);
        return;
      }
      // Whether activation is live at the call decides how a NotAllowedError reads
      // (see `classifyShareError`). Read it immediately before `share`.
      const hadActivation = navigator.userActivation?.isActive ?? false;
      // Latched synchronously here, before the async `share`. The render state
      // disables Try again while the sheet is up (George R3 G-2). Both cleared in
      // both settle arms.
      heldSharingRef.current = true;
      setHeldSharing(true);
      void navigator.share({ files: [file] }).then(
        () => {
          heldSharingRef.current = false;
          setHeldSharing(false);
          // Rescued off the phone. Offer a Done exit even though the decode never
          // succeeded (George R1 G1 / Frank F2): the app is no longer a dead end.
          setHeldShared(true);
          setHeldShareError(null);
        },
        (cause: unknown) => {
          heldSharingRef.current = false;
          setHeldSharing(false);
          // Reuse the chapter-share classifier (George R1 G4): a user dismiss
          // (`AbortError`) and a spent-activation `NotAllowedError` (`retry`) are
          // not failures to alarm the translator with. Only a standing refusal is a
          // real error.
          const outcome = classifyShareError(cause, hadActivation);
          if (outcome === "dismissed" || outcome === "retry") return;
          console.error("Could not share the recovered recording", cause);
          setHeldShareError(strings.takeShareFailed);
        }
      );
    }, [heldTake]);

    // Leave the recovery panel (George R1 G1 / Frank F2). The panel was otherwise a
    // dead end when the decode never succeeds — the disabled header Back kept a
    // SILENT Back from dropping the only copy, but left no honest exit at all. Two
    // gestures reach here, gated so neither is a stray drop: the Done exit only
    // after a Share SUCCEEDED (bytes off the phone, nothing lost), and the two-tap
    // ARMED discard (a confirmed, deliberate loss, the SaveFailed shape). The retry
    // guard blocks the window a re-decode is mid-flight.
    const leaveHeldTake = useCallback(() => {
      // The synchronous double-close latch, mirroring `close()` — a second tap
      // during the commit must not run the tail twice.
      if (heldRetryingRef.current || closing.current) return;
      // Drop the failed-decode take, then run the SAME no-capture tail `close()`
      // runs (Seth's round-5 root fix for R4-G1). It commits BOTH halves the exit
      // still owes — a pending B5 edit AND a pending Finished toggle — then exits;
      // on a write failure it keeps the sheet open with the reason, revealing the
      // idle recorder (`heldTake === null`). One path, so a recovery exit can never
      // drop one half again (B-4 was the edits half, R4-G1 the flag half). NOT a
      // call to `close()` — that would re-enter its capture/overlay/held-take
      // machinery; this is the tail alone.
      setHeldTake(null);
      // The discarded take carried whatever entry set it; clear the Edit-origin latch
      // so it cannot leak into a later Back-initiated recovery (George R3 P2 #1).
      enterEditAfterRecover.current = false;
      closing.current = true;
      setIsClosing(true);
      void commitPendingAndExit(false, false);
    }, [commitPendingAndExit]);

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

    // The ≡-menu rows' disabled REASONS (#135). Each row's `disabled` is
    // `reason !== null`, so the cue that explains a grey row and the gate that
    // greys it are one derivation, not two switches. Erase still spells
    // `!idleEditable` as `!view || takeActive`; Edit no longer does — since #134 a
    // live/paused take reaches Edit (it commits first), so Edit's `takeActive`
    // input is split into `committing` (the real commit window) and `hasTake`.
    const starting = state === "requesting";
    const editReason = editRowReason({
      hasView: view !== null,
      // A recording/paused take no longer blocks Edit (#134) — entering Edit
      // commits it first (`onEnterEdit`). Only the actual commit window does: the
      // Back-tapped close, and a #59 interruption's `processing` freeze.
      committing: isClosing || state === "processing",
      hasTake: recording || paused,
      starting,
      denied,
      hasAudio,
      canPaste: editor.canPaste,
    });
    const eraseReason = eraseRowReason({
      hasView: view !== null,
      takeActive,
      starting,
      hasClip: view?.hasClip ?? false,
    });

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

    // The Mark-finished row's reason (#135 round 3). Narrower than the Edit/Erase
    // gate on purpose: Mark stays live while recording or paused, because the mark
    // rides the take through `addTake` (G8/G10) — only the commit window freezes it.
    // The ≡ menu is NEVER up while the permission panel owns the body. The opener
    // is disabled on `denied`, but that only blocks OPENING: `denied` can turn on
    // while the menu is already up — Record, ≡, then `getUserMedia` rejects — and
    // nothing dismissed it. That left the panel (and its Retry) inert behind the
    // scrim, with Edit greyed and no reason and Mark naming the wrong blocker, on
    // exactly the screen #135 exists to fix (George, round 4). Deriving the menu's
    // open state kills the frame rather than reacting a frame later, and the effect
    // `onRetryRecord` drops the latch, so a Retry that succeeds cannot resurrect a
    // drawer the translator never re-opened.
    const menuShown = menuOpen && !denied;

    const markReason = markRowReason({
      hasView: view !== null,
      takeCommitting: isClosing || busy,
      starting,
      canFinish: finishedState !== "disabled",
    });

    return (
      <div className="recorder-scrim" role="dialog" aria-modal="true">
        {/* `inert` the sheet while the menu is open. Nested aria-modal dialogs do
          not reliably hide the background for AT/switch users — G8 already
          refused to trust that on the Segments list — so without this an AT user
          could reach the covered Record while the menu is up and mutate the
          splice base under a Redo (George R4). `erase.erasing` is folded in
          alongside `confirmOpen` so the sheet stays inert across the whole erase
          even if the confirm flag is cleared out from under it — Record must never
          be tappable while a delete runs (Frank R4-1). */}
        <div
          ref={sheetRef}
          className="recorder-sheet mx-auto max-w-md"
          inert={menuShown || confirmOpen || erase.erasing || undefined}
        >
          <header className="flex items-center gap-[8px] px-[4px] py-[2px]">
            <Control
              icon="back"
              label={strings.closeRecorder}
              variant="quiet"
              // Disabled while a decode-failed take is held (#165): the bytes exist
              // only in `heldTake`, so a Back here would be the exact loss this
              // recovery exists to prevent. The panel's Try again / Share / two-tap
              // discard are the only ways out until the take is recovered or rescued.
              // (The system Back is refused in `close()` for the same reason.)
              disabled={heldTake !== null}
              onClick={onRequestBack}
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
                // Also closed while a take is held (#165): the recovery panel owns
                // the body, and opening the menu would inert the sheet over it.
                disabled={!view || isClosing || denied || heldTake !== null}
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

          {heldTake ? (
            // A take whose decode FAILED on Stop, held as raw bytes (#165). Takes
            // priority over every other body state: the recording exists only here,
            // so recovering it is the most urgent thing on screen. Try again
            // re-decodes on this gesture; Share rescues the bytes off the phone; a
            // two-tap discard or a post-share Done are the exits (the header Back is
            // disabled while this holds).
            <SaveDecodeFailedPanel
              retrying={heldRetrying}
              sharing={heldSharing}
              retryError={heldRetryError}
              shareError={heldShareError}
              shared={heldShared}
              onRetry={retryHeldTake}
              onShare={shareHeldTake}
              onDiscard={leaveHeldTake}
              onDone={leaveHeldTake}
            />
          ) : loadError ? (
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
              onBack={onRequestBack}
            />
          ) : denied ? (
            <PermissionPanel
              message={audio.error}
              onRetry={onRetryRecord}
              onBack={onRequestBack}
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
              {(() => {
                // #39: the commit window used to draw no status — no dot, no
                // timer, no copy — so the stop → decode → save wait (and a #59
                // interruption's frozen take) read as a dead app. The exit (header
                // Back) was always there; the status was the missing half. The
                // gate spans `isClosing`, not just `processing`, because state
                // flips to idle mid-save (Frank/George R1); it lives in the pure
                // `recorderStatusKind` so the predicate is tested, not just the
                // wording. As a `Notice` each carries the glyph a non-reader needs
                // and its own `role`, so there is no hand-rolled `aria-busy` to
                // leave stuck; the tone each takes is documented at its branch below.
                const status = recorderStatusKind(state, isClosing);
                if (!status) return null;
                return (
                  <div className="px-[12px] pt-[8px]">
                    {status === "saving" ? (
                      <Notice tone="busy">{strings.recorderSaving}</Notice>
                    ) : (
                      // `info` (#140/#112): a heads-up about something already done
                      // — full ink, its own glyph, `role="status"`. NOT `alert`
                      // (nothing failed; the recording is safe) and NOT `busy` (it
                      // is not a wait — the take is finished, waiting only on the
                      // Close it names). Exactly the tone `info` was added for.
                      <Notice tone="info">{strings.recorderInterrupted}</Notice>
                    )}
                  </div>
                );
              })()}
              <div className="recorder-stage flex-1">
                <div
                  ref={stageRef}
                  className="recorder-canvas"
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                >
                  {(recording ||
                    paused ||
                    state === "processing" ||
                    isClosing) &&
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
                      peekScope={audio.peekScope}
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
                    readElapsedMs={readSoundingElapsed}
                    active={audio.playingBuffer}
                    durationMs={drawnDurationMs}
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
                        onChange={onSelectionChange}
                        startLabel={strings.selectionStartHandle}
                        endLabel={strings.selectionEndHandle}
                      />
                    )}
                  {mode === "edit" &&
                    idleEditable &&
                    editor.canPaste &&
                    !editor.selectionActive &&
                    !audio.playingBuffer && (
                      // The paste marker rides the centerline (mockup 5): tapping it
                      // inserts the clipboard there. stopPropagation so the tap does
                      // not also arm a pan on the stage beneath it.
                      //
                      // Gone while a buffer sounds (#284), for the reason Record is
                      // already dead there: this marker is at a FIXED 50% of the
                      // stage because it rides the centerline of the pan/zoom
                      // window, but a "line"/"whole" audition takes the whole-clip
                      // view — the canvas redraws 0..1 and `playing` suppresses the
                      // centerline under it — while `onPaste` still inserts at
                      // `win.centerlineSample`. At the F7 rest the marker would sit
                      // over the midpoint and paste at the END: a control pointing
                      // at one sample and acting on another, in a UI for people who
                      // cannot read. Removing it, rather than disabling it, also
                      // takes away the false position; Play is one tap from
                      // bringing it back. (The selection band, its sibling through
                      // `win`, is kept honest instead by an audition of a picked
                      // span not swapping the view at all.)
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
                    // Per-frame trust signal (#76): a wired tap whose context goes
                    // suspended/interrupted mid-take reads zeros, so the strip
                    // hatches "unavailable" rather than resting empty (a dead-mic
                    // misread). Recovers to animating when the context resumes.
                    readAvailable={audio.readMeterAvailable}
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
                    // The audition (#284) — the SAME glyph pair the record bar
                    // uses, play/pause, because it is the same act: a non-reader
                    // recognises the control by its shape, and a second play
                    // glyph would be a second thing to learn. The name is what
                    // differs, and it names the target (`auditionPlan`'s
                    // `source`) so what a screen reader speaks is what sounds.
                    icon={audio.playingBuffer ? "pause" : "play"}
                    label={
                      audio.playingBuffer
                        ? strings.stopPlayback
                        : audition?.source === "selection"
                          ? strings.auditionSelection
                          : audition?.source === "line"
                            ? strings.auditionFromLine
                            : strings.playRecording
                    }
                    variant="quiet"
                    size={24}
                    // Inert when there is nothing to hear — no audio, or a span
                    // dragged shut — exactly as Cut is on the same span. While it
                    // sounds it is the stop, so it stays live. `idleEditable`
                    // carries the close window, where the sheet is committing.
                    disabled={
                      !audio.playingBuffer &&
                      (!idleEditable || audition === null)
                    }
                    onClick={onAuditionButton}
                  />
                  <Control
                    icon={zoom === ZOOM_WHOLE ? "zoom-in" : "zoom-out"}
                    label={
                      zoom === ZOOM_WHOLE
                        ? strings.zoomQuarter
                        : strings.zoomWhole
                    }
                    variant="quiet"
                    size={24}
                    // Frozen while a buffer sounds, exactly as the pan already is
                    // (#284 / George R2 on the pan): a zoom mid-audition rebuilds
                    // the window around the centerline under a line that is already
                    // travelling — for a picked span the band and the audio stay
                    // aligned, but the sounding region can leave the viewport and
                    // the playhead simply hides, and for a "line"/"whole" audition
                    // the whole-clip view means the tap does nothing visible at all
                    // and only takes effect once the sound stops. Playback is
                    // listen-only (D4); stopping it is one tap.
                    disabled={audio.playingBuffer}
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
                    onClick={onUndo}
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
                    onClick={onRedo}
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
          open={menuShown}
          onClose={() => setMenuOpen(false)}
          title={strings.recorderMenuTitle}
        >
          {mode === "record" ? (
            <>
              <Control
                icon="edit"
                label={strings.enterEdit}
                variant="quiet"
                // Editable when there is audio to edit, a full clipboard to paste
                // — a never-recorded segment with a pending clip must still open
                // edit mode to receive it, or the chapter-wide clipboard (G3) could
                // never land on an empty segment (George R2) — OR a live/paused
                // take, which `onEnterEdit` commits first, then edits (#134). Only
                // the commit window itself blocks it now, not every non-idle state.
                // Never while `denied`: the permission panel owns the body, and
                // entering edit there strands the edit toolbar over a Retry that
                // starts the mic (George R3, with onRetryRecord as the other half).
                // The gate lives in `editRowReason` so the grey row can say WHY
                // (#135): a take mid-commit shows the `alert` badge — a state mark
                // that names no control — and the reason joins the row's
                // accessible name.
                disabled={editReason !== null}
                hint={rowHint(editReason)}
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
                // Gate + reason from `markRowReason` (#135 round 3): this row greyed
                // silently while Edit and Erase beside it explained themselves.
                disabled={markReason !== null}
                hint={rowHint(markReason)}
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
                // entry must refuse there itself (George R-B6). Gate + reason from
                // `eraseRowReason` (#135).
                disabled={eraseReason !== null}
                hint={rowHint(eraseReason)}
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
                disabled={eraseReason !== null}
                hint={rowHint(eraseReason)}
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
);

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
    // `role="alert"` so AT announces the title when the panel mounts and — the
    // point here — when the async permission refine sharpens the message after
    // Retry has autofocused, which a screen-reader user parked on Retry would
    // otherwise never hear (#203 is a non-reader feature; George R1 P3). Mirrors
    // `LoadErrorPanel`, whose title is likewise announced without being focused.
    <div
      role="alert"
      className="flex flex-1 flex-col items-center justify-center gap-[18px] px-[22px] text-center"
    >
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
 * says so, and `role="alert"` makes AT announce that title and body when the
 * panel mounts — not just the focused control's name (#137 round-2: the safety
 * copy was visual-only, mirroring `SaveFailed`'s alertdialog now).
 *
 * Try again is never unmounted. While a retry is in flight (`retrying`) it stays
 * in place as `aria-busy` with the busy label and swallows further taps (the
 * `cancelled` flag drops any superseded load); a busy `Notice` sits beneath it
 * for the sighted visible feedback (a long-segment decode is not instant). The
 * old code swapped the whole control for the Notice, which dropped focus off the
 * `autoFocus`ed button onto the inert background, and `autoFocus`ed it again on
 * the failed retry's remount — stealing focus from a user who had moved to Back
 * (#137 round-2). Keeping it mounted removes both. Back stays mounted throughout
 * too: it is the panel's own named exit, and a retry decode cannot be aborted,
 * so hiding it would leave the whole retry window with no labelled way out
 * (George R1 P2).
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
    <div
      role="alert"
      className="flex flex-1 flex-col items-center justify-center gap-[18px] px-[22px] text-center"
    >
      <span style={{ color: "var(--s-live)" }}>
        <Icon name="alert" size={52} />
      </span>
      <p className="t-title" style={{ color: "var(--s-ink)" }}>
        {strings.loadFailedTitle}
      </p>
      <p style={{ color: "var(--s-ink-muted)" }}>{strings.loadFailedBody}</p>
      <Control
        icon="retry"
        label={retrying ? strings.loadRetrying : strings.loadRetry}
        variant="primary"
        size={30}
        autoFocus
        busy={retrying}
        onClick={onRetry}
      />
      {retrying ? <Notice tone="busy">{strings.loadRetrying}</Notice> : null}
      <Control
        icon="back"
        label={strings.loadBack}
        variant="quiet"
        onClick={onBack}
      />
    </div>
  );
}

/**
 * The take captured, but the decode after Stop failed (#165) — most often a
 * transient iOS "interrupted" context (#106), not corrupt bytes. Unlike
 * `LoadErrorPanel` (whose audio is safe on disk), this take exists ONLY as the
 * held container bytes, so the two rescue actions come first: Try again
 * re-decodes on this gesture (resuming the context) and, on success, commits and
 * closes; Share hands the raw bytes to the OS so they leave the phone when the
 * decode simply will not succeed.
 *
 * Rescue can fail forever, and round-1 review (George G1 / Frank F2) found the
 * panel was then a dead-ended app: Share did not release the sheet and the header
 * Back was disabled, so a permanent decode failure left NO way out. Two exits
 * close that without reintroducing the SILENT Back the disabled header prevented:
 * `onDone` appears once a Share SUCCEEDS (`shared` — the bytes are off the phone),
 * and `onDiscard` is a TWO-TAP armed discard (the `SaveFailed` shape: a
 * deliberate, confirmed loss, never a stray tap). Retry failures read under Try
 * again and share failures under Share (G6); Share is disabled mid-retry and Try
 * again mid-share so neither re-interrupts the other's context (G7 / G-2).
 * `role="alert"` announces the title and each Notice.
 */
function SaveDecodeFailedPanel({
  retrying,
  sharing,
  retryError,
  shareError,
  shared,
  onRetry,
  onShare,
  onDiscard,
  onDone,
}: {
  retrying: boolean;
  sharing: boolean;
  retryError: string | null;
  shareError: string | null;
  shared: boolean;
  onRetry: () => void;
  onShare: () => void;
  onDiscard: () => void;
  onDone: () => void;
}) {
  // The discard's armed second tap. A retry (or one in flight) disarms it, so the
  // confirmation cannot be carried across an unrelated action into a stray delete
  // — the same care `SaveFailed` takes. There is no attempt count here, so the
  // retry handler disarms.
  const [armed, setArmed] = useState(false);
  const showArmed = armed && !retrying;
  return (
    <div
      role="alert"
      className="flex flex-1 flex-col items-center justify-center gap-[18px] px-[22px] text-center"
    >
      <span style={{ color: "var(--s-live)" }}>
        <Icon name="alert" size={52} />
      </span>
      <p className="t-title" style={{ color: "var(--s-ink)" }}>
        {strings.takeRecoverTitle}
      </p>
      <p style={{ color: "var(--s-ink-muted)" }}>{strings.takeRecoverBody}</p>
      <Control
        icon="retry"
        label={
          retrying ? strings.takeRecoverRetrying : strings.takeRecoverRetry
        }
        variant="primary"
        size={30}
        autoFocus
        busy={retrying}
        // Disabled while a share is in flight (George R3 G-2): the mirror of the
        // Share-disabled-while-retrying guard below, so Try again cannot re-decode
        // into the context the OS share sheet is interrupting.
        disabled={sharing}
        onClick={() => {
          setArmed(false);
          onRetry();
        }}
      />
      {retrying ? (
        <Notice tone="busy">{strings.takeRecoverRetrying}</Notice>
      ) : retryError ? (
        <Notice>{retryError}</Notice>
      ) : null}
      <Control
        icon="share"
        label={strings.takeRecoverShare}
        variant="quiet"
        // Disabled mid-retry (George R1 G7): the OS share sheet would re-interrupt
        // the shared context the retry just resumed.
        disabled={retrying}
        onClick={() => {
          setArmed(false);
          onShare();
        }}
      />
      {shareError ? <Notice>{shareError}</Notice> : null}
      {shared ? (
        <>
          <Notice tone="info">{strings.takeRecoverShared}</Notice>
          <Control
            icon="check"
            label={strings.takeRecoverDone}
            variant="primary"
            size={30}
            onClick={onDone}
          />
        </>
      ) : null}
      <div className="mt-[10px] flex flex-col items-center gap-[8px]">
        <Control
          icon="trash"
          label={
            showArmed
              ? strings.takeRecoverDiscardArmed
              : strings.takeRecoverDiscard
          }
          variant="quiet"
          className={showArmed ? "text-[var(--s-live)]" : undefined}
          disabled={retrying}
          onClick={() => (showArmed ? onDiscard() : setArmed(true))}
        />
        {showArmed ? (
          <p className="text-[12px]" style={{ color: "var(--s-live)" }}>
            {strings.takeRecoverDiscardHint}
          </p>
        ) : null}
      </div>
    </div>
  );
}
