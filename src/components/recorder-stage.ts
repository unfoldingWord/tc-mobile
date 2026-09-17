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
   * The enumeration, so the next reader sees the class rather than a scatter of
   * guards. IN — each is wrong while a buffer sounds:
   *
   * - **Zoom**: rebuilds the window around the centerline under a line that is
   *   already travelling, and does nothing visible at all while swapped;
   * - **the paste marker**: pinned at the centerline's screen position but
   *   pastes at `win.centerlineSample` — under a swapped view it points at one
   *   sample and inserts at another (it is unmounted, not merely disabled, so
   *   the false POSITION goes too);
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
   *   that must never be inert while sounding;
   * - **Cut**: acts on the visible band, never on the window. It is enabled
   *   only when a span is picked, which is exactly the case that does NOT swap
   *   the view — so what it removes is what is drawn and what was just heard.
   *   Gating it would break the two-tap "hear it, then cut it" flow this whole
   *   issue exists to create;
   * - **Undo/Redo**: history operations that read no window; they stop the
   *   sound before rematerialising the buffer;
   * - **the selection handles**: they map a pointer through the pan window, but
   *   they are only ever drawn while a span is picked — the one case that keeps
   *   that window — so their mapping is always the one on screen. They stop the
   *   sound on the first move;
   * - **Back, the ≡ menu, the Editing pill**: they leave or suspend this state
   *   rather than acting inside it, and each stops playback on the way.
   *
   * Mode-independent on purpose: it is the same condition it has always been.
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
  /** The range that was sounding — `soundRange`'s arguments. */
  readonly start: number;
  readonly end: number;
  /** A stop was ASKED for (Pause, a #317 touch, the menu, Back, an edit). */
  readonly stopRequested: boolean;
  /** The working buffer's length, for the clamp. */
  readonly length: number;
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
 * - **Never sounded** — a `playBuffer` that fails flips `playingBuffer` true
 *   optimistically and then false again, so the loop only ever read the range's
 *   START. Parking the line at the end of a range that was never heard would
 *   move the record insertion offset on the strength of a failure, so this case
 *   leaves the line where it was. `observed > start` is what separates it from
 *   the one above, exactly rather than by a tolerance.
 *
 * Clamped to the clip for `viewportWindow`'s reason: the pan is also the record
 * insertion offset, and there is no inserting before the start or after the end.
 */
export function frozenPan(input: FrozenPanInput): number {
  const reached = input.stopRequested
    ? input.observed
    : input.observed > input.start
      ? input.end
      : input.observed;
  return Math.max(0, Math.min(reached, input.length));
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
 */
export function resumesOnLift(
  interrupted: boolean,
  pan: number,
  length: number
): boolean {
  return interrupted && pan < length;
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
  return { render, windowControlsInert: input.playingBuffer };
}
