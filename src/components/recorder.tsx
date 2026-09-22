import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { CenterlineOverlay } from "./centerline-overlay";
import { Control } from "./control";
import { shareControlGlyph } from "./control-affordance";
import { EraseConfirm } from "./erase-confirm";
import { Icon } from "./icon";
import { Menu } from "./menu";
import { Notice } from "./notice";
import { PlayheadOverlay } from "./playhead-overlay";
import { resolveProbedPx } from "./recorder-layout";
import { RecorderStatus } from "./recorder-status";
import {
  CENTER_FRACTION,
  dragOriginAfterInterrupt,
  frozenPan,
  heldByDrag,
  liftOutcome,
  liveScopeShown,
  panAfterCutRest,
  panAfterDragMove,
  panAfterRedo,
  panAfterUndo,
  panGesture,
  recordDisabled,
  stageView,
} from "./recorder-stage";
import { SelectionOverlay } from "./selection-overlay";
import { strings } from "@/lib/strings";
import { LiveScope } from "./live-scope";
import {
  editRowReason,
  eraseRowReason,
  heldTakeIsBusy,
  markRowReason,
  rowHint,
} from "./menu-row-state";
import { VuMeter } from "./vu-meter";
import { Waveform } from "./waveform";
import { WaveformScroller } from "./waveform-scroller";
import { classifyShareError } from "@/hooks/share-flow";
import {
  nativeShare,
  readShareEnvironment,
  readSharePlatform,
  resolveProvesDelivery,
  selectShareRoute,
} from "@/hooks/share-target";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import { useEraseSegment } from "@/hooks/use-erase-segment";
import { useFocusRestore } from "@/hooks/use-focus-restore";
import { useRecorderSegment } from "@/hooks/use-recorder-segment";
import { useSegmentEditor } from "@/hooks/use-segment-editor";
import { overlayFallbackLabel } from "@/lib/a11y/focus-restore";
import { panelRecoveryFocus } from "@/lib/a11y/panel-recovery";
import { auditionPlan } from "@/lib/audio/audition";
import { mergeTake } from "@/lib/audio/edit";
import { framesToMs, msToFrames } from "@/lib/audio/format";
import { isFirstTakeInFlight } from "@/lib/audio/display-gain";
import { computePeaks } from "@/lib/audio/peaks";
import {
  effectivePan,
  panForZoom,
  playbackStrip,
  viewportWindow,
} from "@/lib/audio/viewport";
import { overlayBlocksClose, overlayDismissal } from "@/lib/nav/navigation";
import { failureExit } from "@/lib/takes/failure-exit";
import {
  attemptsCapture,
  classifyCapture,
  planClose,
  planPendingWork,
  type CaptureOutcome,
  type TailPlan,
} from "@/lib/takes/close-plan";
import { cn, formatDuration } from "@/lib/utils";
import type { Peaks, SampleRange } from "@/types/audio";
import type { SegmentId } from "@/types/domain";

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
   * The database can no longer be opened at all: this copy has yielded its
   * connection to another copy's upgrade and `getDb()` is latched (#221).
   *
   * The sheet has to be told, because `DatabasePanel` — the screen that says so
   * and offers the restart — is withheld while the recorder is open, so no
   * failure in here can be answered by "the panel will explain". Every one of
   * them used to report this permanent condition with retryable copy, and on the
   * close tails the retry control IS Back, so the sheet could not be left at all
   * (#450, then George R6 P2). `failureExit` turns this bit into the
   * stay-or-leave decision at each of the four sites.
   *
   * `blocked` is not this: it ends when the other copy closes, and a retry then
   * succeeds.
   */
  databaseUnreachable: boolean;
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
 * The sheet is two modes (#89). RECORD mode is the hero Record + Play + Edit
 * trio (#315) with the menu opener in the header; the finished toggle lives in
 * that menu. EDIT mode — entered deliberately, from either the record menu's
 * "Edit recording" row or the toolbar Edit control (#315), both firing
 * `onEnterEdit` — has Play, Zoom, Undo, Redo and Menu beside the stable
 * pressed Edit toggle
 * with the selection frame over the canvas, the paste marker in its own
 * reserved row above the canvas (#414 — no longer an overlay drawn on top of
 * the waveform), and Cut in its own reserved row below, marked by a header
 * "Editing" pill that also exits. A live/paused take does not block either
 * entry point: `onEnterEdit` commits the take first (#134), then opens edit
 * mode over the committed audio. Edit-mode Play is the audition (#284): it
 * sounds the picked span, and only that span, so a cut can be heard before it
 * is made.
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
      databaseUnreachable,
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
    // #450, the first instance of the class George R6 P2 is the second of. The
    // load goes through `getDb()`, so once the yield has latched it fails
    // identically every time — and `LoadErrorPanel`'s auto-focused Retry re-runs
    // exactly that. Rather than relabel a control that cannot work, leave: the
    // sheet is what withholds `DatabasePanel`, so leaving IS what puts the
    // restart on screen. `false` because nothing changed, so Segments has no
    // reason to reload.
    //
    // An effect, not a render-time call: this is a condition arriving from
    // outside React (the browser closed a connection), and the exit must happen
    // after the commit that observed it, not during it.
    useEffect(() => {
      if (loadError === null) return;
      if (failureExit("load", databaseUnreachable) === "exit") onExit(false);
    }, [loadError, databaseUnreachable, onExit]);

    const [menuOpen, setMenuOpen] = useState(false);
    // The sheet is two modes over one segment (#89): a record mode (the hero
    // Record + Play + Edit trio, #315) and an edit mode (the waveform-editing
    // toolbar). The sheet always opens in record; App keys it on `segmentId` so
    // it remounts per open, so `"record"` is the open state with no reset
    // effect needed. Edit is entered deliberately — the record menu's row or
    // the toolbar control — and a live/paused take does not block it: entering
    // commits the take first (#134), so entry is not "strictly idle" anymore.
    const [mode, setMode] = useState<"record" | "edit">("record");
    const [selectionEntry, setSelectionEntry] = useState<{
      samples: Int16Array | null;
    } | null>(null);
    // The Erase Segment confirmation (D-CONFIRM), opened from the menu.
    const [confirmOpen, setConfirmOpen] = useState(false);
    // Focus back to whatever opened an overlay, once the overlay is gone (#97).
    // ONE pair for the ≡ menu and the erase confirm together, because they are
    // one `inert` scope and they chain inside it — the Erase row closes the menu
    // and opens the confirm in the same commit. See the capture in `openMenu`
    // and the restore effect below `menuShown`.
    const focusRestore = useFocusRestore();

    // `null` ⇒ resting at the end of the existing audio (append-ready, F7). A
    // derived rest, rather than a value set in an effect once `view` loads: the
    // sheet mounts fresh on every open, so `null` is the open state, and a drag
    // is what replaces it with an absolute sample position.
    const [panState, setPanState] = useState<number | null>(null);
    // Where the zoom moved the view to keep an open selection on screen (#91).
    // A VIEW value only — see `viewPan` below for why it must never be
    // `panState`. Cleared when a selection opens (a fresh span has not been
    // zoomed yet), when a drag takes the pan over, and on leaving edit.
    const [zoomPan, setZoomPan] = useState<number | null>(null);
    const [zoom, setZoom] = useState(ZOOM_WHOLE);
    const stageRef = useRef<HTMLDivElement | null>(null);
    const sheetRef = useRef<HTMLDivElement | null>(null);
    const dragStartX = useRef(0);
    const panAtDragStart = useRef(0);
    const [dragging, setDragging] = useState(false);
    /**
     * The pointer that owns the stage, and every contact currently on it
     * (George R3 P1-2).
     *
     * A drag was a single shared slot — one origin, one resume flag, an up
     * handler that did not look at which pointer it was — while
     * `setPointerCapture` is per pointer. So a second finger landing mid-drag
     * overwrote the first one's origin with the stale pre-play pan, and
     * whichever finger lifted first ran the resume: playback jumped backwards,
     * or restarted while the other finger was still down, which is precisely
     * what #317 says must never happen.
     *
     * `ownerRef` is the one pointer whose move/up/cancel the stage answers;
     * every other `pointerdown` is ignored outright. `contactsRef` is the wider
     * question the resume asks — the requirements owner's rule is about
     * FINGERS, not about the one we happen to track — and it is a ref, not
     * state, because the answer is needed synchronously inside the lift that
     * would start the sound.
     *
     * The set only works because EVERY contact is captured, not just the owner
     * (Frank R3 P2): capture is what guarantees the matching
     * `pointerup`/`pointercancel` comes back to this element, so a finger that
     * slides off the stage before lifting cannot leave a stale id behind and
     * suppress the resume for good.
     */
    const ownerRef = useRef<number | null>(null);
    const contactsRef = useRef<Set<number>>(new Set());
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
    // An Edit-commit can settle superseded and leave this sheet mounted at idle.
    // Its later no-capture exits still owe the no-writes policy (#527), including
    // pending edits/clear and Finished. A successfully saved fresh take restores
    // a current base; a refused start or another empty stop does not.
    const supersededCapture = useRef(false);
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
     * Whether THIS close began with an active capture (recording, paused, or a
     * #59 `processing` freeze) — as opposed to an edit-only or Finished-only
     * close, which also sets `isClosing` true for the same commit-then-exit
     * wait but never had a mic to show (Frank R-resume, round 3). Read
     * alongside `isClosing`, never on its own: it is only meaningful while
     * `isClosing` is true, and is left stale (harmlessly) between closes
     * rather than reset on every `setIsClosing(false)`. Every site that flips
     * `isClosing` to `true` sets this in the same synchronous block (batched
     * into the same render as `isClosing`'s own update), never derived from a
     * ref read at render time (`react-hooks/refs`).
     */
    const [captureClosing, setCaptureClosing] = useState(false);
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

    // The edit-mode canvas shrink below reads its size from
    // `--c-recorder-paste-row` (`3-components.css`) rather than repeating the
    // 44+6 arithmetic in JS (George R3 P3) — a hardcoded `150` would silently
    // stop matching the reserved `.recorder-paste` row's actual height the
    // next time `--c-control-md` or `--p-space-2` changes (the #362 40→44
    // question already open in this file is exactly that kind of change).
    //
    // `getComputedStyle(...).getPropertyValue("--c-recorder-paste-row")`
    // would NOT do this: a custom property's computed value is its
    // specified value with `var()` substituted, not `calc()` resolved, so
    // that call would hand back the literal string "calc(44px + 6px)", and
    // `parseFloat` on that is `NaN`. Applying the token to a real property
    // (`height`) on a detached probe element is what actually resolves the
    // `calc()`/`var()` chain to a used pixel value — the standard technique
    // for reading a custom property's real number from JS.
    //
    // Read once via `useMemo`, not per frame: spacing tokens carry no theme
    // media query (unlike the `--s-*` colour roles), so they cannot change
    // under this component without a page reload, which would remount it
    // anyway. `50` is a defensive fallback for an environment where the
    // probe cannot resolve at all, not a second source of truth for it.
    // `resolveProbedPx` (`recorder-layout.ts`) owns the "did this actually
    // resolve" check, not a bare `Number.isFinite` here — a "0px" read, what
    // an UNRESOLVED custom property's used height actually computes to, is
    // finite and would otherwise read as success (George R4 P3): the group
    // would then grow back to ~296px on the rare failure this guard exists
    // to catch, worsening the overflow-onto-Cut risk tracked at #428.
    const pasteRowPx = useMemo(() => {
      if (typeof document === "undefined") return 50;
      const probe = document.createElement("div");
      probe.style.position = "absolute";
      probe.style.visibility = "hidden";
      probe.style.height = "var(--c-recorder-paste-row)";
      document.body.appendChild(probe);
      const raw = getComputedStyle(probe).height;
      probe.remove();
      return resolveProbedPx(raw, 50);
    }, []);

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

    // Which pan is drawn — and, in record mode, spliced at. The gate that keeps
    // the zoom's view fit out of the record insertion offset (the round-1 P1)
    // lives in `effectivePan`, pure and table-tested, rather than as an
    // expression here where nothing could reach it: the George stand-in showed
    // that reintroducing the P1 at the setter left all 512 tests green. Its
    // docblock carries the full reasoning, including the upper-only clamp, which
    // is what a cut shortening `working` past an older `panState` needs.
    const pan = effectivePan({
      mode,
      selectionActive: editor.selectionActive,
      zoomPan,
      panState,
      length,
    });
    const win = viewportWindow(length, pan, zoom, CENTER_FRACTION);
    const insertionPan = Math.min(panState ?? length, length);
    // Reloads must reach their committed buffer first. Cut/Undo/Redo clear the
    // old frame, so reseed from the remapped insertion pan before painting.
    // Empty buffers have no usable frame; Undo or Paste can make one again.
    if (
      mode === "edit" &&
      !editor.selectionActive &&
      (!selectionEntry ||
        selectionEntry.samples === null ||
        editor.working === selectionEntry.samples)
    ) {
      if (length > 0) {
        const seedWindow = viewportWindow(
          length,
          insertionPan,
          zoom,
          CENTER_FRACTION
        );
        const half = seedWindow.visibleSamples * 0.15;
        editor.openSelection({
          start: seedWindow.centerlineSample - half,
          end: seedWindow.centerlineSample + half,
        });
      }
      if (selectionEntry) setSelectionEntry(null);
      if (zoomPan !== null) setZoomPan(null);
    }

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
    //
    // And dead while a finger owns the stage (#317, George R2 P1): that touch
    // stops playback before the drag starts, so every term below reads "nothing
    // is sounding" while the pan is still moving and the lift already owes a
    // resume. `heldByDrag` carries the rest of that rule.
    const playDisabled = heldByDrag(
      dragging,
      busy ||
        isClosing ||
        (paused
          ? previewState === "decoding" || previewState === "failed"
          : recording || !hasAudio)
    );

    // Which way the stage is drawn, and what that makes inert (#284). All four
    // answers come from ONE pure derivation, `stageView`, because review rounds
    // kept finding the same defect in a different control or overlay — one
    // reading the pan/zoom window, or the hide rule written for a swapped view,
    // while something else was drawn. The class, the reasoning and the
    // deliberate exceptions are enumerated there; this file reads the answers
    // rather than re-deriving them per control, so the next one inherits the
    // rule instead of re-earning the bug.
    const stage = stageView({
      mode,
      playingBuffer: audio.playingBuffer,
      selectionActive: editor.selectionActive,
      previewShown: previewShown !== null,
      // The second owner of the inert class (George R2 P1): the #317 touch
      // stops playback BEFORE the drag begins, so `playingBuffer` is already
      // false while the finger is still down and the pan is still moving.
      dragging,
    });
    const wholeView = stage.render === "whole";
    // The waveform scrolls under the fixed centerline (#415/#416/#417). While
    // it does, the canvas is not a window that follows the pan: it is one strip
    // — the clip plus a viewport of blank, drawn at the CURRENT zoom (#417) —
    // that `WaveformScroller` translates each frame so the sounding sample
    // stays under the line. `null` in every other state, which is what keeps
    // the static geometry below exactly what it was.
    const strip =
      stage.render === "scroll" && hasAudio
        ? playbackStrip(length, win.visibleSamples, CENTER_FRACTION)
        : null;
    // ONE spelling of "the waveform is scrolling", so the scroller and the
    // playhead overlay cannot disagree about it: the overlay hides exactly when
    // the centerline takes over as the playhead. (`hasAudio` is belt to the
    // braces — `playBuffer` refuses an empty buffer — but if the two ever did
    // come apart, a state with neither cue would be the worst of both.)
    const scrolling = strip !== null;
    const waveView = strip
      ? {
          startFraction: strip.startFraction,
          endFraction: strip.endFraction,
          centerFraction: CENTER_FRACTION,
        }
      : {
          startFraction: wholeView ? 0 : hasAudio ? win.start / length : 0,
          endFraction: wholeView ? 1 : hasAudio ? win.end / length : 1,
          centerFraction: CENTER_FRACTION,
        };

    // The Zoom control's CHROME (pressed state, icon, label) while `wholeView`
    // is true (#284, George R7): the canvas is drawn at clip fractions 0..1,
    // which IS what "whole" zoom draws, whatever `zoom` itself still says. Zoom
    // is disabled by `stage.windowControlsInert` here, so it cannot be tapped,
    // but a disabled control still shows a state — `pressed` is the one channel
    // a non-reader has for "which zoom level is this" (`Control`'s own
    // contract) — and it must name the window actually on screen, not the one
    // that returns once the buffer stops sounding. `zoom` itself is untouched:
    // that real value is what comes back the moment `wholeView` goes false.
    const displayedZoom = wholeView ? ZOOM_WHOLE : zoom;

    // What Play sounds, in BOTH modes (#284, widened by #317): the picked span
    // when one is up, else the working buffer from the centerline on. `null` ⇒
    // there is nothing to play (no audio, or a span collapsed to a point),
    // which is the cue to leave the control inert — state-in-place, no message.
    //
    // Record mode used to build no plan at all: its Play sounded the whole
    // working buffer from frame 0. The requirements owner's #317 rule — "Play
    // starts from the sample under the line" — makes that the same question
    // edit mode already asks, so it is asked once, in the pure, unit-tested
    // `auditionPlan`, rather than twice. The rest-position case comes for free
    // with it: with the line at the end of the take (F7, where a freshly opened
    // sheet sits) "from the line" would be silence, and `auditionPlan` already
    // answers that by sounding the WHOLE buffer — so an untouched Play still
    // plays the whole segment, exactly as it did before.
    //
    // The selection is read only in edit mode, the same reader gate
    // `effectivePan` applies to `zoomPan` and for the same reason: a span left
    // open on a path back to record mode must not change what record-mode Play
    // sounds.
    const playPlan = auditionPlan(
      length,
      mode === "edit" && editor.selectionActive ? editor.selection : null,
      win.centerlineSample
    );

    // The playhead's position within the DRAWN buffer (#102 + #284). Buffer
    // playback reports milliseconds into whatever was handed to `playBuffer`,
    // which for an audition of a picked span is a view starting partway through
    // `working`; adding the pinned offset here is what keeps the line over the
    // samples being heard, and keeps the overlay itself free of any notion of a
    // selection. `null` — the hide sentinel, distinct from 0 — passes through
    // untouched.
    // The DRAWN position takes the optimistic pre-start answer as-is: before the
    // handle settles the play has not moved off its start, so the line belongs
    // at the range start and the overlay stays up. Only a REMEMBERED position
    // needs `measured` — see `stopPlayback` — which is the whole point of
    // `readPlaybackPosition` returning both halves (George R4 P1).
    const readPlaybackPosition = audio.readPlaybackPosition;
    const readSoundingElapsed = useCallback(() => {
      const pos = readPlaybackPosition();
      return pos === null ? null : soundingOffsetRef.current + pos.ms;
    }, [readPlaybackPosition]);

    // The same position in SAMPLES, which is the unit the strip, the pan and
    // the record insertion offset all speak (#415). Pulled on the scroller's
    // rAF, never during render.
    const readPlaybackSample = useCallback(() => {
      const ms = readSoundingElapsed();
      return ms === null ? null : msToFrames(ms);
    }, [readSoundingElapsed]);

    /**
     * Where the scrolling playback had reached, written every frame by
     * `WaveformScroller` and read when it stops. A ref, not state: at 60 Hz it
     * is the whole reason the waveform moves by DOM instead of by render.
     */
    const playbackSampleRef = useRef(0);
    /**
     * A scrolling playback is in flight and still owes the pan a freeze. Set
     * when the stage enters the scroll mode, consumed by the first
     * `freezePlaybackPan` after it leaves — so the freeze happens exactly once
     * per play, and an idle re-render never writes the pan.
     */
    const scrollPendingRef = useRef(false);
    /** A #317 drag interrupted playback and owes it a resume on lift. */
    const resumeAfterDragRef = useRef(false);
    /** The pan the last drag move wrote, read on lift before React catches up. */
    const draggedPanRef = useRef(0);
    /**
     * The end of the range the scrolling playback was asked to sound — the
     * exact resting place of a clip that runs out, which no sampling could
     * recover (the handle is gone before anything can observe it).
     */
    const soundingEndRef = useRef(0);
    /**
     * This playback was ASKED to stop, as opposed to running out. Written by
     * `stopPlayback` — the one stop path in this sheet.
     */
    const stopRequestedRef = useRef(false);
    /**
     * This playback RAN OUT, as reported by the playback boundary itself
     * (`playBuffer`'s `onEnded`, which fires for that ending and no other).
     * Not inferred from how far the frame loop got: a range shorter than one
     * frame ends before any rAF reads a handle (Frank R2 P2).
     */
    const ranOutRef = useRef(false);
    /**
     * The stop that is being frozen had a REAL position to freeze (George R4
     * P1). Written by `stopPlayback` from the audio boundary's own answer, not
     * accumulated over the play: at the moment of a stop, "is there a handle"
     * is exactly "was this position ever more than an assumption".
     *
     * False is the tap that lands in `playBuffer`'s optimistic window — before
     * `playSamples` has resumed the context, filled a whole-clip AudioBuffer
     * and yielded — where the only position anything has seen is the range's
     * start. Freezing that made the default Play from the F7 rest a punch-in at
     * sample 0.
     */
    const measuredRef = useRef(false);

    const notePlaybackSample = useCallback((sample: number) => {
      playbackSampleRef.current = sample;
    }, []);

    /**
     * Freeze the view where playback stopped — #416's whole fix.
     *
     * "Pause only pauses. The waveform and the playhead stay exactly where
     * playback had reached; nothing jumps. Play resumes from that same point."
     * Before this, nothing recorded where playback had reached: the moment
     * `playingBuffer` went false the window recomputed from `panState`, which
     * had been sitting at the end of the take the whole time — the instant jump
     * to the end the issue reports.
     *
     * Route-independent on purpose: `stopPlayback` runs it for every asked-for
     * stop, and the layout effect below catches the one ending no handler sees,
     * a clip running out.
     *
     * WHICH sample it freezes is a decision of its own, and an exact one rather
     * than "whatever the last frame saw" — including the `null` REST, which is
     * not a missing answer but F7's "the end, whatever the end becomes"
     * (`frozenPan`, and George R1 P1).
     *
     * `scrollPendingRef` is the one-shot: it is set while the stage scrolls and
     * consumed by the first freeze after it, so a freeze happens exactly once
     * per play and an idle re-render never writes the pan. A rematerialiser
     * clears it instead of consuming it — see `stopPlaybackDroppingPan`.
     */
    const freezePlaybackPan = useCallback(() => {
      if (!scrollPendingRef.current) return;
      scrollPendingRef.current = false;
      const frozen = frozenPan({
        observed: playbackSampleRef.current,
        end: soundingEndRef.current,
        stopRequested: stopRequestedRef.current,
        ranOut: ranOutRef.current,
        length,
        measured: measuredRef.current,
      });
      // `"keep"` writes NOTHING, and it now covers BOTH ways a play can have no
      // position worth keeping (George R2 P2 #3, then R4 P1): a `playSamples`
      // that threw after the optimistic `playingBuffer = true`, and a stop that
      // landed before the handle ever settled. In each the only position
      // anything saw was the range's start, and writing it turned the default
      // Play from the F7 rest into a punch-in at sample 0.
      if (frozen.kind === "pan") setPanState(frozen.pan);
    }, [length]);

    /**
     * Stop buffer playback, sampling the true position and freezing it.
     *
     * The ONE stop path this sheet uses, and the reason is #416's promise
     * (Frank R1 P2): `playbackSampleRef` is written on the scroller's rAF, so
     * it is up to a frame stale, and `stopBuffer` clears the handle that knows
     * better. Reading `readPlaybackSample()` synchronously HERE — in whatever
     * handler is stopping, before the handle goes — is what makes "the waveform
     * stays exactly where playback had reached" true rather than approximately
     * true. A frame of drift is ~700 samples, which is also a Record splicing
     * 16 ms before the end of a take instead of appending to it.
     *
     * The freeze is synchronous, not left to the layout effect (George R1 P2
     * #2). The effect is a LATER writer of `panState` than the handler that
     * stopped playback, so it landed after whatever that handler did next —
     * after `onCut`'s `panAfterCut`, which it would clobber, and after an
     * `editor.undo()` that had already replaced the buffer the position was
     * measured in. Freezing here puts the write in the same turn as the stop,
     * against the buffer that was actually sounding, and lets a same-turn
     * functional `setPanState` compose ON TOP of it rather than under it.
     *
     * `audio.stopBuffer` is a no-op when nothing is sounding, and so is this.
     *
     * It RETURNS the position it sampled, because a caller that needs it must
     * not read the ref itself: `playbackSampleRef` is the stale rAF value until
     * the line below replaces it, so a #317 drag that captured its start before
     * calling this began a frame behind the audio it had just paused (Frank R2
     * P2 #1). It returns that position's PROVENANCE with it (George R5 P1) — a
     * caller that is going to persist the number needs the same answer the
     * freeze needs, and handing back a bare sample is what let the drag origin
     * keep trusting a position the freeze had just refused.
     *
     * It also DROPS any resume the #317 gesture still owes (George R2 P1). A
     * stop is the translator asking for silence, and every non-lift route out
     * of the drag — Undo, Redo, Select, ≡, Edit, Done editing, Cut, Paste,
     * Back — comes through here or through `stopPlaybackDroppingPan`, so
     * clearing the flag in the TWO stop paths covers all nine without nine
     * assignments that a tenth handler could later forget. The `"interrupt"`
     * in `onPointerDown` sets the flag immediately AFTER its own call here;
     * that order is what makes it the one stop that does not void the resume.
     */
    const stopBuffer = audio.stopBuffer;
    const stopPlayback = useCallback(() => {
      // Both halves of the boundary's answer, read once, before `stopBuffer`
      // takes the handle away. `ms` still updates `playbackSampleRef` even when
      // it is the optimistic pre-start value, because that IS where the line is
      // drawn and a #317 drag has to start from what the translator can see;
      // `measured` is what decides whether the freeze may keep it.
      const pos = readPlaybackPosition();
      if (pos !== null) {
        playbackSampleRef.current = msToFrames(
          soundingOffsetRef.current + pos.ms
        );
      }
      const measured = pos !== null && pos.measured;
      measuredRef.current = measured;
      stopRequestedRef.current = true;
      // Any stop VOIDS an owed #317 resume (George R2 P1). See the docblock.
      resumeAfterDragRef.current = false;
      stopBuffer();
      freezePlaybackPan();
      return { sample: playbackSampleRef.current, measured };
    }, [stopBuffer, readPlaybackPosition, freezePlaybackPan]);

    /**
     * Stop playback and forget where it had reached — for a caller about to
     * REPLACE the buffer that was sounding (George R1 P2 #2).
     *
     * Undo and Redo rematerialise `working` from the edit log, and they are
     * live controls while a buffer sounds. A sample index measured in the
     * buffer that was playing names different audio in the one that comes back:
     * undo a cut of the first 2 000 samples and the position the line was on
     * moves 2 000 samples deeper into the speech, where the next Record would
     * splice.
     *
     * This function only drops the ONE-SHOT, not-yet-committed play position a
     * frame loop was observing — a value that was never written into
     * `panState` at all, so there is nothing there for `onUndo`/`onRedo` to
     * map (#449's `panAfterUndo`/`panAfterRedo` map a pan that IS already in
     * `panState` through the undone/redone op instead of dropping it; see
     * those two below). Dropping the in-flight observation and leaving
     * `panState` exactly as the translator last set it is what these controls
     * did before playback ever wrote it, and is still correct here: freezing
     * an unsettled rAF position into `panState` would invent a pan the
     * translator never asked for, which is a different defect from #449's.
     *
     * Clearing the one-shot is what makes it a drop rather than a deferral: the
     * layout effect must not freeze this play either, a commit later, against
     * the new buffer.
     *
     * It voids an owed #317 resume for the same reason `stopPlayback` does, and
     * more sharply here: Undo and Redo are exactly the controls a second finger
     * can reach mid-drag, and a lift resuming into the rematerialised buffer
     * would sound — and then freeze — a sample index measured in the buffer
     * that is gone (George R2 P1).
     */
    const stopPlaybackDroppingPan = useCallback(() => {
      scrollPendingRef.current = false;
      resumeAfterDragRef.current = false;
      stopBuffer();
    }, [stopBuffer]);

    // The one ending no handler sees: the clip ran out. A LAYOUT effect, so the
    // frozen pan is committed before the browser paints the frame in which
    // playback stopped — in a plain effect the stage would show one frame of
    // the pre-play pan, which is the jump #416 is about, merely briefer. The
    // set-state goes through a `useCallback` rather than sitting in the effect
    // body, the same shape the paused-exit effect below uses to stay inside the
    // hooks rules. After an asked-for stop this is already a no-op: that path
    // consumed the one-shot in its own turn.
    useLayoutEffect(() => {
      if (scrolling) {
        scrollPendingRef.current = true;
        return;
      }
      freezePlaybackPan();
    }, [scrolling, freezePlaybackPan]);

    /**
     * Sound a range of the working buffer, with the playhead's coordinate
     * pinned to it.
     *
     * One path for all three plays — record-mode Play, the edit-mode audition,
     * and the #317 resume-on-lift — so "what sounds" and "what the overlay
     * thinks is sounding" cannot be set from two places and disagree. The range
     * is a `subarray`: a VIEW, not a copy, so no allocation beyond what
     * `playBuffer`'s own Int16→Float32 conversion already makes.
     *
     * It never lets `playBuffer`'s own toggle be the thing that stops a sound
     * (George R4 P2). That branch is `stopBuffer(); return;` — it sets no
     * `stopRequested`, samples no position and freezes nothing — so reaching it
     * from here would clear this play's ending flags, stop the previous sound,
     * start nothing, and leave the armed one-shot to answer `"keep"`: the stage
     * snapping back to the pre-play pan, which is the #416 defect. The guard
     * below is the same "one stop path" rule the rest of the sheet follows, and
     * it reads the AUDIO's own answer rather than React's `playingBuffer`,
     * which is a commit behind in exactly the window this is about.
     */
    const soundRange = useCallback(
      (start: number, end: number) => {
        if (readPlaybackPosition() !== null) stopPlayback();
        // Pinned BEFORE the play, so the playhead is offset by the range that
        // is actually sounding rather than by whatever the line becomes next.
        soundingOffsetRef.current = framesToMs(start);
        // Where a clip that runs out comes to rest, which no frame loop can
        // observe (the handle is cleared before the next tick).
        soundingEndRef.current = end;
        // This play's ending is undecided until it happens. Reset HERE, the one
        // door into a scrolling playback — the paused-take preview sounds a
        // different buffer and never scrolls — and synchronously, before
        // anything can report an ending.
        stopRequestedRef.current = false;
        ranOutRef.current = false;
        // ...and this play has no measured position yet either: the handle is
        // still several awaits away (George R4 P1). Any stop that lands before
        // it settles must freeze nothing.
        measuredRef.current = false;
        audio.playBuffer(editor.working.subarray(start, end), 0, {
          // The boundary reports the one ending nothing here could reconstruct:
          // the clip ran out. It fires only for a source that was not stopped
          // by hand and whose claim still owns the floor, so a `stopBuffer`, a
          // superseded claim and a failed start all leave this false.
          onEnded: () => {
            ranOutRef.current = true;
          },
        });
      },
      [audio, editor.working, readPlaybackPosition, stopPlayback]
    );

    const onPointerDown = useCallback(
      (e: React.PointerEvent) => {
        // Every contact is recorded, even one this handler then ignores: the
        // resume asks whether the STAGE is clear, not whether our own pointer
        // has lifted (George R3 P1-2).
        //
        // And every contact is CAPTURED, not just the owner (Frank R3 P2).
        // Capture is what guarantees the matching `pointerup`/`pointercancel`
        // comes back here: without it a second finger that slid off the stage
        // before lifting left its id in the set forever, and a stale id there
        // suppresses the owed resume — silence after every finger is gone,
        // which is the #317 promise broken from the other side. Capture costs
        // that finger nothing, because a pointer that went down on the stage
        // could not have reached another control anyway.
        contactsRef.current.add(e.pointerId);
        e.currentTarget.setPointerCapture(e.pointerId);
        // One owner at a time. A second finger landing mid-drag used to be a
        // fresh `"pan"` — after the interrupt's stop, `playingBuffer` is false,
        // so `panGesture` answered "pan" — and it overwrote the drag origin
        // with `pan`, the stale pre-play value the interrupt path exists to
        // avoid. Ignoring it is both the fix and the honest model: the stage
        // has one centerline, so it can follow one finger.
        if (ownerRef.current !== null) return;
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
        //
        // Playback used to freeze the pan outright — the pan was the oldest
        // member of the `windowControlsInert` class (Frank/George R2), under
        // D4's "playback is listen-only — no scrub in v1". The requirements
        // owner reversed that for this one gesture (#317, 2026-09-16), so the
        // decision is now three-valued and lives in the pure, enumerated
        // `panGesture` rather than as a predicate here where nothing could
        // reach it: `"interrupt"` is the reversal (pause, pan, resume on lift),
        // and the two sounding states it did NOT reverse still answer
        // `"ignore"`. Its docblock carries the whole rule.
        const gesture = panGesture({
          hasAudio,
          recording,
          paused,
          busy,
          playingBuffer: audio.playingBuffer,
          render: stage.render,
        });
        if (gesture === "ignore") return;
        // Start from where playback had REACHED, not from `panState`. The
        // freeze that writes the reached position is synchronous inside
        // `stopPlayback` (George R1 P2 #2), but it is a `setPanState` — so
        // `pan` in THIS closure is still the pre-play value for one more
        // commit, and only `stopPlayback`'s return value knows better. Do not
        // "simplify" this to read `pan` after the stop; that is the
        // frame-behind drag start this PR already paid for twice.
        let from = pan;
        if (gesture === "interrupt") {
          // "Playback never runs while the finger is down" — synchronously, in
          // the gesture's own handler, before anything moves. The drag starts
          // from the position `stopPlayback` RETURNS, not from the ref it is
          // about to overwrite: the ref is the last rAF value, up to a frame
          // behind, and a drag begun there would rewind the waveform under the
          // finger and resume early on lift (Frank R2 P2 #1).
          //
          // ...and only when that position was REAL (George R5 P1). Before the
          // handle settles the stop can only report the range's start, and the
          // freeze already refuses to keep it; taking it here instead wrote it
          // into `panState` on the first move. `dragOriginAfterInterrupt` holds
          // the rule and the reasoning.
          const stopped = stopPlayback();
          from = dragOriginAfterInterrupt({
            measured: stopped.measured,
            reached: stopped.sample,
            pan,
            length,
          });
          // AFTER the stop, never before: `stopPlayback` voids an owed resume
          // (George R2 P1), and this is the one stop that owes a new one.
          resumeAfterDragRef.current = true;
        }
        ownerRef.current = e.pointerId;
        setDragging(true);
        dragStartX.current = e.clientX;
        panAtDragStart.current = from;
        draggedPanRef.current = from;
      },
      [
        hasAudio,
        recording,
        paused,
        busy,
        audio,
        stage.render,
        pan,
        length,
        stopPlayback,
      ]
    );

    const onPointerMove = useCallback(
      (e: React.PointerEvent) => {
        // Only the pointer that owns the stage moves the pan (George R3 P1-2).
        // `setPointerCapture` is per pointer, so a second finger's moves arrive
        // here too, and they used to pan from the OWNER's origin — a second
        // thumb sliding the centerline the first one was holding still.
        if (e.pointerId !== ownerRef.current) return;
        // Freeze a drag ALREADY in flight the moment the take goes non-idle, not
        // just its start (onPointerDown). A pan begun while idle keeps its pointer
        // capture, so with a second finger the translator can tap Record and keep
        // moving the first finger through the `requesting` window — sliding the
        // centerline off the sample insertionOffset already locked to at the tap
        // (#61). The pointer-down guard alone left this multitouch path open.
        // Playback is NOT in this guard anymore (#317): a drag can only begin
        // through `onPointerDown`, which stops a scrolling playback before it
        // sets `dragging` and refuses the other two sounding states outright —
        // so by the time a move arrives, either nothing is sounding or the stop
        // has not yet been through a commit, and in both cases this drag is the
        // one the translator asked for. Nothing else can start a sound
        // mid-drag: Record reads `dragging` through `recordDisabled` and Play
        // through `heldByDrag` — which it did NOT until George R2 P1, so the
        // second finger this sentence claimed was blocked could in fact tap
        // Play, Undo or Redo. The resume this gesture owes happens on LIFT, and
        // any other stop in between voids it (`stopPlayback`).
        if (!dragging || recording || paused || busy) return;
        const width = stageRef.current?.clientWidth ?? 1;
        // Drag right reveals earlier audio: the sample under the centerline
        // decreases. The move is scaled by what the viewport spans at this zoom,
        // so a fixed thumb travel pans less when zoomed in.
        const dx = e.clientX - dragStartX.current;
        const delta = -(dx / width) * win.visibleSamples;
        // `panAfterDragMove` holds the clamp AND the rest rule (#442): a pan
        // that lands ON the end is the F7 REST, not the number `length`.
        // Without it the accidental touch this round is about — a finger
        // landing during the optimistic window, jitter, no intended pan —
        // would still convert a resting line into a stale absolute index, and
        // the next paste or append would leave Record splicing at the OLD end
        // instead of the new one. This handler does not re-derive the clamp;
        // that is the one thing #442 was.
        const { raw, pan: written } = panAfterDragMove({
          origin: panAtDragStart.current,
          delta,
          length,
        });
        setPanState(written);
        // The raw sample, where the LIFT can read it (#317): `pointerup` needs
        // the sample now under the line to resume there, and the render that
        // carries this `setPanState` may not have happened yet. Deliberately
        // NOT `written`: the lift's `resumesOnLift` compares this against
        // `length` to tell "dragged to the end" from "dragged short of it",
        // which a pre-rested `null` could never answer.
        draggedPanRef.current = raw;
        // A real drag is the translator choosing this view deliberately, so the
        // pan becomes the REAL one — insertion offset included — and the zoom's
        // view-only fit is handed over rather than continuing to override it.
        // `panAtDragStart` was captured from the DRAWN pan, so the value written
        // above continues from where the waveform already was and the handover is
        // seamless. Done on the first MOVE rather than on pointerdown: a bare tap
        // on the stage is not a pan and must not adopt a view fit as the splice
        // point.
        setZoomPan(null);
      },
      [dragging, recording, paused, busy, win.visibleSamples, length]
    );

    /**
     * Lift — and, if this gesture interrupted playback, resume it (#317).
     *
     * "When the finger lifts, playback RESUMES from the sample under the
     * centerline. Playback never runs while the finger is down." It resumes
     * from `draggedPanRef`, which the moves above keep current, rather than
     * from `pan`: the last move's render may still be pending.
     *
     * With the line dragged to the very END there is nothing left to sound, so
     * nothing resumes and the take stays parked there — the position Record and
     * Paste then act on, which is the point of the gesture. That is deliberately
     * NOT `auditionPlan`'s rest-position fallback ("from the line" at the end
     * means the whole buffer): as a fresh Play that reads as "play the segment",
     * but as a RESUME it would restart from the beginning, which is not what
     * dragging to the end asks for. Flagged as such on #317.
     *
     * Also runs on `pointercancel` (the same handler): the finger is gone
     * either way, and leaving playback stopped after a cancelled gesture would
     * be a sound the translator can no longer explain.
     *
     * The three answers a lift owes — the lock, the sound and the debt — come
     * apart once the stage can outlive the pointer that owned it, so they are
     * decided in the pure, enumerated `liftOutcome` rather than here (George R3
     * P1-2 and Frank R3 P2, both of which were this handler reading its own
     * pointer as if it were the whole hand). `takeActive` is the mic
     * outranking the gesture (George R1 P2 #3): a Record tapped in the same
     * frame as the pointer-down is ahead of the render that disables it, and a
     * resume into a live or paused mic either fails silently at the floor or
     * sounds over a capture.
     */
    const onPointerUp = useCallback(
      (e: React.PointerEvent) => {
        contactsRef.current.delete(e.pointerId);
        const wasOwner = e.pointerId === ownerRef.current;
        if (wasOwner) ownerRef.current = null;
        const from = Math.max(0, Math.min(draggedPanRef.current, length));
        const outcome = liftOutcome({
          wasOwner,
          ownerActive: ownerRef.current !== null,
          contactsRemaining: contactsRef.current.size,
          interrupted: resumeAfterDragRef.current,
          pan: from,
          length,
          takeActive,
        });
        setDragging(outcome.dragging);
        resumeAfterDragRef.current = outcome.keepOwed;
        if (outcome.resume) soundRange(from, length);
      },
      [length, soundRange, takeActive]
    );

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
    // leave from `paused`. The stop is a callback, not a direct set-state, so
    // this effect stays within the hooks rules; the leftover `previewState` is inert
    // (`playDisabled` gates it only while paused) and the kept `preview` object
    // still draws on stage through `busy`/`isClosing` (`previewShown`) — the R3 #1
    // no-blank-on-interruption behaviour.
    //
    // The DROPPING stop, for two reasons. There is never a scroll position at
    // stake here — what sounds while a take is paused is the whole-clip preview
    // (#101), a different buffer, so the one-shot is not set — and this is an
    // EFFECT: the freezing stop closes over `length`, which would re-run this on
    // every cut, paste and undo and stop a playback nobody asked it to stop.
    useEffect(() => {
      if (paused) return;
      previewGenRef.current++;
      previewDecodeRef.current = false;
      stopPlaybackDroppingPan();
    }, [paused, stopPlaybackDroppingPan]);

    const onRecordButton = useCallback(() => {
      if (closing.current || !view) return;
      // A take supersedes a #317 drag that owes playback a resume (George R1 P2
      // #3). The control is dead while a finger owns the stage, but a tap in
      // the same frame as the pointer-down is ahead of that render — and the
      // lift must not then sound over the mic this tap is starting. Cleared for
      // pause and resume too: any transport action means the translator has
      // moved on from the gesture.
      resumeAfterDragRef.current = false;
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

    // Play the in-memory WORKING buffer from the centerline on (D3/D4, #317):
    // the segment's
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
        stopPlayback();
        return;
      }
      // Idle: sound the working buffer FROM THE CENTERLINE (#317, via
      // `playPlan` — see its derivation for why the rest position still plays
      // the whole segment). `soundRange` pins the playhead's coordinate to the
      // range it sounds; the stage scrolls that position under the line
      // (#415), so nothing seeds a travelling overlay on this path anymore.
      if (!paused) {
        if (playPlan === null) return;
        soundRange(playPlan.range.start, playPlan.range.end);
        return;
      }
      // A paused-take preview sounds a DIFFERENT buffer (the merged take, #101)
      // from its own frame 0, drawn whole with the travelling overlay over it —
      // so it keeps the zero offset it always had.
      soundingOffsetRef.current = 0;
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
    }, [
      audio,
      editor,
      paused,
      playPlan,
      preview,
      previewState,
      soundRange,
      stopPlayback,
    ]);

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
        stopPlayback();
        return;
      }
      if (!idleEditable || !playPlan) return;
      soundRange(playPlan.range.start, playPlan.range.end);
    }, [audio, playPlan, idleEditable, soundRange, stopPlayback]);

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
      stopPlayback();
      setMenuOpen(false);
      // No live/paused take: edit the stored/edited working buffer as before (#89).
      // The gate only offers Edit with a take while recording or paused, so nothing
      // else reaches the commit branch below.
      if (!(recording || paused)) {
        cancelPreview();
        setSelectionEntry({ samples: editor.working });
        setMode("edit");
        return;
      }
      // A live or paused take: commit it, then reopen in edit mode on the committed
      // audio. `closing.current` is the shared "a commit is in flight" latch, so a
      // Back tapped during this cannot double-commit the same take.
      if (closing.current) return;
      closing.current = true;
      setIsClosing(true);
      // The guard above already proved `recording || paused` to reach here.
      setCaptureClosing(true);
      // Abort any in-flight preview decode, then drop the preview's PCM but keep its
      // peaks on stage through the commit — exactly the pair `close()` runs, so a
      // first take does not blank while it saves.
      abortPreview();
      setPreview((p) =>
        p ? { buffer: new Int16Array(0), peaks: p.peaks } : p
      );
      void (async () => {
        const result = await audio.stopRecording();
        // The SAME four-way reading of a stop result `close()` takes, by calling
        // the same function rather than by a comment claiming the two agree
        // (#180). What each verdict MEANS here is different — this path stays and
        // opens edit mode where `close()` exits — but which verdict it is must
        // never differ, and the precedence (samples, then kept bytes, then the
        // error) is the part that was lost once.
        const verdict = classifyCapture({
          samples: result.samples,
          bytes: result.blob,
          error: result.error,
        });
        if (verdict.kind === "take") {
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
            verdict.samples,
            insertionOffset.current,
            finishedIntent === true
          );
          dirty.current = true;
          if (!saved) {
            // Take the SAME exit `close()`'s capture path takes: it always reaches
            // `onExit(dirty)` after the save (`executeTail`, once the take is
            // committed), so App clears `recorder` and the recovery screen owns
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
          supersededCapture.current = false;
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
          setSelectionEntry({ samples: next.samples });
          setMode("edit");
          return;
        }
        // No usable audio. The classifier already applied close()'s precedence: a
        // decode failure whose captured bytes survived (#165/#106) is the take's
        // ONLY copy, so "hold" wins over "notice" and a superseded stop (bytes
        // kept, error withheld) cannot fall through and silently drop it. Only an
        // empty/silent capture is a "notice", and it stays in record mode to
        // retry. Neither enters edit mode.
        if (verdict.kind === "hold") {
          // Route to the recovery panel (re-decode on a fresh gesture, or share
          // off-phone); do NOT onExit and do NOT enter edit mode. Retry/discard/
          // share live there. Unlike close()'s identical branch, mark this recovery
          // as Edit-initiated so a successful Try again reaches edit mode instead
          // of exiting to Segments — the take was committed to be EDITED (#134),
          // and the recovery is a detour, not a Back (George R3 P2 #1).
          setHeldTake(verdict.bytes);
          enterEditAfterRecover.current = true;
          setHeldShareError(null);
          setHeldRetryError(null);
          setHeldShared(false);
          cancelPreview();
          closing.current = false;
          setIsClosing(false);
          return;
        }
        if (verdict.kind === "superseded") {
          supersededCapture.current = true;
        }
        if (verdict.kind === "notice") {
          setStopError(verdict.error);
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
      stopPlayback,
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
    // Erase), and opening it inerts the sheet AT IDLE — so Play, the only stop
    // control, goes unreachable, and Erase locks a confirm behind that scrim
    // (George R5). Mid-take the sheet is no longer inert (#75, the rule at the
    // sheet `<div>`), so Play is reachable there and this stop is belt rather
    // than the only exit; at idle — which is every path that reaches Erase or
    // Edit — it is still the whole of the guarantee.
    // Stopping here closes that whole class at the boundary, like entering edit.
    // `abortPreview` extends it to an in-flight decode: without it, a decode that
    // resolves while the menu is up would start the preview behind the inert scrim
    // with no reachable stop (George R2 #1). It keeps a prepared preview so the
    // stage does not blank behind the menu and Play can replay it on close.
    const openMenu = useCallback(() => {
      // Remember the ≡ that was tapped, HERE — synchronously, in the gesture's
      // own handler (#97). One React commit later the sheet goes `inert`, which
      // blurs this button to `<body>` in the mutation phase, before any effect
      // could read it; #96's attempt captured that `body` and its restore was a
      // silent no-op for every menu in the app.
      focusRestore.capture();
      stopPlayback();
      abortPreview();
      setMenuOpen(true);
    }, [abortPreview, focusRestore, stopPlayback]);

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
      // mode no longer explains. This is also most of what makes "a record never
      // starts over an audition" true, together with record-mode Record being
      // disabled while a buffer sounds.
      //
      // It is not quite EVERY route, and the exception is worth naming rather
      // than leaving for a later author to trip over (George R5 P3): the
      // permission panel's `onRetryRecord` also sets record mode, and it neither
      // stops playback nor closes the frame. It is not a hole today — it is
      // reachable only while `denied`, which requires `!hasAudio`, and with no
      // audio there is nothing to audition and Select is disabled — so nothing is
      // added there for a state that cannot occur. If that gate ever widens, this
      // is the sentence that says so.
      stopPlayback();
      editor.closeSelection();
      setZoom(ZOOM_WHOLE);
      // The zoom's view pan is edit-only, exactly as the zoom itself is. The
      // `viewPan` gate already makes it inert here (mode leaves "edit"), so this
      // only drops a value that can no longer be read — but leaving it set would
      // make the next edit session's behaviour depend on the last one's.
      setZoomPan(null);
      setMode("record");
      setMenuOpen(false);
    }, [editor, stopPlayback]);

    // Zoom, keeping the picked span on screen (#91).
    //
    // Changing the zoom alone shrinks the window around a pan that has nothing
    // to do with the span being edited, so the selection walks off the viewport
    // — the first external tester read that as the control acting on the
    // selection rather than on the view. `panForZoom` answers where the pan has
    // to be for the span to survive the change; the geometry is pure and lives
    // in `lib/audio/viewport` with the rest of the window math, tested there.
    //
    // It writes `zoomPan`, never `panState`: this is a view fit, and `panState`
    // is the record insertion offset (see `viewPan`). With no selection open
    // there is nothing to keep in view and the pan is left alone entirely, so a
    // plain zoom behaves exactly as it did before.
    const onToggleZoom = useCallback(() => {
      const next = zoom === ZOOM_WHOLE ? ZOOM_QUARTER : ZOOM_WHOLE;
      const span = editor.selectionActive ? editor.selection : null;
      if (span !== null) {
        setZoomPan(panForZoom(length, pan, next, CENTER_FRACTION, span));
      }
      setZoom(next);
    }, [zoom, editor.selectionActive, editor.selection, length, pan]);

    // Every edit action stops an audition first (#284), through the ONE stop path
    // the sheet already uses (`stopBuffer`, a no-op when nothing is sounding).
    // The reason is not tidiness: a cut, a paste, an undo or a redo
    // rematerialises `working`, and the sounding view is a window onto the buffer
    // as it was — audio the segment no longer contains, under a waveform that has
    // already changed shape, with a playhead travelling over samples that moved.
    // Moving the span the audition was OF is the same class.
    // A handle drag moves the span the audition is OF, so it silences it too.
    // `stopBuffer` returns immediately when nothing is sounding, so this costs a
    // predicate per pointermove, not a stop.
    const onSelectionChange = useCallback(
      (range: SampleRange) => {
        stopPlayback();
        editor.setSelection(range);
      },
      [editor, stopPlayback]
    );

    // Undo and Redo REMATERIALISE `working` from the edit log, so they stop
    // playback WITHOUT freezing a position in it (George R1 P2 #2): a sample
    // index measured in the buffer that was sounding names different audio in
    // the one that comes back, and unlike a cut there is no mapping to repair
    // it with in that stop path — the mapping happens below instead.
    //
    // ...and they used to drop the pan that was ALREADY there unconditionally
    // (George R3 P1-1, then #449): a hand-set pan whose audio did not move
    // under the undone/redone op is lost the same way a playback freeze's was.
    // `editor.undo()`/`editor.redo()` now return the op they stepped over, and
    // `panAfterUndo`/`panAfterRedo` map the pan through its inverse/forward
    // effect rather than dropping it — see their docblocks in
    // `recorder-stage.ts` for why this subsumes the round-3 P1 case too.
    // `length` is the PRE-step closure value (#473's same note): the mappers
    // derive the restored length from the op rather than needing the caller
    // to re-read `editor.workingLength`, which has not advanced yet inside
    // this same callback.
    const onUndo = useCallback(() => {
      stopPlaybackDroppingPan();
      const undoneOp = editor.undo();
      if (undoneOp !== null) {
        setPanState((p) => panAfterUndo(p, undoneOp, length));
      }
    }, [editor, stopPlaybackDroppingPan, length]);

    const onRedo = useCallback(() => {
      stopPlaybackDroppingPan();
      const redoneOp = editor.redo();
      if (redoneOp !== null) {
        setPanState((p) => panAfterRedo(p, redoneOp, length));
      }
    }, [editor, stopPlaybackDroppingPan, length]);

    const onCut = useCallback(() => {
      stopPlayback();
      const removed = editor.cut();
      // Keep the centerline on the same audio: a cut before it shortens the
      // buffer to its left, so shift an absolute pan by what was removed
      // (George R5), through the rest rule (#473) — a cut that runs to the
      // end must not leave `panState` holding the number `newLength` instead
      // of the F7 rest, or a later Paste/Record punches into the pasted
      // audio. A null/resting pan already follows the new end. `length` is
      // the PRE-cut closure value; `panAfterCutRest` derives the post-cut
      // length from `removed` itself.
      if (removed !== null) {
        setPanState((p) =>
          p === null ? null : panAfterCutRest(p, removed, length)
        );
      }
    }, [editor, stopPlayback, length]);

    // Paste inserts at the recording offset, never the selection or zoom-fit
    // pan. The marker is hidden while a fitted view would imply another point.
    const onPaste = useCallback(() => {
      stopPlayback();
      editor.paste(insertionPan);
    }, [editor, insertionPan, stopPlayback]);

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
    const isErasing = erase.isErasing;
    const onConfirmErase = useCallback(() => {
      // Stop any buffer playback before the delete: EraseConfirm latches its
      // in-flight guard synchronously and the sheet is inert, so Play — the only
      // stop control — is unreachable across the whole IDB write (George R5).
      // Reaching the confirm already goes through `openMenu`, which stops it; this
      // is the belt to that suspenders, and matches the Segments list's leave().
      stopPlayback();
      void (async () => {
        const result = await erase.erase(segmentId);
        // "ok": success unmounts this sheet; the working buffer and any pending
        // edits go with it, which is the point. "failed": keep the sheet, drop the
        // confirm, show the notice. "busy": a double-tap's refused second call —
        // ignore it, the first call still owns the dialog (else the confirm would
        // vanish mid-erase, exposing Back and its save path over the delete).
        if (result === "ok") onExit(true);
        else if (result === "failed") {
          // A failed erase leaves the take on disk, so this is not a loss — but
          // it goes through the same `clearSegmentTake`, so once the database is
          // unreachable it fails identically every time, and the confirm's
          // notice would invite a retry that cannot land (George R6 P2). Exit
          // with `false`: nothing changed, and the panel takes the screen.
          if (failureExit("erase", databaseUnreachable) === "exit")
            onExit(false);
          else setConfirmOpen(false);
        }
      })();
    }, [erase, segmentId, onExit, stopPlayback, databaseUnreachable]);

    /**
     * Reopen the sheet at idle with the reason in place, rather than exiting on
     * audio that cannot be recorded again.
     *
     * Shared by every stay-open exit — a stop error, a failed clear, a failed
     * finished write — which were three copies of the same four statements. It
     * drops the kept preview so the stage reverts to `working` rather than a
     * whole-clip preview with no insert line (George R4 #1).
     */
    const stayOpen = useCallback(
      (reason: string) => {
        setStopError(reason);
        cancelPreview();
        closing.current = false;
        setIsClosing(false);
      },
      [cancelPreview]
    );

    // The no-capture commit tail, shared by `close()` (when nothing was captured)
    // and `leaveHeldTake` (the recovery-panel exit). ONE path for both halves of
    // the session work an exit still owes — a pending B5 edit AND a pending
    // Finished toggle — so a recovery exit can never drop one of them again (the
    // root of the class George raised as R2 B-4, the edits half, and R4-G1, the
    // flag half; Seth's round-5 direction).
    //
    // It no longer DECIDES which of them is owed: `planPendingWork` does, in
    // `lib/takes/close-plan.ts`, enumerated in Node (#180). What is left here is
    // the effects, and the `TailPlan` type is what keeps the two in step — the
    // gates the callers used to thread in as `committed`/`attemptedCapture`
    // booleans are now expressed by which plan they hand over. Returns whether
    // it exited (false keeps the sheet open on a write failure, with the reason
    // in place).
    const executeTail = useCallback(
      async (plan: TailPlan): Promise<boolean> => {
        // Shared by idle Back and held-take discard. Do not let either turn a
        // superseded Edit-commit into a delayed write against the old take.
        if (supersededCapture.current) {
          onExit(dirty.current);
          return true;
        }
        try {
          switch (plan.action) {
            case "clear": {
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
                // Terminal once the database cannot be reopened. An empty-buffer
                // save does NOT go through the never-lose slot — it calls
                // `clearSegmentTake` and returns false — so nothing reaches
                // `pendingTake`, `SaveFailed` cannot mount, and the panel cannot
                // either while this sheet is up. Staying would leave "Could not
                // clear the audio. Try again." over a call that can never
                // succeed, on a screen whose only exit is the Back that just
                // failed (George R6 P2). Nothing is lost by leaving: the clear
                // never committed, so the original take is still on disk.
                if (failureExit("clear", databaseUnreachable) === "exit") {
                  onExit(dirty.current);
                  return true;
                }
                stayOpen(strings.clearFailed);
                return false;
              }
              dirty.current = true;
              break;
            }
            case "save-edit":
              // A non-empty edit replaces the audio through the same never-lose
              // machinery a recording uses (owned slot → App recovery on failure),
              // so its boolean is not branched on here. It demotes an approved
              // segment to draft unless re-marked, and the mark rides the write.
              await saveEditedSegment(segmentId, editor.working, plan.finished);
              dirty.current = true;
              break;
            case "mark":
              try {
                await setFinished(plan.finished);
              } catch (cause) {
                // The store rejects a finished mark on a segment with no take — a
                // take deleted externally between toggle and close. Surface it
                // (F5-#1) rather than only the console, and stay open.
                console.error("Could not change the finished flag", cause);
                // Same trap as the clear above, over a flag rather than audio.
                if (failureExit("mark", databaseUnreachable) === "exit") {
                  onExit(dirty.current);
                  return true;
                }
                stayOpen(strings.finishedWriteFailed);
                return false;
              }
              break;
            case "close":
              break;
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
        setFinished,
        stayOpen,
        onExit,
        databaseUnreachable,
      ]
    );

    /**
     * What this session still owes when no take is being committed — read at the
     * moment of the exit, never from a stale closure.
     *
     * Both no-capture exits (`close()` from idle, and `leaveHeldTake`) build it
     * the same way, so the pending edit and the pending toggle cannot be seen
     * differently by the two of them.
     */
    const pendingWork = useCallback(
      () => ({
        hasEdits: editor.hasEdits,
        workingLength: editor.workingLength,
        finishedIntent,
        storedFinished: view?.finished ?? null,
        // What the STORE will accept a Finished mark on, not what the checkbox
        // offered: `setSegmentFinished(true)` throws with no active take, and
        // the sheet's only answer to that throw is to stay open with the box
        // disabled. `hasClip` is the view-layer proxy (it follows the clip
        // resolving, so a dangling take reads false — deliberately).
        hasTake: view?.hasClip ?? false,
      }),
      [editor, finishedIntent, view]
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
      const erasing = isErasing();
      if (overlayBlocksClose(menuOpen, confirmOpen, erasing)) {
        // Dismiss the overlay the Back landed on — but NOT the erase-confirm while
        // its delete is in flight (Frank R4-1): clearing `confirmOpen` mid-erase
        // un-inerts the sheet, exposing Record, whose new capture the erase's
        // `onExit` then discards. Let the erase's own completion tear the confirm
        // down. The sheet's gate is now `overlayUp && !takeActive` (#75), not
        // `confirmOpen` alone — but `overlayUp` folds in `erase.erasing`, and an
        // erase is only ever reachable at idle, so R4-1 still holds exactly.
        const dismiss = overlayDismissal(menuOpen, confirmOpen, erasing);
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
      stopPlayback();
      return (async () => {
        // Commit on close (F8): if the mic is live or paused, stop it, then
        // splice what it captured into the segment's audio. `stopRecording`
        // releases the mic and never rejects; `saveRecording` never rejects and
        // turns a failure into the recovery screen App renders.
        // A take was in play at close (live, paused, or an interruption froze it to
        // processing). Its stop can be SUPERSEDED — a leave()/pagehide bumped the
        // generation mid-flush — returning no samples, no kept bytes and no error.
        // B4 just closed then, original intact. B5 must keep that: a superseded
        // capture must NOT persist the pending edits, or a cut-to-empty would clear
        // the original recording (gone) with the replacement never landed and the
        // cut audio only in RAM on the clipboard — unrecoverable field loss
        // (George R5). Since #211 the same applies to the Finished toggle, which
        // used to be the one write that still went through here: that close now
        // writes NOTHING. Both halves of the rule live in `planClose`, where they
        // are enumerated rather than commented.
        //
        // `capture` null below means no capture was attempted, which is the same
        // question `attemptsCapture(state)` answers — so the plan reads one input,
        // not two that can disagree. `recording || paused || state === "processing"`
        // was that predicate spelled out; `attemptsCapture` is the same three states,
        // enumerated over the whole of `RecorderState` in `tests/close-plan.test.ts`.
        const attemptedCapture = attemptsCapture(state);
        // Still synchronous (no `await` above this line since `setIsClosing(true)`
        // ran) — batched into the same render `isClosing`'s own update triggers.
        // An edit-only or Finished-only close reaches this function too (Frank
        // R-resume, round 3): without this, `liveScopeShown` could not tell that
        // close apart from an append/first-take commit and would mount a
        // `LiveScope` with nothing in its ring to paint — a blank canvas for the
        // whole IndexedDB write.
        setCaptureClosing(attemptedCapture);
        let capture: CaptureOutcome<Blob> | null = null;
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
          capture = {
            samples: result.samples,
            bytes: result.blob,
            error: result.error,
          };
        }
        // Which of the exits this close takes is decided in ONE place, enumerated
        // in `tests/close-plan.test.ts` (#180). At most one of save-take /
        // save-edit / clear / mark happens: a committed take already carries the
        // pending edits (its splice base is the edited buffer, Model A) and already
        // carries the finished mark (applied atomically in `addTake`, so a separate
        // write cannot be clobbered by the same close's demote-to-draft).
        const plan = planClose({ capture, ...pendingWork() });
        switch (plan.action) {
          case "save-take":
            // The Finished mark rides the take (applied atomically in addTake, on
            // this attempt or a retry). The boolean saveRecording returns is
            // deliberately not branched on here: on a failure App shows the recovery
            // screen and the mark is preserved in the held take, so close() has
            // nothing left to decide.
            // The splice base is the WORKING buffer, not the loaded clip: any
            // cut/paste this session came first (Model A) and must be part of what
            // the recording splices into. insertionOffset was captured against the
            // same working length.
            await saveRecording(
              segmentId,
              editor.working,
              plan.samples,
              insertionOffset.current,
              plan.finished
            );
            dirty.current = true;
            // A committed take owes nothing else, so the tail only has to exit —
            // and it exits through the SAME `onExit(dirty)` every other path takes.
            return executeTail({ action: "close" });
          case "hold":
            // The decode FAILED but the captured bytes survive (#165) — the take
            // exists only here. Hold them and hand the body to the recovery panel
            // (re-decode on a fresh gesture, or share the bytes off the phone),
            // never a bare Notice that drops the only copy. Do NOT onExit: leave()
            // would close silently on a take that cannot be recorded again.
            setHeldTake(plan.bytes);
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
          case "stay":
            // The stop yielded no usable audio, no bytes worth keeping, AND has
            // something to say — an empty or silent capture. Its cause travels WITH
            // the result, not the async `error` state a render closure here would
            // read one frame stale (the round-4 regression that reopened the
            // permission panel). A toolbar Notice (not the permission panel — this
            // is not a permission miss), and re-enable so Back or Record works. Do
            // NOT onExit.
            stayOpen(plan.error);
            return false;
          // Persist any pending edit and Finished flag, then exit — the shared
          // no-capture tail (`leaveHeldTake` runs the SAME one, George R4-G1 root).
          // Spelled out rather than defaulted, so a new `ClosePlan` action cannot
          // reach the tail silently: it would have no case, and the switch would
          // stop satisfying the `Promise<boolean>` return.
          case "clear":
          case "save-edit":
          case "mark":
          case "close":
            return executeTail(plan);
        }
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
      // `recording` and `paused` are gone from here: they are `state ===`
      // derivations (see their declarations above), and `attemptsCapture(state)`
      // now asks the same question of the one input they were derived from.
      // Deliberately not a line number — this file moves under every recorder
      // lane, and a stale citation is worse than none.
      state,
      audio,
      stopPlayback,
      saveRecording,
      editor,
      segmentId,
      onExit,
      abortPreview,
      cancelPreview,
      pendingWork,
      executeTail,
      stayOpen,
      menuOpen,
      confirmOpen,
      isErasing,
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
              supersededCapture.current = false;
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
              setSelectionEntry({ samples: next.samples });
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
      // Same seam as Share Chapter / Share Book (#336): inside the Capacitor
      // shell the WebView may expose no `navigator.share` at all, and this panel
      // is the last-resort escape for bytes that would otherwise be lost (#165)
      // — the one path that must not dead-end in the APK. The route is chosen
      // synchronously, so the web branch below still calls `navigator.share`
      // inside this gesture's activation; the native branch needs none (the
      // chooser is started by the plugin, not the WebView).
      const route = selectShareRoute(readShareEnvironment(), file);
      if (route === "unsupported") {
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
      // On native this stages the file into the cache and then opens the
      // chooser; the panel shows `sharing` throughout, and Discard is blocked
      // for the whole window (George R5 P1). An async IIFE runs to its first
      // await, and on the web branch that IS `navigator.share`, so the tap's
      // activation is intact there.
      const handedOver = (async () => {
        if (route !== "native") {
          await navigator.share({ files: [file] });
          return;
        }
        const staged = await nativeShare.stage(file);
        await nativeShare.send(staged);
      })();
      void handedOver.then(
        () => {
          heldSharingRef.current = false;
          setHeldSharing(false);
          // Rescued off the phone. Offer a Done exit even though the decode never
          // succeeded (George R1 G1 / Frank F2): the app is no longer a dead end.
          //
          // ONLY where the resolve proves it, which on native ANDROID it does
          // not (George stand-in R4 P2, see `resolveProvesDelivery`): a chooser
          // dismissed with Back after the activity stopped resolves as success,
          // and `Done` is a SINGLE tap that drops the only copy of this
          // recording. So there the panel stays "held", the two-tap Discard
          // stays the only exit, and the share sheet itself was the feedback.
          // Native iOS resolves only on a completed share (#381), so it gets
          // Done like the web does. Losing an exit is recoverable; losing the
          // take is not.
          setHeldShared(resolveProvesDelivery(route, readSharePlatform()));
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
      // during the commit must not run the tail twice — plus the busy gate the
      // panel's Discard control renders from (George R5 P1). `sharing` joined it
      // because a native share writes the file to cache BEFORE the chooser
      // opens: seconds of awaits with this panel live, in which two taps used to
      // destroy the only copy of the take mid-write.
      if (
        heldTakeIsBusy({
          retrying: heldRetryingRef.current,
          sharing: heldSharingRef.current,
        }) ||
        closing.current
      )
        return;
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
      // The comment above is literal: this runs the SAME no-capture tail as an
      // edit-only close. The capture that produced `heldTake` already stopped
      // (and failed to decode) before this ran; `heldTake` clearing to `null`
      // here is what lets the ordinary recorder-stage (and `liveScopeShown`)
      // render again underneath, so it must not be told a capture is live.
      setCaptureClosing(false);
      void executeTail(planPendingWork(pendingWork()));
    }, [executeTail, pendingWork]);

    // The sheet's landing on OPEN: its first focusable, which is the header
    // Back. Open-edge ONLY. An earlier draft shared this with the recovery
    // edge (#199) on the argument that a resolved panel leaves the sheet in
    // the state a fresh open does — but the two edges are not alike: open is
    // not mid-task, recovery is. A keyboard/switch user whose "Try again" had
    // just succeeded was landed on "Close recorder", with the very next
    // Space/Enter/switch-activate armed to `close()` — which SAVES. That is
    // the #97 hazard `use-focus-restore.ts`'s contract forbids ("the landmark
    // must never be a destructive or exiting control"), reintroduced on
    // exactly the users #199 exists for (George R1 P2 on #457).
    const focusSheet = useCallback(() => {
      sheetRef.current?.querySelector<HTMLElement>("button")?.focus();
    }, []);

    // The safe landmark for every mid-task hand-off: the "More actions" (≡)
    // control, resolved by its accessible NAME through `overlayFallbackLabel`
    // (`lib/a11y/focus-restore.ts`) and never by position — so it can only
    // ever resolve to the ≡ or to nothing, never to Back or the "Editing"
    // pill. Shared by the overlay restore and the panel recovery below, which
    // are the two edges that hand focus back into a sheet the translator is
    // still working in. `null` when the ≡ is not rendered, AND `null` when it
    // is natively `disabled` — an earlier draft promised the second half in
    // this comment and returned the disabled node anyway (George R3 P2-2 on
    // #457): `.focus()` on a disabled button is a silent no-op, and
    // `use-focus-restore.ts`'s `hasFallback` checks connectivity, not
    // `disabled`, so both callers "succeeded" with focus on <body> and the
    // next Tab on header Back. Both `null`s leave focus alone, the contract's
    // own "prefer `null` over anything dangerous". Native `disabled` only,
    // the same idiom that hook uses for the trigger: an `aria-disabled`
    // control keeps its place in the Tab order (#135), and the ≡ has no
    // `hint`, so `Control` sets the native attribute for it. The ≡'s
    // `disabled` expression is `!view || isClosing || denied ||
    // heldTake !== null`; a panel resolving clears `denied` / `heldTake`, and
    // the recovery effect below is what copes when the rest has not cleared
    // on the same commit.
    const menuLandmark = useCallback((): HTMLElement | null => {
      const sheet = sheetRef.current;
      if (!sheet) return null;
      const buttons = Array.from(sheet.querySelectorAll<HTMLElement>("button"));
      const labels = buttons.map(
        (button) => button.getAttribute("aria-label") ?? ""
      );
      const target = overlayFallbackLabel(labels, strings.recorderMenuOpen);
      if (target === null) return null;
      const menu =
        buttons.find(
          (button) => button.getAttribute("aria-label") === target
        ) ?? null;
      if (menu === null) return null;
      if (menu.hasAttribute("disabled")) return null;
      return menu;
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
    // open state kills the frame rather than reacting a frame later, and
    // `onRetryRecord` drops the latch, so a Retry that succeeds cannot resurrect a
    // drawer the translator never re-opened.
    const menuShown = menuOpen && !denied;

    // …and DROP the latch on the denied edge, rather than only masking it
    // (#151). Masking alone leaves a live `menuOpen` that anything clearing the
    // mic error un-hides, and one thing does: `pagehide` → `use-audio-session`'s
    // `leave()` (:682) → `cancelRecording()` → `use-recorder`'s `cancel()` →
    // `setError(null)` (:956) → `micError` false → `denied` false → `menuShown`
    // true again. Returning to the page then shows the ≡ drawer over an idle,
    // empty segment that nobody opened. The two exits that DO drop the latch —
    // Retry (`onRetryRecord`) and Back (which unmounts the keyed sheet) — are
    // not on that path.
    //
    // Adjusted during render, the pattern React documents for deriving state
    // from a changed input, NOT in an effect: this repo's ESLint refuses
    // `setState` inside an effect ("cascading renders"), which is what pushed
    // #139 into the Retry handler in the first place. It also kills the frame
    // instead of reacting a frame later, exactly as `menuShown` above does.
    // `denied` is true from the first render on a device with no MediaRecorder,
    // and `prevDenied` seeds from it, so an unsupported device sees no edge.
    const [prevDenied, setPrevDenied] = useState(denied);
    if (denied !== prevDenied) {
      setPrevDenied(denied);
      if (denied) setMenuOpen(false);
    }

    // Any overlay owns the screen: the ≡ menu, the erase confirm, or the erase
    // itself still committing after the confirm flag was cleared out from under
    // it. One flag, because these chain within a single `inert` scope and both
    // the inert gate below and the focus restore have to see the CHAIN, not the
    // individual dialogs.
    const overlayUp = menuShown || confirmOpen || erase.erasing;

    // The bottom-bar Edit control's own gate (#315 round 1, George P2-2) — the
    // toolbar-only surface-availability check the sheet `inert` exemption below
    // does NOT cover.
    //
    // The exemption on `.recorder-sheet` (`inert={(overlayUp && !takeActive) ||
    // undefined}`, below) keeps the WHOLE sheet body reachable to AT during a
    // live/paused take with the ≡ menu open — the sheet's own comment there
    // states the consequence is "exactly Record/Pause and Play". The toolbar
    // Edit control is a body sibling of those two, and `editReason` is null
    // while `hasTake` (#134) — so without this it is a THIRD control the sheet
    // exemption newly exposes: reachable to VoiceOver/switch scanning one step
    // past Play, under the visual scrim, while the menu's OWN Edit row is the
    // correctly-scoped in-overlay affordance for the identical action.
    //
    // `editReason` alone must not gain a `menuShown` clause — that would split
    // the #134/#135 gate the ≡ row and this control otherwise share verbatim.
    // Instead the toolbar copy ORs in `menuShown` on top of the shared reason.
    const editToolbarDisabled = editReason !== null || menuShown;
    // Keep the blocked reason reachable to keyboard and switch users without
    // painting an alert badge for an empty segment or a starting microphone.
    // The commit Notice already explains uncommitted-take; its menu-specific
    // "Close menu" hint does not describe this toolbar.
    const editHint = rowHint(editReason);
    const editToolbarHint =
      editReason === "uncommitted-take" || editHint === null
        ? null
        : { label: editHint.label };

    // A full-body panel owns the sheet body — the permission panel, the
    // load-error panel or the held-take recovery (#165) — and has `autoFocus`ed
    // its own control. Read by all three focus effects below.
    const panelOwnsFocus = denied || loadError !== null || heldTake !== null;

    // Land focus inside the sheet on open (mirror Menu), so a keyboard/switch/AT
    // user is not stranded on the now-`inert` list behind the modal. Mount-only —
    // App keys the sheet on segmentId, so it remounts per open and per segment.
    //
    // UNLESS a panel already owns the first commit. An earlier comment here
    // said the permission panel "autofocuses its own Retry when it later
    // appears, which is after this has run" — true for the async mic path
    // (Record is gated on `view`), false for `!audio.supported`:
    // `isRecordingSupported()` is a synchronous first-render fact, so on a
    // WebView with no `MediaRecorder` the first paint IS `PermissionPanel`.
    // React's commit focused its Retry, then this passive effect ran
    // `focusSheet()` — the sheet's first `button`, header Back — and the next
    // Space/Enter/switch-activate was armed to `close()`: the #97 hazard the
    // recovery effect keeps off its edge, applied on the open edge to the users
    // the panel is for (George R3 P2-1 on #457). So the open edge yields when a
    // panel owns the FIRST commit, read through a `useRef` snapshot of that
    // render's value: `panelOwnsFocus` is deliberately NOT a dependency, since
    // re-running on the panel resolving would land on Back — the recovery
    // defect round 1 closed. The recovery edge stays `menuLandmark`'s.
    const panelOwnsFocusAtMount = useRef(panelOwnsFocus);
    useEffect(() => {
      if (panelOwnsFocusAtMount.current) return;
      focusSheet();
    }, [focusSheet]);

    // Put focus back where the overlay took it from, AFTER `inert` has lifted
    // (#97). A layout effect, not the close handler and not a passive one: React
    // removes the `inert` attribute in the mutation phase, layout effects run
    // straight after that, and an element in an inert subtree cannot take focus
    // — so a `.focus()` any earlier is dead code, the exact shape
    // `docs/progress_tracker.md` warns about and #364 shipped again today.
    //
    // Keyed on `overlayUp`, so the menu → confirm chain restores ONCE, to the ≡
    // that started it. `restore` is a no-op with nothing captured, so the
    // re-runs the other dependencies cause are harmless.
    //
    // `suppressed` when a full-body panel owns the screen: each `autoFocus`es
    // its own control in the same commit, and stealing that back would strand a
    // screen-reader user off the Retry they were just handed. The capture is
    // consumed either way, so it can never fire late.
    useLayoutEffect(() => {
      if (overlayUp) return;
      // HOLD the capture through the commit window rather than spending it
      // (George R1 P1 residual). Mid-commit the header's right-hand control is
      // `disabled` and the mode may be about to flip, so there is no stable
      // landing yet; an early return leaves the capture untouched and this
      // effect runs again when `isClosing` clears. Distinct from `suppressed`,
      // which CONSUMES because somebody else has taken focus for good.
      if (isClosing) return;
      focusRestore.restore({
        suppressed: panelOwnsFocus,
        // The overlay-close landmark is the "More actions" (≡) control itself
        // — deliberately NOT the sheet's first focusable, which is Back
        // (George R1 P1), and NOT "the header's last button" either (George R5
        // P2): that was correct in record mode, where the header's right-hand
        // control IS the ≡, but wrong in edit mode, where that slot is the
        // "Editing" pill — a control that EXITS edit mode. Landing overlay-
        // close focus there would arm the very next Space/Enter/switch-
        // activate to leave, the #97 hazard on the ordinary Edit row.
        //
        // The ≡ is safe in every mode: it reopens the very overlay that just
        // closed, and this app renders it under the same accessible name in
        // both places it lives (the header in record mode, the toolbar in
        // edit mode). `menuLandmark` above resolves it by that name, never by
        // position, so it can only ever resolve to the ≡ or to nothing —
        // never to Back or the pill.
        fallback: menuLandmark(),
      });
    }, [overlayUp, isClosing, panelOwnsFocus, focusRestore, menuLandmark]);

    // The OTHER half of `panelOwnsFocus` (#199). The effect above suppresses
    // itself while a full-body panel is up, because each panel `autoFocus`es
    // its own control — correct, but it leaves the SUCCESS edge unowned: a
    // "Try again" that works unmounts `LoadErrorPanel` with focus on the
    // control that has just gone away, and the mount effect above cannot help
    // because it is mount-only (App keys the sheet on segmentId). The Segments
    // list behind is `inert`, so focus fell to <body> and the next Tab reached
    // the header Back.
    //
    // A LAYOUT effect, for the ordering reason `lib/a11y/focus-restore.ts`
    // documents: React removes the unmounted panel in the mutation phase, and
    // an element cannot take focus until its ancestors are out of an inert
    // subtree — a passive effect would also work here (the sheet itself is
    // never inert on this edge) but the two focus effects in this file should
    // not run in different phases for no reason.
    //
    // The previous-commit value lives in a ref written INSIDE the effect, never
    // at render time: a render-time `ref.current = x` is exactly what
    // `react-hooks/refs` exists to catch, and AGENTS.md records that this
    // file's own `catch (cause)` shapes can silence that rule (#212).
    const panelOwnedFocus = useRef(false);
    useLayoutEffect(() => {
      const action = panelRecoveryFocus({
        ownedLastCommit: panelOwnedFocus.current,
        ownsNow: panelOwnsFocus,
        closing: isClosing,
      });
      // `hold` changes NOTHING — not focus, and not the history below. That is
      // the whole point of the third value (QA review P2 on #457): a close can
      // fail and leave this sheet mounted (`leaveHeldTake` → `executeTail` →
      // `stayOpen` resets `isClosing`), and writing the ref on the closing
      // commit would spend the pending recovery before that landed, stranding
      // focus on <body> — the #199 defect reached through the failure path.
      // Same lesson, and the same wording, as the overlay restore above: hold
      // through the commit window rather than spending it. A sheet that really
      // does exit never renders again, so unmounting consumes the hold and
      // nothing has to spend it explicitly.
      if (action === "hold") return;
      // The ≡, NOT `focusSheet()`: that is header Back, and Back is `close()`
      // — see `menuLandmark` for why the open edge may land there and this
      // edge may not (George R1 P2 on #457).
      if (action === "focus") {
        const landmark = menuLandmark();
        // No landmark — the ≡ is not rendered, or is still natively
        // `disabled` on this commit (`!view` or `isClosing` may outlast the
        // panel; `menuLandmark` returns `null` rather than an unfocusable
        // node, George R3 P2-2 on #457). Same lesson as `hold`: do nothing
        // AND remember nothing, so `ownedLastCommit` stays true and a later
        // commit on which the ≡ is enabled can still recover. Writing the
        // ref here would spend the recovery on a landing that never
        // happened, with focus left on <body>.
        if (landmark === null) return;
        landmark.focus();
      }
      panelOwnedFocus.current = panelOwnsFocus;
    }, [panelOwnsFocus, isClosing, menuLandmark]);

    const markReason = markRowReason({
      hasView: view !== null,
      takeCommitting: isClosing || busy,
      starting,
      canFinish: finishedState !== "disabled",
    });

    // Whether the record stage's `LiveScope` branch is what's mounted below —
    // named once so the ternary reads as a decision, not an inline predicate.
    const liveScope = liveScopeShown({
      recording,
      paused,
      processing: state === "processing",
      // `isClosing` alone is not enough (Frank R-resume round 3): it is also
      // true for an edit-only or Finished-only close, which never had a mic to
      // show. `captureClosing` narrows it to the close that actually followed
      // a capture — see its own docblock above.
      isClosing: isClosing && captureClosing,
      hasAudio,
      meterFailed: audio.meterFailed,
      previewShown: previewShown !== null,
    });

    return (
      <div
        className="recorder-scrim"
        role="dialog"
        aria-modal="true"
        // #198 / #164 R-19. Every sibling dialog (menu, erase confirm, save
        // failed, the database panel, the error boundary) carries a name; this
        // one did not, so it announced as an unnamed dialog. A static label,
        // not `aria-labelledby` pointing at the breadcrumb below: the
        // breadcrumb renders "" until `view` resolves, and a name that is
        // sometimes empty is the same gap with an extra step.
        aria-label={strings.recorderDialog}
      >
        {/* THE INERT RULE (#75). An overlay inerts the sheet because nested
          aria-modal dialogs do not reliably hide the background for AT/switch
          users — G8 already refused to trust that on the Segments list — and
          without it an AT user could reach the covered Record while the menu is
          up and mutate the splice base under a Redo (George R4). `erase.erasing`
          is folded in alongside `confirmOpen` so the sheet stays inert across
          the whole erase even if the confirm flag is cleared out from under it
          (Frank R4-1).

          But an overlay never inerts the transport of a take that is ALREADY
          RUNNING. A translator mid-take must be able to stop the capture, and a
          drawer they opened for the level strip is not a reason to take that
          away. Hence `&& !takeActive` here — plus the HEADER's own `inert`
          below, which holds under any overlay and is what keeps the exemption
          down to the transport rather than the whole sheet (George R2 P2).

          The header is excluded because of its Back, whose accessible name is
          "Close recorder" — and while an overlay is up `close()` does not close
          the recorder: `overlayBlocksClose` makes it dismiss the overlay and
          resolve false (:1136). Mid-take, with the sheet no longer inert, that
          control would be newly reachable to AT under a name that promises a
          save it will not perform, so a translator who activated it to stop and
          save would leave the mic hot believing they had stopped. That is the
          #97 hazard with the sign flipped — Back SAVING when it should not,
          versus Back announcing a save it does not do — and the spoken name is
          the contract, not this comment. The menu's own Close is the correctly
          named dismiss, and it is right there. The ≡ goes inert with it: it is
          in the header, and re-opening an already-open menu is a no-op.

          What is exempt is therefore exactly Record/Pause and Play — plus one
          MORE sheet-body control since #315, the toolbar Edit button, which
          this exemption would otherwise ALSO expose (it sits beside Play with
          no `inert` of its own) but which disables itself instead — see the
          last bullet below. The exemption is a scoping, not a hole, because of
          what `takeActive` implies here:

          - `overlayUp && takeActive` can only be the ≡ menu in RECORD mode. The
            edit-mode opener is `disabled` on `isClosing`, and the Erase row
            (the only door to the confirm) is `disabled` on `takeActive`.
          - A take cannot START under an overlay: the confirm and the menu are
            only reachable at idle or mid-take, and at idle this gate is still
            inert, so Record is unreachable and `takeActive` cannot flip true.
            The exception is a fixed point, not a race.
          - What that leaves live behind the scrim is the transport and nothing
            else: Record/Pause and Play. Every buffer mutator is out of reach
            anyway — the paste marker, Cut, Select, Undo/Redo and the selection
            handles all require `idleEditable` or edit mode, both false while a
            take is live — and the header is inert in its own right.
          - The toolbar Edit control (#315) is NOT part of this exemption, even
            though `editReason` alone would allow it during a live/paused take
            (#134's commit-then-edit). It carries its own `menuShown` clause
            (`editToolbarDisabled`, above `menuShown`'s declaration) precisely
            so this scoping stays true — George R1 P2-2 caught that without it,
            the exemption silently grew a THIRD reachable control, one that
            FINALIZES the take (`onEnterEdit`'s commit) where Pause would have
            kept it resumable. The ≡ menu's own Edit row is the correctly-scoped
            in-overlay affordance for the identical action.
          - Play mid-take is the paused preview, and it is its own stop: this is
            the one case George R5's "Play goes unreachable behind the scrim"
            does not apply to, and `openMenu` still stops playback for the idle
            case that it does.
          - Back is NOT live: see the header's own gate above. The system Back
            still reaches `close()` through the imperative handle and still
            dismisses the overlay there (:1136) — that path is unchanged, and it
            carries no misleading name because it is a gesture, not a control.

          WHAT THIS ACTUALLY REACHES, stated narrowly because the first draft of
          this comment overclaimed it (George R1 P2). `inert` governs the
          accessibility tree and the focus/pointer tree, so what the exemption
          restores is the AT path: VoiceOver's rotor and swipe, and a switch
          device that scans the a11y tree, can reach Pause again. It does NOT
          restore the other two:

          - TOUCH is owned by the scrim, not by `inert`. `.menu-scrim` is
            `position: fixed; inset: 0; z-index: 80` (`3-components.css:295`),
            so a finger anywhere outside the panel lands on it and dismisses the
            menu — the extra gesture #75 describes, unchanged.
          - TAB is owned by `Menu`'s focus trap (`menu.tsx:121`), which wraps Tab
            inside the panel on the premise that nothing behind it is reachable.
            That premise is now false mid-take, but the trap is unchanged, so a
            keyboard or Tab-driven switch user still cannot Tab to Pause. Escape
            (or Close menu), then Pause, is their path — one keystroke, not a
            deadlock. Letting Tab leave the panel mid-take, or putting the
            transport in the menu, is tracked in #369; it changes a shared
            component and does not belong in this lane. */}
        <div
          ref={sheetRef}
          className="recorder-sheet mx-auto max-w-md"
          inert={(overlayUp && !takeActive) || undefined}
        >
          {/* The other half of the rule above: the header is inert under ANY
            overlay, `takeActive` or not, so the transport exemption cannot
            expose a Back whose name ("Close recorder") is not what `close()`
            would do while an overlay is up (George R2 P2). Redundant at idle,
            where the sheet is already inert — deliberately so: this gate states
            the header's own invariant rather than depending on the sheet's. */}
          <header
            className="flex items-center gap-[8px] px-[4px] py-[2px]"
            inert={overlayUp || undefined}
          >
            <Control
              icon="back"
              label={strings.closeRecorder}
              variant="quiet"
              // Disabled while a decode-failed take is held (#165): the bytes exist
              // only in `heldTake`, so a Back here would be the exact loss this
              // recovery exists to prevent. The panel's Try again / Share / two-tap
              // discard are the only ways out until the take is recovered or rescued.
              // (The system Back is refused in `close()` for the same reason.)
              // Also frozen through the close window (`isClosing`), matching the
              // record-mode menu opener (:disabled ... || isClosing) and the Editing
              // pill: while `close()`'s stop -> decode -> save is in flight the sheet
              // is still up, and a second Close tap here is the only issuer in the
              // HEADER of a `goBack` during `requestClose`; LoadErrorPanel's and
              // PermissionPanel's Back stay live through the close window and are
              // covered by the absorb branch. This is the ms-window that would force
              // the commit-close settle's refused-re-arm absorb (use-nav-stack.ts,
              // the `beginBack("commit-close")` else-branch). Removing this HEADER
              // trigger is the belt to that branch's suspenders (George R2 P2-1).
              disabled={heldTake !== null || isClosing}
              onClick={onRequestBack}
            />
            <span className="text-ink min-w-0 flex-1 truncate">
              {view
                ? strings.recorderBreadcrumb(
                    view.bookName,
                    view.chapterNumber,
                    view.ordinal
                  )
                : ""}
            </span>
            {mode === "record" ? (
              // The menu opener lives in the header in record mode (the toolbar
              // is the Record + Play + Edit trio, #315). Same gate the old
              // toolbar opener used — reachable mid-take (Edit commits-then-edits
              // a live/paused take, #134), blocked only through the close window.
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
              <RecorderStatus state={state} isClosing={isClosing} />
              <div className="recorder-stage flex-1">
                {mode === "edit" && (
                  <div className="recorder-paste flex justify-center">
                    {/* Always mounted in edit mode, like `.recorder-cut` below
                      the canvas — only the button inside is conditional
                      (George R1 P2). `.recorder-stage` is a centered,
                      clipping column: an in-flow row that mounts and
                      unmounts (rather than reserving its height) recenters
                      the group underneath it, so the waveform itself would
                      jump on every Select toggle and every no-selection
                      audition once the clipboard is full. Reserving the row
                      keeps the canvas's vertical position stable across
                      those transitions; `.recorder-paste`'s `min-height`
                      carries the reserved space (3-components.css).

                      The drop icon sits above the canvas, clear of the
                      waveform band (#414) — drawn over the band it hid the
                      exact sample the paste lands on. It still reads as
                      centerline-aligned without any positioning math: this
                      row and the canvas below it share the same centered
                      parent, so centering the row here lines up with the
                      canvas's own CENTER_FRACTION=0.5 line, the same way
                      `.recorder-cut` below the canvas already does for the
                      scissors icon. No `stopPropagation` needed on its
                      pointerdown — unlike the old in-canvas placement, this
                      row is a sibling of `.recorder-canvas`, not a
                      descendant, so a tap here can never bubble into the
                      canvas's own pan handler. */}
                    {idleEditable &&
                      editor.canPaste &&
                      zoomPan === null &&
                      !stage.windowControlsInert && (
                        // A zoom-fitted viewport need not be centered on the
                        // insertion point. Reseeding or panning clears that fit.
                        <button
                          type="button"
                          className="paste-marker"
                          aria-label={strings.paste}
                          onClick={onPaste}
                        >
                          <Icon name="paste" size={26} />
                        </button>
                      )}
                  </div>
                )}
                <div
                  ref={stageRef}
                  // `overflow-hidden`: while a buffer sounds the waveform is
                  // drawn on a strip up to five stage widths wide and slid
                  // under the centerline (#415), so the stage has to be the
                  // window that clips it. A utility rather than a rule in
                  // `3-components.css` because the cascade order makes
                  // utilities win, and because nothing else needs to know.
                  className="recorder-canvas overflow-hidden"
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                >
                  {liveScope ? (
                    // The dedicated live scope drives the stage while a take is
                    // ACTIVELY in flight (no preview up) — `liveScopeShown`
                    // (recorder-stage.ts) owns the rule, including the #283 append
                    // case (a 2nd take now grows live instead of waiting for
                    // re-entry). It grows from the head and scrolls R→L (#120),
                    // sidestepping Waveform's `!recorded` dotted rule. `active`
                    // goes false off "recording" (pause/processing/close),
                    // freezing the last frame (R-B6).
                    <LiveScope
                      readScope={audio.readScope}
                      peekScope={audio.peekScope}
                      active={recording}
                      headFraction={CENTER_FRACTION}
                      height={200}
                      label={strings.liveWaveform}
                    />
                  ) : (
                    // Idle / edit / playback, a prepared preview (first take OR
                    // append), and the tap-failed fallback. A preview ALWAYS wins
                    // the stage over the live scope (George R-resume round 2):
                    // `#101` Play-while-paused sounds the merged buffer regardless
                    // of `hasAudio`, so it must be drawn here — with a working
                    // playhead — not left silently behind a frozen live ring. A
                    // live take-in-flight otherwise is NOT here anymore for either
                    // a first take or an append (#283). The #110/#316 centerline
                    // is the fixed overlay below, not a bar in this canvas
                    // (#415), so it covers the existing audio here (or the
                    // dotted first-take rule when the tap failed) without a
                    // capturing flag, not a blank stage (George R1/R2).
                    //
                    // The scroller is what MOVES this canvas while a buffer
                    // sounds: it is one strip, drawn once, translated per frame
                    // under the fixed line (#415). Outside the scroll mode its
                    // width factor is 1 and it holds no transform, so the
                    // canvas sits exactly where it always did.
                    <WaveformScroller
                      active={scrolling}
                      widthFactor={strip ? strip.widthFactor : 1}
                      length={length}
                      visibleSamples={win.visibleSamples}
                      readPositionSample={readPlaybackSample}
                      onPosition={notePlaybackSample}
                    >
                      <Waveform
                        // The paused-take preview draws its own peaks over the whole
                        // buffer (#101); everything else shows the working buffer's.
                        // `recorded` is true whenever there is a waveform to mark —
                        // stored audio, or a prepared preview of a first take. The
                        // centerline itself is no longer suppressed for a sounding
                        // buffer or a swapped view — the requirements owner reversed
                        // both suppressions in #316 (2026-09-16); see
                        // `recorder-stage.ts`'s module docblock for the superseded
                        // George R2 / R4 P3 findings that used to justify hiding it.
                        peaks={previewShown ? previewShown.peaks : editor.peaks}
                        // `200 - pasteRowPx` in edit mode, 200 everywhere else
                        // this branch renders (idle, playback preview, the
                        // tap-failed fallback): edit mode is the only state
                        // that also reserves `.recorder-paste` above and
                        // `.recorder-cut` below (George R2 P2), and without
                        // this the two reserved rows plus an unchanged 200px
                        // canvas grow the centered `.recorder-stage` group from
                        // ~246px to ~296px — clipped under `overflow: hidden`
                        // on a short stage (a `Notice`, a wrapped 320px
                        // toolbar, or a short viewport). Shrinking the canvas
                        // by exactly the paste row's reserved box
                        // (`pasteRowPx`, above) keeps the group at its
                        // pre-#414 height instead, and reading that box off
                        // the same CSS token the row's own `min-height` uses
                        // means the two cannot drift apart (George R3 P3).
                        // Bars scale to whatever height is drawn (`displayGain`
                        // is a fraction of the lane, `waveform.tsx`'s draw
                        // effect reads `height` off its own deps), and
                        // `PlayheadOverlay` stretches `top-0 bottom-0` rather
                        // than assuming a pixel value, so neither needs a
                        // matching change. This is a mode-entry step, not a
                        // per-frame one: `mode` only flips on
                        // `onEnterEdit`/exit, so the reflow happens once,
                        // alongside the toolbar swap, not on every
                        // Select/audition toggle. `WaveformScroller` (#432)
                        // only translates this canvas during playback; it
                        // never touches `height`, so the reservation holds
                        // unchanged whether or not the scroller is active
                        // (round 7 rebase onto #432 — carried the #414 height
                        // fix forward onto the new wrapper, no behavior
                        // change to either).
                        height={mode === "edit" ? 200 - pasteRowPx : 200}
                        recorded={hasAudio || previewShown !== null}
                        // The #358 display fit is suppressed only for a take with
                        // nothing committed behind it — the paused first take
                        // whose decoded preview replaces `LiveScope` above. A
                        // punch-in (`hasAudio`) reaches THIS branch only via the
                        // tap-failed fallback, an idle view, or its own Pause+Play
                        // preview (below) — its live recording is on `LiveScope`
                        // now (#283) — and in every one of those cases it draws
                        // the STORED/merged clip fitted, since `working` does not
                        // grow until the splice at close (George R2 P2). The rule
                        // itself is pure and table-tested in
                        // `lib/audio/display-gain.ts`, not spelled out here.
                        //
                        // `takeActive`, NOT `recording || paused` (George R3 #2 —
                        // the re-run, a distinct finding from the fitFrom fix
                        // above). `previewShown` and `LiveScope`'s mount window are
                        // both gated on the WHOLE take-in-flight span — recording,
                        // paused, `processing` (#59), and the `isClosing` F8
                        // stop→decode→save wait, during which `stop()` has already
                        // flipped `state` to idle. Gating this flag on
                        // `recording || paused` alone let it go false the moment
                        // Back was tapped on a paused first-take preview: the same
                        // peaks stayed on stage (`previewShown` is still set) but
                        // suddenly read as fitted, jumping the preview from thin to
                        // full height under the Saving notice — the exact
                        // quiet-mic-looks-healthy failure this flag exists to
                        // prevent, on the one window it was built for.
                        // `hasAudio` still gates the punch-in case unchanged: once
                        // there is committed audio, `isFirstTakeInFlight` is false
                        // regardless of `takeActive`, so George R2 P2 stands. An
                        // append's own Pause+Play preview is deliberately included
                        // in that "committed audio" case too (George R-resume round
                        // 2): it draws FITTED to the committed clip's own gain via
                        // `fitFrom` below, not absolute — the scale change from the
                        // `LiveScope` it replaces is an intentional consequence of
                        // an explicit Play tap (reviewing the take), not the
                        // involuntary "did I lose it" edge this flag prevents.
                        firstTakeInFlight={isFirstTakeInFlight(
                          takeActive,
                          hasAudio
                        )}
                        // Fit to the COMMITTED clip always, even on the punch-in
                        // Pause+Play branch above where `peaks` switches to
                        // `previewShown.peaks` (the merged buffer, insert
                        // included). Without this the gain re-derives from
                        // whatever the insert's level happens to be, and a louder
                        // insert shrinks the stored speech that filled the lane a
                        // moment earlier — then Resume, which clears the preview,
                        // pops it back (George R3 P2). When there is no preview
                        // this is the same array as `peaks`, so idle and a first
                        // take are unaffected.
                        fitFrom={editor.peaks}
                        view={waveView}
                      />
                    </WaveformScroller>
                  )}
                  {/* The fixed centerline (#110/#316, #418) — extracted into
                    its own component (#513, dev lead's cap pick,
                    issuecomment-5742347381) so the gate
                    (`centerlineOverlayShown`, `recorder-stage.ts`) and the
                    element it gates cannot drift apart the way a JSX `&&`
                    condition and its child could. See
                    `centerline-overlay.tsx`'s own docblock for the full
                    history. */}
                  <CenterlineOverlay
                    mode={mode}
                    selectionActive={editor.selectionActive}
                    liveScope={liveScope}
                  />
                  {/* The playback playhead, a pull-model DOM overlay (#102): it
                    polls `readPlaybackPosition` on its own rAF and moves a line,
                    so buffer playback re-renders neither this sheet nor the
                    inert list behind it. Mounted always; it hides itself when
                    nothing is sounding. Its fractions read `waveView`, which
                    switches to the whole merged-preview buffer the moment one is
                    prepared (`wholeView`) — correct here because a preview always
                    puts `Waveform` on stage (above), never `LiveScope`, so this
                    overlay's coordinate system always matches what is drawn
                    underneath it (George R-resume round 2). `clampToEdge` is the
                    one exception to "off `waveView` ⇒ hide": an in-place
                    audition keeps the pan window, so a picked span wider than
                    it is real, still-sounding audio walking off-screen, not the
                    blank head/tail the hide rule exists for (#284, George R7).

                    `active` is OFF in the scroll mode (#415): there the red
                    centerline IS the playhead and the waveform moves under it,
                    so keeping this one up is the two-lines screenshot the issue
                    was filed from. It stays up for the two states where the
                    view does NOT follow the sound — a paused-take preview and
                    an in-place audition — which are the only ones left where a
                    travelling marker is the cue. */}
                  <PlayheadOverlay
                    readElapsedMs={readSoundingElapsed}
                    active={audio.playingBuffer && !scrolling}
                    durationMs={drawnDurationMs}
                    startFraction={waveView.startFraction}
                    endFraction={waveView.endFraction}
                    clampToEdge={stage.render === "inPlace"}
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
                </div>
                {mode === "edit" && (
                  <div className="recorder-cut flex justify-center">
                    {/* The Cut affordance sits under the frame (mockup 4). Cutting
                      reseeds the frame and makes the clipboard available. Edit-mode
                      only — the block is absent from the record-mode tree — but
                      still `disabled` on the same `idleEditable` safety: without
                      it a Cut tapped during the async close would mutate the
                      working buffer after close() already captured the pre-cut
                      one — a silently dropped edit.

                      `heldByDrag` is the same #317 stage lock Undo/Redo carry
                      (#512 George R1 P2-1): `onCut` writes `panAfterCutRest`
                      into `panState`, and a finger still down from a stage
                      drag keeps writing `onPointerMove`'s
                      `panAfterDragMove(panAtDragStart, …)` afterwards — a
                      PRE-cut origin against the POST-cut length, clobbering
                      the cut's own write. Cut does not clear `dragging` on
                      its own, so the gate is what has to. */}
                    <Control
                      icon="scissors"
                      label={strings.cut}
                      variant="quiet"
                      size={26}
                      disabled={heldByDrag(
                        dragging,
                        !idleEditable || !editor.canCut
                      )}
                      onClick={onCut}
                    />
                  </div>
                )}
                {(recording || paused) && (
                  <div
                    className="recorder-status flex items-center gap-[8px]"
                    role="status"
                  >
                    <span className={cn("text-live", recording && "rec-dot")}>
                      <Icon name="record" size={14} />
                    </span>
                    <span className="t-timer">
                      {formatDuration(audio.elapsedMs)}
                    </span>
                  </div>
                )}
              </div>

              {mode === "record" && (
                // Under the waveform (mockup 3), unconditional in record mode —
                // the menu row that used to hide it is gone (#286: "until we
                // have an input level control, it's just confusing" was the
                // control, not the strip). Record-mode only — no mic take can
                // exist in edit mode. `active` gates its own rAF loop, so it
                // only animates while a take is live and rests empty otherwise —
                // the sheet never re-renders per frame (D-LEVEL-PULL: it polls
                // `audio.readLevel` on its own clock).
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
                // Both modes reserve the same right-hand slot for the toggle.
                <div className="recorder-toolbar pair grid items-center px-[16px]">
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
                    // This is a gate on the INSERTION OFFSET, not button
                    // chrome, so the rule is enumerated in `recordDisabled`
                    // and tested in both directions rather than inlined here
                    // (George R1 P2 #3). Two states it must catch, and the one
                    // it must not:
                    //
                    // - a buffer sounding at idle — under the scrolling view
                    //   (#415) the drawn line marks the SOUNDING sample while
                    //   `panState` is still the pre-play value, and under a
                    //   whole-clip preview it marks nothing in the working
                    //   buffer at all. Either way a take would splice where the
                    //   translator cannot see. (This used to be explained as a
                    //   swapped whole-clip view lying about the line; since
                    //   #415 the line is honest during playback and it is the
                    //   stored pan that is stale. The gate is the same either
                    //   way — do not "correct" it into an enable.)
                    // - a finger mid-pan (#317): the touch that pauses playback
                    //   lifts the sounding term while the drag is still moving
                    //   the pan, so a second finger here would lock the offset
                    //   to a position that then slides away from it.
                    // - PAUSED is the exception: this button is Resume, its
                    //   offset was locked at the original Record tap (F9), and
                    //   resuming stops a sounding preview and continues the
                    //   take, so it must stay live (George R3 #4).
                    disabled={recordDisabled({
                      busy,
                      isClosing,
                      hasView: view !== null,
                      playingBuffer: audio.playingBuffer,
                      paused,
                      dragging,
                    })}
                    onClick={onRecordButton}
                  />
                  <Control
                    icon={audio.playingBuffer ? "pause" : "play"}
                    // The name comes from `playPlan.source`, the same map the
                    // edit toolbar uses, because since #317 this control plays
                    // from the LINE and not always the whole segment (George R2
                    // P2). Speaking "Play recording" over a tap that sounds
                    // only the tail is a lie told to the one channel — a screen
                    // reader — that cannot see the line. `"whole"` is the F7
                    // rest and the line at 0, where it IS the whole segment;
                    // `"selection"` is unreachable here (`playPlan` reads the
                    // span in edit mode only) and falls through to the same
                    // name rather than adding a branch that cannot run.
                    label={
                      audio.playingBuffer
                        ? strings.stopPlayback
                        : playPlan?.source === "line"
                          ? strings.auditionFromLine
                          : strings.playRecording
                    }
                    variant="play"
                    disabled={playDisabled}
                    onClick={onPlayButton}
                  />
                  <Control
                    key="edit-toggle"
                    icon="selection"
                    label={strings.enterEdit}
                    pressed={false}
                    variant="default"
                    busy={isClosing}
                    disabled={editToolbarDisabled}
                    hint={editToolbarHint}
                    onClick={onEnterEdit}
                  />
                </div>
              ) : (
                // Edit mode: the spread editing toolbar. Redo is a visible button
                // here (out of the menu); the menu opener lives at the end.
                <div className="recorder-toolbar edit grid items-center px-[16px]">
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
                        : playPlan?.source === "selection"
                          ? strings.auditionSelection
                          : playPlan?.source === "line"
                            ? strings.auditionFromLine
                            : strings.playRecording
                    }
                    variant="quiet"
                    size={24}
                    // Inert when there is nothing to hear — no audio, or a span
                    // dragged shut — exactly as Cut is on the same span. While it
                    // sounds it is the stop, so it stays live. `idleEditable`
                    // carries the close window, where the sheet is committing;
                    // `heldByDrag` carries the #317 finger (George R2 P1),
                    // which cannot co-occur with `playingBuffer` because the
                    // touch stops playback before the drag begins.
                    disabled={heldByDrag(
                      dragging,
                      !audio.playingBuffer &&
                        (!idleEditable || playPlan === null)
                    )}
                    onClick={onAuditionButton}
                  />
                  <Control
                    // The magnifier carries the ACTION (+ widens, − narrows) and
                    // `pressed` carries the STATE — quarter view is the non-
                    // default one, so that is the "on". Splitting the two is the
                    // #91 fix: the old facing-arrow pair asked one glyph to do
                    // both, and the first external tester read it the other way
                    // round and asked whether the icons were reversed.
                    //
                    // Both read `displayedZoom`, not `zoom` (#284, George R7),
                    // and what that buys has NARROWED since #417 (George R4
                    // P3). `wholeView` is `render === "whole"`, which
                    // `stageView` now answers for a prepared preview only — a
                    // sounding buffer scrolls at the real zoom, which is #417's
                    // whole point, so during playback `displayedZoom` IS
                    // `zoom`. The one window that claim was false in was the
                    // CLOSE window (#396): a leftover paused-take preview can
                    // outlive the edit gate while `close()` is committing, put
                    // `wholeView` up with a SILENT buffer (so `windowControls-
                    // Inert` is false), and stand this control up drawing the
                    // whole chrome over a handler that flips the real `zoom`.
                    // `!idleEditable` on `disabled` below is what kills that
                    // — in the windows the control can fire, `wholeView` is
                    // false, so the two values the chrome could name are the
                    // two that are equal.
                    icon={displayedZoom === ZOOM_WHOLE ? "zoom-in" : "zoom-out"}
                    label={
                      displayedZoom === ZOOM_WHOLE
                        ? strings.zoomAtWhole
                        : strings.zoomAtQuarter
                    }
                    pressed={displayedZoom === ZOOM_QUARTER}
                    variant="quiet"
                    size={24}
                    // A window control: it rebuilds the window under a line that
                    // is already travelling. `recorder-stage.ts` carries the class.
                    // `!idleEditable` also gates #396's slack window: a leftover
                    // preview during `isClosing` shows whole-view chrome over the
                    // REAL zoom handler, and a tap there silently flips the stored
                    // zoom with no visible change — see the comment above.
                    disabled={stage.windowControlsInert || !idleEditable}
                    onClick={onToggleZoom}
                  />
                  <Control
                    icon="undo"
                    label={strings.undo}
                    variant="quiet"
                    size={24}
                    // `heldByDrag` is the history half of the #317 stage lock
                    // (George R2 P1): Undo rematerialises `working`, and a lift
                    // still owing a resume would sound a sample index measured
                    // in the buffer that no longer exists.
                    disabled={heldByDrag(
                      dragging,
                      !idleEditable || !editor.canUndo
                    )}
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
                    // mode is idle-only regardless. `heldByDrag` is the #317
                    // finger, for the same reason Undo carries it.
                    disabled={heldByDrag(
                      dragging,
                      !idleEditable || !editor.canRedo
                    )}
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
                  <Control
                    key="edit-toggle"
                    icon="selection"
                    label={strings.enterEdit}
                    pressed={true}
                    // Both twins keep the hinted root so their shared key
                    // preserves the button and focus across the mode switch.
                    hint={null}
                    variant="default"
                    disabled={!idleEditable || dragging}
                    onClick={onExitEdit}
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
                icon="trash"
                label={strings.eraseSegment}
                variant="quiet"
                // Only when there is stored audio to erase (a first, uncommitted
                // recording has nothing on disk yet) AND only at idle: erasing the
                // stored take out from under a live capture is nonsensical, and the
                // menu opener stays reachable mid-take (Edit commits-then-edits a
                // live/paused take, #134), so this entry must refuse there itself
                // (George R-B6). Gate + reason from `eraseRowReason` (#135).
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
      <span className="text-live">
        <Icon name="alert" size={52} />
      </span>
      <p className="t-title text-ink">{message ?? strings.micNeededTitle}</p>
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
      <span className="text-live">
        <Icon name="alert" size={52} />
      </span>
      <p className="t-title text-ink">{strings.loadFailedTitle}</p>
      <p className="text-ink-muted">{strings.loadFailedBody}</p>
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
  // Any operation holding the take disarms the confirmation and blocks Discard —
  // the same predicate the exit guard reads, so the control and the guard cannot
  // fall out of step (George R5 P1).
  const busy = heldTakeIsBusy({ retrying, sharing });
  const showArmed = armed && !busy;
  return (
    <div
      role="alert"
      className="flex flex-1 flex-col items-center justify-center gap-[18px] px-[22px] text-center"
    >
      <span className="text-live">
        <Icon name="alert" size={52} />
      </span>
      <p className="t-title text-ink">{strings.takeRecoverTitle}</p>
      <p className="text-ink-muted">{strings.takeRecoverBody}</p>
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
        // While sharing, swap to the retry glyph (George R4/R5 P3, #384): every
        // OTHER busy `Control` in the app now spins under the shared
        // `[aria-busy="true"]` CSS rule #384 added, and the retry mark is the
        // one that rule's motion is meant to animate — spinning the idle share
        // glyph instead reads as a stuck tray, not a wait. The idle mark is
        // the platform's own (#490), the same one the share menus draw.
        icon={sharing ? "retry" : shareControlGlyph(readSharePlatform())}
        label={sharing ? strings.takeRecoverSharing : strings.takeRecoverShare}
        variant="quiet"
        // Disabled mid-retry (George R1 G7): the OS share sheet would re-interrupt
        // the shared context the retry just resumed.
        disabled={retrying}
        // State in place, because on the native route the chooser does NOT open
        // in this gesture — the file is written to cache first, which on a long
        // take is seconds of nothing (George R5 P1). Without this the panel looks
        // untouched and the translator reaches for Discard.
        busy={sharing}
        onClick={() => {
          setArmed(false);
          onShare();
        }}
      />
      {/* The busy Notice, not just the relabelled control (George R6 P2):
          `Control` is icon-only, so its `label` is the accessible name and
          never paints. Without this the panel's only visible change during the
          native cache write — seconds on a long take — is that Try again and
          Discard go dim, which reads as a broken screen rather than as work in
          flight. Same shape Try again above already uses. */}
      {sharing ? (
        <Notice tone="busy">{strings.takeRecoverSharing}</Notice>
      ) : shareError ? (
        <Notice>{shareError}</Notice>
      ) : null}
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
          className={showArmed ? "text-live" : undefined}
          disabled={busy}
          onClick={() => (showArmed ? onDiscard() : setArmed(true))}
        />
        {showArmed ? (
          <p className="text-live text-[12px]">
            {strings.takeRecoverDiscardHint}
          </p>
        ) : null}
      </div>
    </div>
  );
}
