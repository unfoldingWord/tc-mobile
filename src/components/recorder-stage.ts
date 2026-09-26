/**
 * The record stage's one branch, lifted out of the JSX so it can be tested in
 * Node without a canvas (#283). It decides whether the dedicated {@link
 * LiveScope} drives the stage, or the {@link Waveform} path does.
 *
 * `LiveScope` is a pull-model drawer that grows the take-in-flight from the head
 * (#120) and, when frozen (`active` false), holds its last frame; `Waveform`
 * draws stored/preview peaks with the #110 record centerline. The rule below is
 * the whole reason the two coexist.
 */

import { panAfterCut } from "@/lib/audio/viewport";
import { wholeSampleRange } from "@/lib/audio/edit";
import type { EditOp } from "@/lib/audio/edit-log";

/** The record-stage inputs this decision reads, all already-derived booleans. */
export interface StageState {
  /** `state === "recording"` — the mic is actively capturing. */
  recording: boolean;
  /** `state === "processing"` — a #59 interruption's decode, or an F8 decode. */
  processing: boolean;
  /**
   * The commit window (`stop()` flipped to idle, PCM not yet in `working`)
   * — but ONLY when the commit followed an actual capture (recording, or a #59
   * `processing` freeze). Since #614 that is the Stop tap's own commit as well
   * as Back's and Edit-entry's; they run one path.
   *
   * The recorder's own `isClosing` state does NOT mean that by itself: the
   * same `close()` handler, and the same flag, cover an edit-only or
   * Finished-only exit too (Frank R-resume, round 3) — there is no mic
   * involved, and `LiveScope` has nothing in its ring to paint, so mounting it
   * during that wait leaves a blank canvas for the whole IndexedDB write
   * instead of the stored/edited waveform. The caller must narrow its own
   * `isClosing` to a capture-close before passing it here (`recorder.tsx`'s
   * `captureClosing` state, ANDed in at the call site); this module has no
   * other way to tell the two closes apart, and this field's own name stays
   * `isClosing` because a caller that already narrowed it should not have to
   * rename what it is narrowing (George R-resume round 3 P3: an earlier draft
   * of this comment named a `captureClosingRef` that was converted to state
   * before this landed).
   */
  isClosing: boolean;
  /**
   * `length > 0` — the segment already holds audio, so this take is an append.
   *
   * **Not** read by {@link liveScopeShown}. The first #283 fix gated the
   * frozen arm on it, which made an append SWAP `LiveScope`→`Waveform` at the
   * recording→commit edge: `Waveform` paints in `useEffect`, so the stage
   * flashed blank then showed the pre-take clip (the take is not spliced into
   * `working` until the commit lands), reading as "that discarded my take" —
   * the "read as discarded" class the first-take `isClosing` clause exists to
   * prevent (George R1 P2). Reverted there; kept as an input so the tests can
   * pin that prior audio never changes the recording/frozen-arm outcome.
   */
  hasAudio: boolean;
  /** The mic tap could not be wired — no live scope data to draw. */
  meterFailed: boolean;
}

/**
 * Whether the dedicated live scope (vs. the `Waveform` path) drives the record
 * stage.
 *
 * - A failed tap always wins the stage — there is no live scope data to draw.
 * - Otherwise the live scope drives the **whole take-in-flight window**
 *   (recording, processing, and the commit) for a first take **and an append
 *   (#283)**, growing while `recording` and freezing on its last frame
 *   otherwise. Before #283 an append fell to `Waveform` for the whole take, so a
 *   second take showed the VU moving but no waveform growing until the segment
 *   was left and re-entered.
 *
 * Since #614 that window ENDS at the commit rather than parking in a paused
 * state: the tap that stops a recording runs the commit, so the frozen arm
 * covers only `processing` and the commit itself, and the stage is back on
 * `Waveform` — pannable, playable, editable — the moment the take lands.
 *
 * `hasAudio` is intentionally absent from the logic — see {@link StageState}.
 * Treating an append exactly like a first take is both the behaviour #283 asked
 * for ("the same way it renders during the first take") and what avoids the
 * pause/close swap-and-flash that gating the frozen arm on `hasAudio` caused.
 *
 * Swapping to the live scope no longer hides the existing clip (#640): the
 * scope draws it too, before the insertion offset to the left of the new audio
 * and after it from the head on (`LiveScope`'s `context`,
 * `lib/audio/capture-context.ts`). That composition lives in the drawer, not
 * here, so this rule stays the single mount decision it was.
 */
export function liveScopeShown(s: StageState): boolean {
  if (s.meterFailed) return false;
  return s.recording || s.processing || s.isClosing;
}
/**
 * The recorder stage's view-coupled decisions, in one place (#284).
 *
 * The waveform is drawn one of FOUR ways — through the pan/zoom window, as a
 * strip scrolling under the centerline, in place under a travelling line, or as
 * the whole clip — and half a dozen controls and overlays are only correct
 * under some of them. Review rounds kept finding the same defect wearing a new
 * hat: the paste marker pinned at 50% of the stage while the canvas drew clip
 * fractions 0..1 and pasted at the end instead (R3); zoom rebuilding the window
 * under a travelling playhead (R3); Select seeding a span around a centerline
 * that had been hidden, so it highlighted the end of the take rather than the
 * word being heard (R4, George); the playhead's own off-screen HIDE rule,
 * written for a swapped view's blank head/tail, firing instead on real audio
 * that had simply outgrown an in-place audition's unswapped window (R7,
 * George). Repetition is a class, and the class-level answer is to derive the
 * question once rather than gate each consumer by hand.
 *
 * A decision that used to live here, `centerlineHidden`, ran from R2
 * (whole-clip playback) through R4 P3 (in-place audition) until #316
 * (requirements owner, 2026-09-16: "having the line always visible is important
 * in segment record/edit mode") retired it — the line was never suppressed, in
 * any state. #418 (the requirements owner, via a tester report) reopened it
 * with exactly one exception: a selection span loaded in edit mode gives the
 * line no playback role at all (the audition sounds only the picked span —
 * #284, `recorder.tsx`'s `onPaste`-adjacent audition split), so it is drawn
 * inside the span it does not describe. {@link centerlineOverlayShown} is
 * that one exception (plus the unrelated `liveScope` term — see its own
 * docblock), not a return of the old multi-state hide rule. Since #415 the
 * line is not painted into the canvas at all: a strip that translates would
 * carry a painted line with it, so it is a fixed element on the stage
 * (`recorder.tsx`'s centerline overlay), mounted wherever the `Waveform` path
 * is on stage. `LiveScope` still draws its own record head during capture.
 *
 * Pure and DOM-free so the truth table is a test rather than a phone.
 */

interface StageInput {
  readonly mode: "record" | "edit";
  /** A buffer is sounding — a record-mode play or an edit-mode audition. */
  readonly playingBuffer: boolean;
  /** The selection frame is open (its band is drawn through the pan window). */
  readonly selectionActive: boolean;
  /**
   * A pointer is mid-pan on the stage. It does not change WHAT is drawn — a
   * drag pans the static window — only what may act on it while the gesture is
   * in flight. See {@link StageView.windowControlsInert}.
   */
  readonly dragging: boolean;
}

/**
 * The three ways the recorder stage can be drawn.
 *
 * ONE value rather than a bag of booleans (#415): the questions the stage used
 * to answer separately — "in place?" and "does the waveform scroll?" — are
 * answers to the same question, and a bag can disagree with itself in a way an
 * enum cannot. A fourth, `"whole"`, drew the #101 paused-take preview at clip
 * fractions 0..1; #614 retired the preview with the paused take, and with it
 * the one render mode in which the pan meant nothing.
 *
 * - **`static`** — nothing is sounding: the pan/zoom window, as panned.
 * - **`scroll`** — a sounding buffer that is the working buffer sounded from
 *   the centerline (record-mode Play, and edit-mode Play with no span picked).
 *   The clip is drawn on a strip at the current zoom and translated so that the
 *   sounding sample stays under the fixed red line — #415's model, and #417's
 *   "Play works at whatever zoom is current".
 * - **`inPlace`** — an audition of a PICKED span (#284). The window stays put,
 *   because the band and its handles are positioned through it and hearing
 *   exactly the span they mark is the point; the travelling overlay is the cue,
 *   clamped at the window's edges rather than hidden.
 */
type StageRender = "static" | "scroll" | "inPlace";

interface StageView {
  /** How the stage is drawn — see {@link StageRender}. */
  readonly render: StageRender;
  /**
   * Every control that READS OR MOVES the pan/zoom window is inert.
   *
   * **Two owners, not one.** A buffer sounding is the original; a finger
   * mid-pan is the second, added when #317 made a touch the way to pause
   * (George R2 P1). The two are not the same condition and must both be here:
   * the #317 touch STOPS playback before the drag starts, so `playingBuffer`
   * goes false while the finger is still down and the pan is still moving —
   * every control below would have come back to life mid-gesture, each acting
   * on a window that slides out from under it a frame later. A second finger
   * is all it takes, and #61 already treats two fingers as in scope here.
   *
   * The enumeration, so the next reader sees the class rather than a scatter of
   * guards. IN — each is wrong while a buffer sounds, and each is wrong again
   * while a finger owns the stage:
   *
   * - **Zoom**: rebuilds the window around the centerline under a line that is
   *   already travelling, and does nothing visible at all while swapped;
   * - **the paste marker**: drawn centered above the canvas (#414 — no longer
   *   pinned to the centerline's screen position, which used to sit it on top
   *   of the sample it pastes at) but still pastes at `win.centerlineSample`
   *   — under a swapped view that reads as "the middle of the clip" rather
   *   than the pan window's own sample (it is unmounted, not merely disabled,
   *   so the false IMPLICATION goes too);
   * OUT, deliberately — each stays live, and why:
   *
   * - **the edit toggle** (#557): it used to be a separate Select control in
   *   this list, seeding a span around a centerline that could be stale while
   *   a buffer sounded. There is no separate Select now — the frame opens on
   *   entering edit mode and closes on leaving it — and both directions stop
   *   playback first (`onEnterEdit`, `onExitEdit` in `recorder.tsx`). The
   *   seed (`seedSelection`, #554) is measured from the insertion pan, not
   *   from this window;
   *
   * - **the stage pan** (`onPointerDown`/`onPointerMove`): the oldest member of
   *   this class until the requirements owner reversed it for this one gesture
   *   (#317, 2026-09-16): "the moment the finger touches the waveform, playback
   *   PAUSES; the waveform follows the finger; when the finger lifts, playback
   *   resumes from the sample under the centerline. Playback never runs while
   *   the finger is down." That supersedes D4 ("playback is listen-only — no
   *   scrub in v1") for the gesture and nothing else. What made the pan wrong
   *   here was moving a window while a line travelled across it; pausing first
   *   removes that, so the guard is now the pan's own (`recorder.tsx`) and
   *   reads the render mode: a drag takes over a `scroll` playback, and is
   *   still refused under `whole` and `inPlace`, where the view is deliberately
   *   pinned to what is being heard;
   * - **Play/stop itself**: the way out of this state, and the only control
   *   that must never be inert while sounding. It IS inert while dragging, but
   *   by its own term in `recorder.tsx` rather than by this flag, precisely
   *   because this flag is true in the state where Play must stay live;
   * - **Cut**: acts on the visible band, never on the window. It is enabled
   *   only when a span is picked, which is exactly the case that does NOT swap
   *   the view — so what it removes is what is drawn and what was just heard.
   *   Gating it would break the two-tap "hear it, then cut it" flow this whole
   *   issue exists to create;
   * - **Undo/Redo**: history operations that read no window; they stop the
   *   sound before rematerialising the buffer. They too carry their own
   *   `dragging` term, for the reason Play does;
   * - **the selection handles**: they map a pointer through the pan window, but
   *   they are only ever drawn while a span is picked — the one case that keeps
   *   that window — so their mapping is always the one on screen. They stop the
   *   sound on the first move;
   * - **Back, the ≡ menu, the Editing pill**: they leave or suspend this state
   *   rather than acting inside it, and each stops playback on the way.
   *
   * Mode-independent on purpose, as both of its owners are.
   */
  readonly windowControlsInert: boolean;
}

/**
 * How the stage is drawn, and what that makes inert.
 *
 * The order of the branches is the whole decision. A preview outranks
 * everything (it is a different buffer); a picked span outranks the scroll (its
 * band must not slide out from under the audio it marks); every other sounding
 * buffer scrolls under the centerline.
 */
/** What a finger landing on the waveform does. */
type PanGesture =
  /** Not a pan: the stage does not move and playback is untouched. */
  | "ignore"
  /** An ordinary pan, from the drawn pan. */
  | "pan"
  /** A pan that must PAUSE playback first, and resume it on lift (#317). */
  | "interrupt";

interface CaptureLock {
  readonly recording: boolean;
  /** `requesting` or `processing`. */
  readonly busy: boolean;
  /**
   * A commit is in flight: the post-stop save and reload. NOT covered by
   * `busy` — `stop()` sets the recorder back to `idle` before it returns, so
   * the whole multi-second write happens with `busy` false.
   */
  readonly isClosing: boolean;
}

/**
 * Whether a capture or its commit owns the insertion offset right now (#61,
 * F9), and therefore whether the centerline may move.
 *
 * One predicate, two callers, because the window they have to agree on is the
 * same window: `onPointerDown` (through {@link panGesture}) decides whether a
 * finger may START a pan, and `onPointerMove` decides whether a pan already in
 * flight may continue. A term present in one and missing from the other is a
 * pan that cannot begin but can still be finished, which is what George's pass
 * C P1 found: `isClosing` was in neither, and `busy` goes false at `stop()`
 * while `saveRecording` + `reloadView` are still running. With the sheet now
 * STAYING open across that write (#614 — before Option A it closed, so there
 * was no stage to touch), the translator sees a frozen waveform and a
 * "Saving…" notice for a multi-megabyte write, and a finger landing on it
 * panned: the drag origin was the pre-splice end, the commit then wrote
 * {@link panAfterCommit}'s rest, and the next move overwrote that rest with an
 * absolute sample derived from the OLD origin — leaving Record splicing inside
 * the take just saved, so two appends came out in the wrong order.
 *
 * `recordDisabled` already reads the commit as locked. This is the same
 * reading for the gesture.
 */
export function captureLocksPan(input: CaptureLock): boolean {
  return input.recording || input.busy || input.isClosing;
}

interface PanGestureInput extends CaptureLock {
  /** `length > 0` — there is a waveform to slide (F11). */
  readonly hasAudio: boolean;
  /** A buffer is sounding right now. */
  readonly playingBuffer: boolean;
  /** How the stage is drawn — see {@link StageRender}. */
  readonly render: StageRender;
}

/**
 * Whether a finger landing on the waveform pans, and what it owes playback
 * (#317).
 *
 * The requirements owner (2026-09-16): "dragging while playing is fine. The
 * moment the finger touches the waveform, playback PAUSES; the waveform follows
 * the finger; when the finger lifts, playback RESUMES from the sample under the
 * centerline. Playback never runs while the finger is down." That reverses D4
 * ("playback is listen-only — no scrub in v1") for this gesture and nothing
 * else, which is why the answer is three-valued rather than a boolean: a drag
 * that takes over a sounding buffer is a different act from one that starts at
 * idle, and the component has to know which it is holding.
 *
 * The order is load-bearing. The take term comes FIRST: a LIVE mic has locked
 * its insertion offset at the Record tap (#61, F9), and sliding the line out
 * from under it is the defect that guard exists for — stopping a sound would
 * not make that safe. Only then does the sounding buffer decide, and only the
 * scroll mode yields: **`inPlace`** is an audition of a picked span (#284), and
 * the band and its two handles are positioned through the pan window, so
 * panning would slide them off the audio they mark while that audio sounds.
 *
 * **`paused` is gone, and its removal is the whole of #614.** The refusal used
 * to name `paused` beside `recording`, for the same F9 reason: a take could be
 * suspended with its offset still locked, and Resume would continue there.
 * Option A (the requirements owner, 2026-09-22) ends that state — the tap that
 * ends a recording commits it, so a take is either live or committed, and a
 * committed take is ordinary audio the finger may move. What did not change is
 * that the offset stays locked while a capture OR ITS COMMIT is in flight; the
 * terms that say so are {@link captureLocksPan}'s, and `isClosing` is among
 * them precisely because a take is "committed" only once that write lands.
 */
export function panGesture(input: PanGestureInput): PanGesture {
  if (!input.hasAudio || captureLocksPan(input)) return "ignore";
  if (!input.playingBuffer) return "pan";
  return input.render === "scroll" ? "interrupt" : "ignore";
}

interface FrozenPanInput {
  /** The last position the frame loop saw, in samples. */
  readonly observed: number;
  /** The end of the range that was sounding (`soundRange`'s second argument). */
  readonly end: number;
  /** A stop was ASKED for (Pause, a #317 touch, the menu, Back, an edit). */
  readonly stopRequested: boolean;
  /**
   * The clip RAN OUT — reported by the playback boundary itself
   * (`playBuffer`'s `onEnded`), never inferred here. Inferring it is what
   * Frank's round-2 P2 killed: "did the position advance?" cannot see a range
   * shorter than one frame, which ends before any rAF reads a handle.
   */
  readonly ranOut: boolean;
  /** The working buffer's length, for the clamp. */
  readonly length: number;
  /**
   * `observed` came from a REAL playback handle, not from the optimistic
   * pre-start position (George R4 P1).
   *
   * `playBuffer` flips `playingBuffer` true before it starts anything, and the
   * handle settles only after an `await`, a whole-clip AudioBuffer fill and a
   * yielded task — a window that scales with the clip and that `audio-io.ts`
   * yields *in order to make* tap-reachable. Everything that reads a position
   * in that window gets the range's start, because that is the honest visual
   * answer; freezing it is what is not. Read only on the `stopRequested` arm: a
   * run-out is reported by the boundary rather than observed by a frame.
   */
  readonly measured: boolean;
}

/**
 * Where the view is left when a scrolling playback stops — #416's fix, and the
 * answer to Frank's round-1 P2.
 *
 * "Pause only pauses. The waveform and the playhead stay exactly where playback
 * had reached; nothing jumps." The naive reading of that is "freeze the last
 * position the frame loop saw", and it is wrong twice over: the loop's newest
 * value is up to one frame old, and the audio position is gone the instant the
 * handle is cleared. A Pause would rewind by a frame of audio, and a clip that
 * ran out would park the line ~16 ms SHORT of the end — where the next Record
 * INSERTS instead of appending, which is the same class of silent-wrong-offset
 * defect the pan guards exist for.
 *
 * The two endings have different exact answers, so they are told apart:
 *
 * - **Asked to stop** — the caller samples the true position synchronously in
 *   its own handler, before `stopBuffer` clears the handle, so `observed` is
 *   exact and is what freezes.
 * - **Ran out** — no sampling can help (the handle is gone by the time anything
 *   observes it) and none is needed: playback that nobody stopped ended where
 *   the range ends.
 * - **Anything else** — a `playBuffer` that failed to start, or a claim
 *   superseded by something else taking the floor. Neither is an ending with a
 *   position in it, so nothing is written (`"keep"`); see below.
 *
 * Each ending is TOLD to this function. An earlier draft inferred "it ran out"
 * from "did the position advance past the range's start", and Frank's round-2
 * P2 killed that with a range shorter than one frame: a 200-sample remainder
 * ends before any rAF reads a handle, so the heuristic called a completed play
 * a failed one and parked the line at the start of audio that had just been
 * heard in full. `playBuffer`'s `onEnded` is the boundary that knows, and it
 * fires for this ending and no other.
 *
 * **A `"keep"` writes nothing at all** (George R2 P2 #3). An ending that was
 * neither asked for nor reported is not an ending this can place: `playBuffer`
 * flips `playingBuffer` true OPTIMISTICALLY, before `playSamples`, so a throw
 * there (an OOM in `toAudioBuffer`, a failed context resume) takes the flag
 * false again with no `onEnded` — and the only position the frame loop ever
 * read was that optimistic one, the range's START. Writing it is how the
 * default Play from the F7 rest turned into a punch-in at sample 0. A claim
 * superseded by another sound ends the same way and gets the same answer: leave
 * the pan exactly as the translator last set it, which is what it already is,
 * because a play does not write it.
 *
 * Clamped to the clip for `viewportWindow`'s reason: the pan is also the record
 * insertion offset, and there is no inserting before the start or after the end.
 *
 * **`null` when the freeze lands on the end, and that is the point of the
 * `pan` field's type** (George R1 P1). `null` is not "no pan": it is F7's append rest,
 * which `effectivePan` reads as "the end, whatever the end turns out to be", and
 * which `onCut` preserves (`p === null ? null : …`) so a resting line tracks a
 * buffer that changed under it. Freezing the NUMBER `length` there would turn
 * that promise into a stale absolute index — and a clip playing to its end from
 * the rest is the DEFAULT Play, so the very next Paste or Undo would leave the
 * line at the start of the new audio and the next Record would punch into it
 * instead of appending. An absolute sample is kept only when it is strictly
 * inside the clip, where it means one specific place in the audio.
 */
export function frozenPan(
  input: FrozenPanInput
): { kind: "keep" } | { kind: "pan"; pan: number | null } {
  if (!input.stopRequested && !input.ranOut) return { kind: "keep" };
  // A stop before any real position existed is the SAME answer as a failed
  // start, and for the same reason (George R4 P1): the only position anything
  // saw was `playBuffer`'s optimistic one, the range's start. The round-2
  // `"keep"` arm above missed this because it keyed on the two ending flags —
  // here a stop genuinely WAS asked for — rather than on whether the audio
  // layer had ever produced a position to freeze.
  if (!input.ranOut && !input.measured) return { kind: "keep" };
  // Running OUT outranks being stopped when both land in the same turn (George
  // R3's adjacent risk). `onEnded` is a fact about the audio — the clip is over
  // — and a stop arriving after it (a Pause tapped on the last syllable, a
  // close) is a no-op on a clip that has already finished. Taking `observed`
  // there would park a completed play up to one rAF short of the end, which is
  // the #416 defect by a race rather than by a stale ref.
  const reached = input.ranOut ? input.end : input.observed;
  return { kind: "pan", pan: panOrRest(reached, input.length) };
}

/**
 * An absolute sample, or the F7 REST — the one rule, for every writer of the
 * pan.
 *
 * `null` is not "no pan": it is "the end, whatever the end becomes", which
 * `effectivePan` resolves against the CURRENT length and `onCut` preserves. An
 * absolute sample is kept only when it is strictly INSIDE the clip, where it
 * names one specific place in the audio; at the end it would be a stale index
 * the moment anything is pasted or appended, and the next Record would splice
 * into the new audio instead of following it.
 *
 * It started inside {@link frozenPan}, where a clip that ran out had to come to
 * rest rather than park on the number `length`. A DRAG writes the same kind of
 * value and needs the same answer (George R5 P1): a finger that lands during
 * the optimistic window and jitters would otherwise convert the rest into a
 * number without the translator ever asking for a pan.
 */
export function panOrRest(sample: number, length: number): number | null {
  const clamped = Math.max(0, Math.min(sample, length));
  return clamped >= length ? null : clamped;
}

/**
 * Where the centerline comes to rest once an in-place commit lands (#614).
 *
 * Option A makes the tap that ends a recording the tap that commits it, and the
 * sheet stays open on the committed audio. So the line needs a position, and
 * there is exactly one that keeps the requirements owner's condition true
 * ("append by moving the playhead to the end and hitting Record again"): the
 * END of what was just recorded. Tapping Record again then continues from where
 * the last take stopped — an append at the end of the clip, and a continuation
 * rather than a re-insert in front of itself when the take went in mid-clip.
 *
 * Not "leave the pan alone". A mid-clip insert locks its offset at the line, so
 * leaving the line there would put the next Record BEFORE the take just made,
 * and two takes recorded back to back would come out in reverse order. Not "the
 * end of the clip" either: that is right for the common append and wrong for
 * every insert, which is the whole reason this is a computation and not a
 * constant.
 *
 * Through {@link panOrRest}, so an append lands on the F7 REST rather than on
 * the number `length` — the rest follows the end through a later Paste or Undo,
 * where a frozen absolute index would silently become a punch-in (the #442
 * class). An insert is strictly inside the clip and keeps its absolute sample,
 * which is what "one specific place in the audio" means.
 */
export function panAfterCommit(
  /** The sample the take was spliced at — `insertionOffset`, locked at Record. */
  offset: number,
  /** How many samples the committed take added. */
  takeLength: number,
  /** The working buffer's length AFTER the splice. */
  length: number
): number | null {
  return panOrRest(offset + takeLength, length);
}

/**
 * What a drag move on the bare stage writes, and what it hands back for the
 * #317 lift to read (#442).
 *
 * `onPointerMove` used to inline this clamp and forget the rest rule below
 * it — that IS #442: a drag that lands ON the end stored the number `length`
 * instead of the F7 rest, so a later Paste left Record splicing at the OLD
 * end. Lifting the whole computation out means `onPointerMove` has nowhere
 * left to re-derive the clamp by hand and silently drop the `panOrRest` step
 * the way it once did; there is exactly one place this arithmetic lives.
 *
 * Two callers need two different answers from the SAME clamped position, so
 * both come back explicitly rather than computing the clamp twice: `raw` is
 * the numeric sample, unconditionally — `draggedPanRef` stays raw on purpose
 * (the #317 lift's `resumesOnLift` needs to compare it against `length`, and
 * a pre-rested `null` there could never say "the drag reached the end").
 * `pan` is the same position through `panOrRest` — what `onPointerMove`
 * actually persists into `panState`, the record insertion offset.
 */
export function panAfterDragMove(input: {
  /** The pan the drag started from (`onPointerDown`'s `from`, held in `panAtDragStart`). */
  readonly origin: number;
  /** Samples moved since the drag started; negative for a rightward drag. */
  readonly delta: number;
  readonly length: number;
}): { readonly raw: number; readonly pan: number | null } {
  const raw = Math.max(0, Math.min(input.origin + input.delta, input.length));
  return { raw, pan: panOrRest(raw, input.length) };
}

/**
 * What `onCut` writes into `panState` — the cut point, which is where a paste
 * lands (#613), through #442's rest rule (#473).
 *
 * The rule this replaces (`panAfterCutRest`) kept the centerline on the SAME
 * AUDIO across a cut: a span removed to the line's left shifted it left by
 * what went, a span removed under it clamped it to the cut's start. Correct
 * for "the view did not move", and wrong for what the requirements owner
 * asked the state to say (#613): after a cut the band is gone and the one
 * line left on the stage is the paste target, so it has to BE the paste
 * target — the cut point — whatever the pan happened to be before the cut.
 * The two rules already agreed for the commonest cut, the one picked around
 * the line; they differ for a span picked away from it.
 *
 * `preCutLength` is the working buffer's length BEFORE this cut — the
 * caller's own `length` closure, which #473 flags as the one easy thing to
 * get wrong here: `onCut` reads it from a render before `editor.cut()` ran,
 * so it is still the PRE-cut value at the point this runs, and the post-cut
 * length this needs for the rest clamp is `preCutLength - removedLength`,
 * derived from `removed` rather than re-read from `editor` (whose `working`
 * has not re-rendered into this closure yet either).
 *
 * The F7 rest survives the rule change and is the reason this is not a bare
 * `range.start`: a cut that runs to the end puts the cut point exactly AT the
 * new length, and #442 established what a bare numeric `length` in `panState`
 * means — a stale absolute index the moment anything is pasted or appended,
 * where the next Record punches into the new audio instead of following it.
 * {@link panOrRest} answers `null` there, "the end, whatever the end becomes".
 *
 * `removed` is normalised through {@link wholeSampleRange} before EITHER
 * question it answers — the cut POSITION and the removed LENGTH — not just
 * the length: selection edges are floats, and the buffer edit (`cut`/
 * `sliceRange` in `lib/audio/edit.ts`) truncates them via `Int16Array.slice`.
 * A fractional-boundary cut whose raw span disagreed with that truncation
 * left both the rest clamp AND the position a fraction of a sample off the
 * buffer's real post-cut shape (#473 round-2 Frank P2 caught the length;
 * round 3 found the position term was still raw).
 */
export function panAfterCutCollapse(
  removed: { readonly start: number; readonly end: number },
  preCutLength: number
): number | null {
  const range = wholeSampleRange(removed);
  const removedLength = range.end - range.start;
  return panOrRest(range.start, preCutLength - removedLength);
}

/**
 * Where a #317 drag starts when the touch interrupted playback (George R5 P1).
 *
 * The touch pauses playback and the drag continues from where the audio had
 * REACHED — that is #416's promise, and it is why this takes the stop's own
 * sampled position rather than the pan. But `playBuffer` flips its sounding
 * flag before the graph has a handle, and everything reading a position in that
 * window gets the range's START. Honest for drawing; a fiction to build a
 * gesture on.
 *
 * Round 5 gated the FREEZE on that provenance and stopped there. The drag
 * origin is the second rememberer of the same number: `onPointerMove` writes it
 * into `panState` — the record insertion offset — with no movement threshold at
 * all, so a finger's jitter is enough. On the default Play from the rest, where
 * `auditionPlan` sounds the whole buffer from sample 0, that took the line from
 * the end of the take to the first sample and the next Record punched into the
 * first syllable.
 *
 * So an unmeasured interrupt starts from the pan the sheet already had. The
 * touch still STOPS playback — "playback never runs while the finger is down"
 * is not negotiable, which is why this is not the other available fix (answer
 * `"pan"` instead of `"interrupt"` until a handle exists: that leaves sound
 * running under the finger).
 */
export function dragOriginAfterInterrupt(input: {
  /** The stop sampled a position from a real handle. */
  readonly measured: boolean;
  /** What the stop sampled, in samples. */
  readonly reached: number;
  /** The pan the sheet is already drawing (`effectivePan`). */
  readonly pan: number;
  readonly length: number;
}): number {
  if (!input.measured) return input.pan;
  return Math.max(0, Math.min(input.reached, input.length));
}

/**
 * Whether lifting the finger resumes playback (#317).
 *
 * Only a gesture that PAUSED playback resumes it — a pan begun at idle has
 * nothing to resume, and starting a sound on a lift the translator never
 * associated with one would be the app speaking unasked.
 *
 * With the line dragged to the very end (or past it, which a pan left over from
 * before a cut can be) there is nothing left to sound, so it stays parked
 * there: that is the position Record and Paste act on, which is the whole point
 * of the gesture. This deliberately does NOT reuse `auditionPlan`'s
 * rest-position fallback — at the end, "from the line" sounds the WHOLE buffer,
 * which reads correctly for a fresh Play ("play the segment") and wrong for a
 * resume, where dragging to the end would restart from the beginning. Called
 * out as an inference on #317 rather than left implicit.
 *
 * And it owes nothing at all once a TAKE exists (`takeActive`, George R1 P2
 * #3). Record is dead while a finger owns the stage ({@link recordDisabled}),
 * but a tap landing in the same frame as the pointer-down is ahead of that
 * render — and a resume into a live or paused microphone would be refused by
 * the floor, failing silently, or sound over a capture. A take supersedes the
 * gesture; the lift just lets go.
 */
export function resumesOnLift(input: {
  /** This gesture is the one that paused playback. */
  readonly interrupted: boolean;
  /** The sample now under the centerline. */
  readonly pan: number;
  readonly length: number;
  /** A take is live, paused, or being committed — the mic outranks the lift. */
  readonly takeActive: boolean;
  /** Another contact is still on the stage (George R3 P1-2). */
  readonly othersDown: boolean;
}): boolean {
  return (
    input.interrupted &&
    !input.takeActive &&
    !input.othersDown &&
    input.pan < input.length
  );
}

/**
 * What a lift leaves behind — the lock, the sound, and the debt (Frank R3 P2).
 *
 * A gesture on the stage can outlive the pointer that owned it, and the three
 * answers come apart there. `resumesOnLift` says whether sound starts;
 * `dragging` says whether the transport stays locked, and it is about FINGERS,
 * not about the pointer that happened to own the drag — an owner lifting while
 * a second contact is still on the waveform used to re-enable Play, Record,
 * Undo, Zoom and Select, so a third finger could start a sound under the one
 * still down. And a resume that cannot happen yet must be OWED rather than
 * consumed: silence after every finger has gone is #317 broken from the other
 * side, so the lift that finally clears the stage collects it.
 *
 * A refusal for any reason other than a finger — the line at the very end, a
 * take that started mid-gesture — is final, and the debt is dropped: leaving
 * the flag set would fire a resume on some later, unrelated lift.
 *
 * `reopenFrame` is the fourth answer (#613, Frank R1 P2). A lift that leaves
 * the stage at rest is what asks for a selection frame again after a cut
 * collapsed it — but NOT a lift that also resumes playback: `onPointerUp`
 * resumes `soundRange(from, length)`, the TAIL from the line, while a seeded
 * frame would make {@link stageView} read `playingBuffer && selectionActive`
 * as an in-place audition and draw a band over a span that is not what is
 * sounding. While the tail plays, the collapsed line is the honest display.
 *
 * It does NOT come back on "the next touch": a touch landing while the tail
 * is still sounding interrupts it, and that lift resumes, so this stays false
 * for as long as the playback lasts. The frame returns on the first lift that
 * does not resume — once the tail has run out there is nothing to interrupt,
 * or {@link resumesOnLift} refuses for one of its own reasons. Like
 * `dragging` and `resume` it is about
 * FINGERS, not about which pointer owned the drag — gating it on `wasOwner`
 * leaves the frame collapsed for good when the owner lifts first and a
 * second contact lifts last.
 *
 * `canPaste` is a fifth term, added for #835: while the clipboard holds a
 * cut, a drag's lift must NOT reopen the frame either, even once the stage
 * is clear and silent. Before #835 a tap or drag on the waveform was a route
 * back to a selection window regardless of the clipboard, which is exactly
 * the bug reported — dragging to find a precise paste point kept swapping
 * the red playhead back for a selection band. The requirements owner's
 * decision on #835 is that a new selection is available only once the
 * clipboard is empty (today, a paste — see `recorder.tsx`'s `onPaste`, which
 * still always reopens the frame; that route, undo and redo are unaffected by
 * this term). This is the ONLY route the decision narrows: `resumesOnLift`
 * and the rest of this function's cases are unchanged.
 */
export function liftOutcome(input: {
  /** This pointer owned the drag. */
  readonly wasOwner: boolean;
  /** An owner is still dragging AFTER this lift. */
  readonly ownerActive: boolean;
  /** Contacts still on the stage after this one is removed. */
  readonly contactsRemaining: number;
  /** A resume is owed — some gesture paused playback and has not paid it. */
  readonly interrupted: boolean;
  /** The sample now under the centerline. */
  readonly pan: number;
  readonly length: number;
  /** A take is live, paused, or being committed. */
  readonly takeActive: boolean;
  /**
   * The clipboard holds a cut (`editor.canPaste`, #835). While true, a
   * drag's lift must not reseed a selection frame — the collapsed line stays
   * the only thing on the stage. NOT because a paste empties the clipboard:
   * paste is not one-shot yet (#489 is open), so `editor.canPaste` stays true
   * across a paste, and the frame reopens instead because `recorder.tsx`'s
   * `onPaste` calls `reopenFrame()` itself, unconditionally, as the
   * paragraph above already says (a discard would presumably empty the
   * clipboard for real, once #862 lands, but that is not built yet either).
   * #489 must not route paste through this predicate — a one-shot paste that
   * merely flips `canPaste` false would leave this term believing the stage
   * is still owed a reseed with no `reopenFrame()` call left to satisfy it,
   * and the frame would never come back.
   */
  readonly canPaste: boolean;
}): {
  readonly dragging: boolean;
  readonly resume: boolean;
  readonly keepOwed: boolean;
  /** The stage is at rest and silent, so a collapsed frame may be seeded again. */
  readonly reopenFrame: boolean;
} {
  const held = input.ownerActive || input.contactsRemaining > 0;
  // A non-owner's lift matters for one reason only: it may be the moment the
  // stage goes clear. While the owner is still dragging it changes nothing.
  if (!input.wasOwner && input.ownerActive)
    return {
      dragging: true,
      resume: false,
      keepOwed: input.interrupted,
      reopenFrame: false,
    };
  const resume = resumesOnLift({
    interrupted: input.interrupted,
    pan: input.pan,
    length: input.length,
    takeActive: input.takeActive,
    othersDown: input.contactsRemaining > 0,
  });
  return {
    dragging: held,
    resume,
    keepOwed: input.interrupted && !resume && input.contactsRemaining > 0,
    reopenFrame: !held && !resume && !input.canPaste,
  };
}

/**
 * Where an absolute pan sits after `len` samples are INSERTED at `at` — the
 * general shape of what a paste does to every position to its right, and
 * what {@link panAfterUndo} applies to re-insert a cut's removed range.
 *
 * `pan <= at` is deliberately `<=`, not `<`: an insertion AT the pan is
 * exactly `onPaste`'s own case (`recorder.tsx`'s `onPaste` — "nothing to the
 * line's left moves"), where the pan is a boundary between the old audio and
 * the new, and stays the numeric value it already was so it keeps pointing
 * at the start of what was just inserted.
 *
 * **This is `panAfterCut`'s inverse only at the cut's START boundary, not
 * at its end — named here deliberately rather than left for a reader to
 * discover.** A pan exactly at a cut's start is left unchanged by
 * `panAfterCut` (`removedBeforePan === 0`), and re-inserting there with
 * `pan <= at` returns that same value: a true round trip. But `panAfterCut`
 * maps EVERY pan inside the removed range — including one that sat exactly
 * at the cut's END — to that same start value
 * (`panAfterCut(8_000, {4_000, 8_000})` and `panAfterCut(4_000, {4_000, 8_000})`
 * both return `4_000`; pinned by the boundary cases in
 * `describe("panAfterUndo / panAfterRedo")`, `tests/recorder-stage.test.ts`).
 * Once collapsed, a pan carries no memory of where inside the removed range
 * it started, so nothing downstream — this function or {@link panAfterUndo},
 * which calls it — can recover a pan that had sat at the cut's end; undo
 * restores it to the cut's START instead. That is the deliberate, honest
 * convention picked here — the simplest one that names an actual position
 * rather than inventing one — not an accident of the boundary condition
 * above, and it is why `panAfterUndo`'s "inverse" is a best-effort mapping,
 * not a guaranteed round trip, for every pan that a cut collapsed.
 *
 * **Why START and not END** (a panel review round asked the opposite
 * question: shouldn't undo track "the surviving sample this pan currently
 * denotes," landing at the cut's END instead?). `panAfterCut`'s own
 * docblock already answers this for the LIVE cut, independent of undo: "a
 * cut straddling it lands the line at the cut's start" — a pan the cut
 * collapses is, by this codebase's pre-existing convention, DEFINED to sit
 * at the cut's start, not treated as still attached to whatever survivor
 * happens to be numerically adjacent. That convention predates #473/#449
 * and governs every live cut, not just the undo path. Undoing with `pan <=
 * at` unchanged is the identity map on exactly that boundary value, so it
 * is the one choice that keeps a collapsed pan's meaning consistent
 * whether a cut is live or being undone. Shifting `pan >= at` forward
 * instead would resolve the boundary the other way ONLY for undo, leaving
 * a live cut and an undone cut disagreeing about which side of the gap a
 * collapsed pan belongs to — a new inconsistency, not a fix — and would
 * still be wrong for the mirror case (a pan that started the cut sitting
 * exactly at its START, `describe("a pan exactly at a cut's START
 * boundary...")` below), since the two pre-cut origins are equally
 * plausible and, once collapsed, equally unrecoverable either way.
 */
export function panAfterInsert(pan: number, at: number, len: number): number {
  return pan <= at ? pan : pan + len;
}

/**
 * Where the centerline goes when an op is UNDONE — the inverse-op mapping
 * #449 asks for, in place of the round-3 P1's blanket "drop to the rest".
 *
 * `panState` is an absolute sample index measured in the buffer the undone
 * op produced. Undoing it re-materialises the buffer as it was one op
 * earlier, and — like a cut or a paste happening live — that has an inverse
 * mapping: undoing a `cut` re-INSERTS the range it removed
 * ({@link panAfterInsert}), and undoing a `paste` removes the clip it
 * inserted ({@link panAfterCut} over the pasted span). Applying it is what
 * lets a hand-set pan whose audio did not move under the undone op survive
 * the undo — #449's acceptance — rather than being dropped unconditionally
 * the way a Cut/Paste/Undo/Redo three-policy split used to (round-3 P1's own
 * finding: three different rules answering the same "does this index still
 * name the same audio" question).
 *
 * It is a mapping, not a guaranteed round trip: {@link panAfterInsert}'s own
 * docblock names the one case where it cannot be, at a cut's end boundary —
 * a pan the cut had already collapsed comes back at the cut's START, never
 * at wherever it originally sat inside the removed range.
 *
 * This SUBSUMES round-3 P1 rather than special-casing it: a frozen index
 * (`panState` written by a completed playback, per {@link frozenPan}) is no
 * more and no less valid than a hand-set one once mapped through the actual
 * inverse — provenance was never the right question (#449's own text). An
 * index the mapping cannot place inside the restored buffer collapses
 * through {@link panOrRest} against the restored length exactly as a stale
 * post-cut index already does everywhere else `panState` is written.
 *
 * `null` (the F7 rest) passes straight through in both directions: the rest
 * is not a position in any particular buffer, it is "the end, whatever the
 * end becomes", so no history op has anything to map it through.
 *
 * `preUndoLength` is `editor.workingLength` AS READ IN THE CALLER'S RENDER
 * CLOSURE, i.e. the length BEFORE this undo runs — matching #473's
 * {@link panAfterCutCollapse}, the length the restored (post-undo) buffer will
 * have is
 * derived from the op rather than re-read from `editor`, because `editor` is
 * a React object whose own `workingLength` has not advanced yet inside the
 * same callback that just called `editor.undo()` (the `setHist` it triggers
 * is not visible until the next render).
 */
export function panAfterUndo(
  pan: number | null,
  undoneOp: EditOp,
  preUndoLength: number
): number | null {
  if (pan === null) return null;
  if (undoneOp.kind === "cut") {
    // Normalised ONCE, through the same `wholeSampleRange` the buffer edit
    // itself is built on (`lib/audio/edit.ts`) — both the length AND the
    // START position `panAfterInsert` re-inserts at, not just the length:
    // a fractional-boundary cut's raw `Math.min(start, end)` disagrees with
    // what `Int16Array.slice` actually removed, landing the re-inserted pan
    // a fraction of a sample off the buffer's real restored index (#473
    // round-2 Frank P2 caught the length; round 3 found this position term
    // was still raw).
    const range = wholeSampleRange(undoneOp.range);
    const removedLen = range.end - range.start;
    // Undoing a cut re-inserts what it removed, so the restored buffer is
    // LONGER than the one the undo started from.
    return panOrRest(
      panAfterInsert(pan, range.start, removedLen),
      preUndoLength + removedLen
    );
  }
  // Undoing a paste removes what it inserted, so the restored buffer is
  // SHORTER than the one the undo started from.
  return panOrRest(
    panAfterCut(pan, {
      start: undoneOp.at,
      end: undoneOp.at + undoneOp.clip.length,
    }),
    preUndoLength - undoneOp.clip.length
  );
}

/**
 * Where the centerline goes when an op is REDONE. Re-applying a `cut` writes
 * exactly what the live cut writer does, {@link panAfterCutCollapse}: the line
 * goes to the cut point, the paste target, whatever the pan was (#722, the
 * DRI's call that a redone cut reproduces the cut's view as well as its
 * buffer). Re-applying a `paste` maps the pan the way a live insert does
 * ({@link panAfterInsert}), onto a buffer LONGER by the pasted clip — the
 * forward half of {@link panAfterUndo}'s mapping. `preRedoLength` is the same
 * kind of pre-op closure value {@link panAfterUndo} takes, read before this
 * redo runs. The frame half of the same decision is
 * {@link redoCollapsesFrame}.
 */
export function panAfterRedo(
  pan: number | null,
  redoneOp: EditOp,
  preRedoLength: number
): number | null {
  // Before the rest check on purpose: the live cut collapses a rested `null`
  // pan onto the cut point too (`onCut`).
  if (redoneOp.kind === "cut") {
    return panAfterCutCollapse(redoneOp.range, preRedoLength);
  }
  if (pan === null) return null;
  return panOrRest(
    panAfterInsert(pan, redoneOp.at, redoneOp.clip.length),
    preRedoLength + redoneOp.clip.length
  );
}

/**
 * Whether a redo leaves the #613 collapse latched — `recorder.tsx`'s
 * `cutCollapsed` — rather than reopening the frame.
 *
 * A redone cut does (#722): the band is gone again and the one line left is
 * where a paste lands, the state a live cut leaves. A redone paste does not;
 * it has no collapse to make, and the frame reseeds over the audio that
 * landed, as after a live paste. `null` — nothing was redone — keeps what the
 * redo path did before #722, which is to reopen.
 */
export function redoCollapsesFrame(redoneOp: EditOp | null): boolean {
  return redoneOp?.kind === "cut";
}

/**
 * Whether the Record control is dead.
 *
 * Record is the control that LOCKS the insertion offset: `insertionOffset` is
 * captured at the tap (#61, F9) and the take splices there whatever the view
 * does afterwards. So every state in which the drawn line and that offset could
 * disagree must be a state in which Record cannot be tapped — which makes this
 * a gate on the insertion offset, not a piece of button chrome, and the reason
 * it is enumerated here rather than inlined in the JSX.
 *
 * - **`busy` / `isClosing` / no `view`** — nothing to record into, or a commit
 *   already in flight.
 * - **`playingBuffer` at idle** — under the scrolling view the line marks the
 *   SOUNDING sample while `panState` is still the pre-play value, so a take
 *   would splice somewhere the translator cannot see.
 * - **`dragging`** — the #317 hole (George R1 P2 #3). That gesture stops
 *   playback the instant the finger lands, which LIFTS the `playingBuffer`
 *   term while the drag is still in flight; a second finger on Record would
 *   lock the offset to a pan that then keeps moving under it. The finger owns
 *   the stage until it lifts.
 *
 * A sounding buffer used to have ONE exemption, `paused`: the button was
 * Resume then, its offset was locked at the original Record tap, and resuming
 * stopped the preview and continued the take (George R3 #4 on #101). #614 ended
 * the paused take, so the exemption has nothing left to exempt and a sounding
 * buffer now disables this outright — which is what the three bullets above
 * already said on their own.
 */
export function recordDisabled(input: {
  readonly busy: boolean;
  readonly isClosing: boolean;
  /** A segment is loaded. */
  readonly hasView: boolean;
  readonly playingBuffer: boolean;
  /** A pointer is mid-pan on the stage. */
  readonly dragging: boolean;
}): boolean {
  if (input.busy || input.isClosing || !input.hasView) return true;
  if (input.dragging) return true;
  return input.playingBuffer;
}

/**
 * The transport half of the #317 stage lock: a control the finger holds down.
 *
 * {@link stageView}'s `windowControlsInert` covers what is drawn ON the stage —
 * Zoom, Select, the paste marker — but Play, Undo and Redo cannot ride that
 * flag, because it is also true while a buffer sounds and Play is the STOP in
 * that state. They carry the `dragging` term on its own instead, through this,
 * so the rule is written once rather than three times in JSX (George R2 P1).
 *
 * Why those three. The touch stops playback BEFORE the drag begins, so from the
 * pointer-down until the lift `playingBuffer` is false while the pan is still
 * moving and a resume is owed. In that window Play would start a second sound
 * the lift then stops or doubles; Undo and Redo REPLACE `working`, and the lift
 * would resume a sample index measured in the buffer that is gone — the same
 * "index in the wrong buffer" defect `stopPlaybackDroppingPan` exists to
 * prevent, arriving by a second finger instead.
 *
 * It takes the control's own answer rather than returning a bare flag so that
 * the call site reads as one gate: there is no state in which a drag re-enables
 * something its own gate already killed.
 */
export function heldByDrag(dragging: boolean, otherwise: boolean): boolean {
  return dragging || otherwise;
}

/**
 * Where the fixed centerline sits across the waveform viewport (F6).
 *
 * Centered. Sitting it right-of-centre gave the recorded audio room to the
 * right to grow into on an append (mockup 3), but the requirements owner's
 * v0.1.2 review asked for it centered on every screen — that overrides the
 * append-headroom tradeoff. One constant to retune.
 *
 * Lives here, not in `recorder.tsx` or `centerline-overlay.tsx`, because
 * both read it: `recorder.tsx`'s own pan/zoom arithmetic (`viewportWindow`,
 * `playbackStrip`, `panForZoom`) and `CenterlineOverlay`'s `left` position
 * must agree on the same fraction, and a module that both already import
 * (this one) is the one place that does not make either import the other.
 */
export const CENTER_FRACTION = 0.5;

/**
 * The two zoom levels: the whole clip in view, or a quarter of it (§4.4).
 *
 * Here rather than in `recorder.tsx` since #160's L-1 split the toolbars out:
 * the zoom toggle reads both, the sheet reads `ZOOM_WHOLE` for its initial
 * zoom, its edit-exit reset and the toggle's next level, and a constant two
 * modules key their paint on should not live inside one of them.
 */
export const ZOOM_WHOLE = 1;
export const ZOOM_QUARTER = 4;

/**
 * Whether the fixed centerline overlay is drawn — the COMPLETE render
 * decision for `recorder.tsx`'s centerline `<div>` (#418; folded together
 * with the `liveScope` term here by George round-1 / Frank round-2 P2 on
 * #513).
 *
 * Before this, the JSX gate composed two separately-derived booleans ad hoc
 * at the call site — `{!liveScope && centerlineVisible && (` — and only
 * `centerlineVisible`'s own predicate (then named `centerlineShown`) was
 * under test. A future edit that dropped or changed the `!liveScope` term
 * at the call site would leave the centerline visible behind a live-growing
 * scope, or vice versa, and every existing test would still pass, because
 * nothing exercised the two terms together. This function is now the WHOLE
 * gate; `recorder.tsx` calls it directly in the JSX condition with no other
 * boolean logic at the call site, so a regression in either term has to
 * break a test here rather than survive as an uncovered call-site edit.
 *
 * Two independent reasons to hide, either sufficient on its own:
 *
 * - `liveScope`: mounted on the `Waveform` path only — `LiveScope` draws its
 *   own record head while capturing (see `liveScopeShown`), so if the two
 *   branches were ever mounted together this line would double that cue.
 *   Unconditional; not a #418 concern.
 * - the #418 exception to #316's "always visible": a selection span loaded
 *   in edit mode has no playback role for the line — with a span picked,
 *   the audition sounds only the selection (#284), and the line is only the
 *   audition's start point when nothing is picked. It is clutter rather
 *   than a cue, so it hides for
 *   that one sub-state and nothing else — record, play, and edit mode with no
 *   span picked all keep it, per the table in #418.
 *
 * The #418 half is deliberately NOT keyed off {@link StageRender} or
 * `playingBuffer`: the hide is about whether a span is loaded, not about
 * whether the stage is scrolling or something is sounding — a picked-span
 * audition (`inPlace`) and a picked span sitting idle both hide it, and a
 * `scroll` playback with no selection keeps it.
 */
export function centerlineOverlayShown(input: {
  readonly mode: "record" | "edit";
  readonly selectionActive: boolean;
  readonly liveScope: boolean;
}): boolean {
  if (input.liveScope) return false;
  return !(input.mode === "edit" && input.selectionActive);
}

/**
 * What the render-time selection reseed does this render (#613).
 *
 * `recorder.tsx` re-opens the selection frame during render whenever edit mode
 * has none open: cut, undo and redo all clear the frame (their sample ranges
 * were measured against a buffer the history has just changed), and without a
 * reseed the translator would be left in edit mode with no way to pick a span.
 * It runs in render rather than an effect so the frame is never missing for a
 * painted frame.
 *
 * It also re-opened it after a CUT, in the same commit the cut cleared it —
 * which is #613: the band the requirements owner saw "stay highlighted" is a
 * NEW span seeded around the insertion pan, the scissors over it is live
 * because `canCut` is true again, and the centerline is hidden underneath
 * because {@link centerlineOverlayShown} is false while a frame is open. All
 * three of the reported symptoms are this one reseed.
 *
 * So a cut suspends it — `collapsedByCut` — until something asks for a frame
 * again: a paste, an undo, a redone paste (a redone cut re-latches it, #722),
 * leaving edit mode, or the stage coming to rest under a finger
 * (`recorder.tsx` clears the latch at each).
 *
 * Three answers rather than a boolean, because the reseed block does two
 * things and only one of them is suspended: `"seed"` opens a span AND drops
 * the entry latch and the stale zoom fit; `"clear"` does only the latter —
 * which the collapsed state NEEDS, since the paste marker is gated on
 * `zoomPan === null` and a leftover fit would hide the very control this
 * state exists to offer; `"none"` is not this render's business at all.
 *
 * Pure and DOM-free so the truth table is a test rather than a phone.
 */
export type SelectionReseed = "seed" | "clear" | "none";

export function selectionReseed(input: {
  readonly mode: "record" | "edit";
  readonly selectionActive: boolean;
  /**
   * The frame may be seeded from the buffer on screen. False across the window
   * where an edit-mode entry committed a take and the committed buffer has not
   * arrived yet — a span seeded from the pre-commit buffer names the wrong
   * samples in the one that lands.
   */
  readonly entrySettled: boolean;
  /** `editor.workingLength`. An empty buffer has no frame to seed. */
  readonly length: number;
  /** A cut has collapsed the frame to the playhead and it stays collapsed. */
  readonly collapsedByCut: boolean;
}): SelectionReseed {
  if (input.mode !== "edit" || input.selectionActive || !input.entrySettled) {
    return "none";
  }
  if (input.length <= 0 || input.collapsedByCut) return "clear";
  return "seed";
}

export function stageView(input: StageInput): StageView {
  const inPlace = input.mode === "edit" && input.selectionActive;
  const render: StageRender = !input.playingBuffer
    ? "static"
    : inPlace
      ? "inPlace"
      : "scroll";
  // `dragging` does NOT reach `render`: a drag pans the static window, it does
  // not change what is drawn (George R2 P1 asked for the inert half only, and
  // folding it into `render` would swap the view out from under the finger).
  return {
    render,
    windowControlsInert: input.playingBuffer || input.dragging,
  };
}
