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

/** The record-stage inputs this decision reads, all already-derived booleans. */
export interface StageState {
  /** `state === "recording"` — the mic is actively capturing. */
  recording: boolean;
  /** `state === "paused"`. */
  paused: boolean;
  /** `state === "processing"` — a #59 interruption's decode, or an F8 decode. */
  processing: boolean;
  /**
   * The F8 close window (`stop()` flipped to idle, PCM not yet in `working`)
   * — but ONLY when the close being committed followed an actual capture
   * (recording, paused, or a #59 `processing` freeze).
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
   * frozen arm on it (`!hasAudio && (paused || …)`), which made an append SWAP
   * `LiveScope`→`Waveform` at the recording→paused/close edge: `Waveform`
   * paints in `useEffect`, so the stage flashed blank then showed the
   * pre-take clip (Model A does not splice the take into `working` until
   * close), reading as "pause discarded my take" — the "read as discarded"
   * class the first-take `isClosing` clause exists to prevent (George R1 P2).
   *
   * A second attempt (George R-resume round 1, `a96a81e`) also gated the
   * `previewShown` arm on it, so an append's own Pause+Play preview stayed on
   * `LiveScope` instead of winning the stage. George round 2 caught that this
   * broke a DIFFERENT, pre-existing contract: `#101` Play-while-paused still
   * `mergeTake`s and sounds the merged buffer regardless, so the stage showed
   * a frozen take-only ring with no playhead while the translator HEARD the
   * full spliced result — a "hear X, see Y" mismatch, and worse than the scale
   * jump it was trying to prevent (a first take's preview never had this
   * problem: `isFirstTakeInFlight` already draws it absolute, matching
   * `LiveScope`'s own scale, so there is no jump to prevent there in the first
   * place). Reverted here; kept as an input so the tests can pin that prior
   * audio never changes the recording/frozen-arm outcome.
   */
  hasAudio: boolean;
  /** The mic tap could not be wired — no live scope data to draw. */
  meterFailed: boolean;
  /** A prepared whole-buffer preview is up (`previewShown !== null`). */
  previewShown: boolean;
}

/**
 * Whether the dedicated live scope (vs. the `Waveform` path) drives the record
 * stage.
 *
 * - A failed tap or a prepared preview always wins the stage — no live scope.
 *   A preview (first take OR append) is `#101`'s Play-while-paused: it plays
 *   an actual decoded buffer and must be drawn (with a working playhead) on
 *   `Waveform`, not left silently behind a frozen `LiveScope` — see
 *   {@link StageState.hasAudio}'s second paragraph.
 * - Otherwise the live scope drives the **whole take-in-flight window**
 *   (recording, paused, processing, and the F8 close) for a first take **and an
 *   append (#283)**, growing while `recording` and freezing on its last frame
 *   otherwise. Before #283 an append fell to `Waveform` for the whole take, so a
 *   second take showed the VU moving but no waveform growing until the segment
 *   was left and re-entered.
 *
 * `hasAudio` is intentionally absent from the logic — see {@link StageState}.
 * Treating an append exactly like a first take is both the behaviour #283 asked
 * for ("the same way it renders during the first take") and what avoids the
 * pause/close swap-and-flash that gating the frozen arm on `hasAudio` caused.
 *
 * Tradeoff: while an append is in flight (and not being previewed) this shows
 * the head-growing (then frozen) live scope in place of the existing clip; the
 * clip returns once a preview is prepared or the take commits. For the default
 * end-append that reads naturally; for a mid-clip insert it shows the take
 * without the surrounding clip / insert position. Preserving the existing clip
 * *and* live growth together (a composed view) is a larger change tracked
 * separately if wanted.
 */
export function liveScopeShown(s: StageState): boolean {
  if (s.meterFailed || s.previewShown) return false;
  return s.recording || s.paused || s.processing || s.isClosing;
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
 * in segment record/edit mode") retired it — the line is never suppressed, in
 * any state, so there is no longer a decision to derive. Since #415 the line is
 * not painted into the canvas at all: a strip that translates would carry a
 * painted line with it, so it is a fixed element on the stage
 * (`recorder.tsx`'s centerline overlay), mounted wherever the `Waveform` path
 * is on stage. `LiveScope` still draws its own record head during capture.
 *
 * Pure and DOM-free so the truth table is a test rather than a phone.
 */

interface StageInput {
  readonly mode: "record" | "edit";
  /** A buffer is sounding — a record-mode play, a preview, or an audition. */
  readonly playingBuffer: boolean;
  /** The selection frame is open (its band is drawn through the pan window). */
  readonly selectionActive: boolean;
  /** A paused-take preview is on the stage, drawing its own whole-clip peaks. */
  readonly previewShown: boolean;
  /**
   * A pointer is mid-pan on the stage. It does not change WHAT is drawn — a
   * drag pans the static window — only what may act on it while the gesture is
   * in flight. See {@link StageView.windowControlsInert}.
   */
  readonly dragging: boolean;
}

/**
 * The four ways the recorder stage can be drawn.
 *
 * ONE value rather than a bag of booleans (#415): the three questions the
 * stage used to answer separately — "whole clip?", "in place?", and now "does
 * the waveform scroll?" — are answers to the same question, and a bag can
 * disagree with itself in a way an enum cannot.
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
 * - **`whole`** — a paused-take preview (#101), which paints its own peaks for
 *   a DIFFERENT buffer (the merged take) across clip fractions 0..1. No pan
 *   into `working` means anything there, so it can be neither scrolled nor
 *   in-place.
 */
type StageRender = "static" | "scroll" | "inPlace" | "whole";

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
   * - **Select**: seeds its span from `win.centerlineSample` ± the visible
   *   width — a position that, while sounding, no longer matches what the
   *   (always-visible, #316) line marks once the view has swapped to the
   *   whole clip, so it would highlight the insert point rather than the
   *   audio being heard. Inert in both directions: closing a frame
   *   mid-audition would also flip the view out from under the sound.
   *
   * OUT, deliberately — each stays live, and why:
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

interface PanGestureInput {
  /** `length > 0` — there is a waveform to slide (F11). */
  readonly hasAudio: boolean;
  readonly recording: boolean;
  /** A paused TAKE — the microphone, not paused playback. */
  readonly paused: boolean;
  /** `requesting` or `processing`. */
  readonly busy: boolean;
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
 * The order is load-bearing. The take terms come FIRST: a live or paused mic
 * has locked its insertion offset at the Record tap (#61, F9), and sliding the
 * line out from under it is the defect those guards exist for — stopping a
 * sound would not make that safe. Only then does the sounding buffer decide,
 * and only the scroll mode yields:
 *
 * - **`whole`** is a paused-take preview: a DIFFERENT buffer (#101), whose
 *   samples have no relationship to the pan the drag would move;
 * - **`inPlace`** is an audition of a picked span (#284): the band and its two
 *   handles are positioned through the pan window, so panning would slide them
 *   off the audio they mark while that audio sounds.
 *
 * `playingBuffer` is asked separately from `render` on purpose, and is not
 * redundant with it: `previewShown` outlives the sound (the preview stays on
 * stage through `busy` and the close window), so `"whole"` with nothing
 * sounding is an ordinary pan — as it was before #317 — while `"whole"` with a
 * buffer sounding is refused.
 */
export function panGesture(input: PanGestureInput): PanGesture {
  if (!input.hasAudio || input.recording || input.paused || input.busy)
    return "ignore";
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
}): {
  readonly dragging: boolean;
  readonly resume: boolean;
  readonly keepOwed: boolean;
} {
  const held = input.ownerActive || input.contactsRemaining > 0;
  // A non-owner's lift matters for one reason only: it may be the moment the
  // stage goes clear. While the owner is still dragging it changes nothing.
  if (!input.wasOwner && input.ownerActive)
    return { dragging: true, resume: false, keepOwed: input.interrupted };
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
  };
}

/**
 * Where the centerline goes when the edit log REPLACES the working buffer —
 * Undo and Redo (George R3 P1-1).
 *
 * The answer does not depend on where the line was, and that is the finding:
 * `panState` is an absolute sample index measured in the buffer that has just
 * been thrown away, and an arbitrary history jump has no mapping for it. (A cut
 * does — `panAfterCut` shifts the index by what was removed to its left — which
 * is exactly why undo/redo needing one is easy to assume and wrong.)
 *
 * Round 2 already dropped the pan of an IN-FLIGHT play before a rematerialiser
 * ran (`stopPlaybackDroppingPan`). What survived was a freeze that had already
 * committed: scroll-play, pause at sample 4 000 so `panState` is 4 000, then
 * tap Undo — nothing is sounding, so the dropping stop is a no-op, and 4 000 is
 * left naming different speech in the restored buffer. The next Record locks
 * `insertionOffset` there (#61, F9) and punches into the middle of a word.
 *
 * So the line returns to the F7 REST. `null` is not "no pan": `effectivePan`
 * reads it as "the end, whatever the end turns out to be", so the line follows
 * the restored buffer and Record appends — which is what these controls did
 * before playback ever wrote the pan, and the only position that is honest
 * about a buffer nobody has looked at yet.
 */
export function panAfterRematerialize(pan: number | null): number | null {
  if (pan === null) return null; // already the rest; nothing to drop
  return null; // an absolute index has no meaning in the new buffer
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
 *   SOUNDING sample while `panState` is still the pre-play value, and under a
 *   whole-clip preview it marks nothing in the working buffer at all. Either
 *   way a take would splice somewhere the translator cannot see.
 * - **`dragging`** — the #317 hole (George R1 P2 #3). That gesture stops
 *   playback the instant the finger lands, which LIFTS the `playingBuffer`
 *   term while the drag is still in flight; a second finger on Record would
 *   lock the offset to a pan that then keeps moving under it. The finger owns
 *   the stage until it lifts.
 *
 * The one state that stays LIVE while a buffer sounds is **paused**: this
 * button is Resume then, its offset was locked at the original Record tap, and
 * resuming stops the preview and continues the take (George R3 #4 on #101).
 * `dragging` is deliberately NOT subordinate to that — a drag cannot begin
 * during a paused take (`panGesture` refuses it), so the two never co-occur
 * legitimately, and if they ever did the moving pan would still be the danger.
 */
export function recordDisabled(input: {
  readonly busy: boolean;
  readonly isClosing: boolean;
  /** A segment is loaded. */
  readonly hasView: boolean;
  readonly playingBuffer: boolean;
  /** A take is PAUSED — this button is Resume. */
  readonly paused: boolean;
  /** A pointer is mid-pan on the stage. */
  readonly dragging: boolean;
}): boolean {
  if (input.busy || input.isClosing || !input.hasView) return true;
  if (input.dragging) return true;
  return input.playingBuffer && !input.paused;
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

export function stageView(input: StageInput): StageView {
  const inPlace = input.mode === "edit" && input.selectionActive;
  const render: StageRender = input.previewShown
    ? "whole"
    : !input.playingBuffer
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
