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
 * The waveform is drawn one of two ways — through the pan/zoom window, or as
 * the whole clip — and half a dozen controls and overlays are only correct
 * under one of them. Review rounds kept finding the same defect wearing a new
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

interface StageView {
  /**
   * Draw clip fractions 0..1 rather than the pan/zoom window.
   *
   * True for a preview and for any sounding buffer EXCEPT an audition of a
   * picked span: that one plays in place, because the band is positioned
   * through the pan window and hearing exactly the span it marks is the point.
   * Everything else swaps, so the playhead cannot travel off-screen through a
   * window the listener is not following.
   */
  readonly wholeView: boolean;
  /**
   * Suppress the red insert centerline (`Waveform`'s `playing`).
   *
   * Whenever the view is swapped — the line would mark a sample that is no
   * longer where it is drawn — and also for a picked-span audition, where the
   * line is still honest but a second static vertical line beside a travelling
   * playhead reads as "insert here" to someone who cannot read the screen.
   */
  readonly centerlineHidden: boolean;
  /**
   * Every control that READS OR MOVES the pan/zoom window is inert.
   *
   * The enumeration, so the next reader sees the class rather than a scatter of
   * guards. IN — each is wrong while a buffer sounds:
   *
   * - **the stage pan** (`onPointerDown`/`onPointerMove`): moves the window,
   *   and under a swapped view moves a record offset that is not on screen;
   * - **Zoom**: rebuilds the window around the centerline under a line that is
   *   already travelling, and does nothing visible at all while swapped;
   * - **the paste marker**: pinned at the centerline's screen position but
   *   pastes at `win.centerlineSample` — under a swapped view it points at one
   *   sample and inserts at another (it is unmounted, not merely disabled, so
   *   the false POSITION goes too);
   * - **Select**: seeds its span from `win.centerlineSample` ± the visible
   *   width, and the centerline is hidden while sounding — so it would
   *   highlight the insert point rather than the audio being heard. Inert in
   *   both directions: closing a frame mid-audition would also flip the view
   *   out from under the sound.
   *
   * OUT, deliberately — each stays live, and why:
   *
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
   * Mode-independent on purpose: it is the same condition the stage pan has
   * always used, which is why the pan is the one control in the class that
   * never had this bug.
   */
  readonly windowControlsInert: boolean;
  /**
   * A picked-span audition sounding WITHOUT a view swap — `playingBuffer` true,
   * `wholeView` false. The window still matches what is drawn, so a playhead
   * that maps outside it (the picked span is wider than the pan/zoom window)
   * is real audio that is merely off-screen, not the blank head/tail the
   * overlay's hide rule was written for.
   *
   * Before this PR, `playingBuffer` implied `wholeView` unconditionally (every
   * sounding buffer swapped to the whole clip), so that hide rule's `px < 0 ||
   * px > 1` branch was unreachable — dead code guarding a case nothing could
   * produce. An in-place audition (#284) is the first real path to it: select
   * a span wider than the current zoom, audition it, and the moving cue this
   * whole feature exists to add vanishes the moment it crosses the window edge
   * (George R7). The overlay uses this flag to CLAMP to the edge instead of
   * hiding — the audio is still there, still sounding, just off the visible
   * strip — while every other `wholeView` case (a preview, a record-mode play,
   * a no-selection audition) keeps the original hide.
   */
  readonly inPlaceAudition: boolean;
}

export function stageView(input: StageInput): StageView {
  const inPlace = input.mode === "edit" && input.selectionActive;
  const wholeView = input.previewShown || (input.playingBuffer && !inPlace);
  return {
    wholeView,
    centerlineHidden: wholeView || input.playingBuffer,
    windowControlsInert: input.playingBuffer,
    inPlaceAudition: input.playingBuffer && !wholeView,
  };
}
