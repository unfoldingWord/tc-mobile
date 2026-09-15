/**
 * The recorder stage's view-coupled decisions, in one place (#284).
 *
 * The waveform is drawn one of two ways — through the pan/zoom window, or as
 * the whole clip — and half a dozen controls and overlays are only correct
 * under one of them. Three review rounds found the same defect wearing three
 * different hats: the paste marker pinned at 50% of the stage while the canvas
 * drew clip fractions 0..1 and pasted at the end instead (R3); zoom rebuilding
 * the window under a travelling playhead (R3); Select seeding a span around a
 * centerline that had been hidden, so it highlighted the end of the take rather
 * than the word being heard (R4, George). Three instances is a class, and the
 * class-level answer is to derive the question once rather than gate each
 * control by hand.
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
}

export function stageView(input: StageInput): StageView {
  const inPlace = input.mode === "edit" && input.selectionActive;
  const wholeView = input.previewShown || (input.playingBuffer && !inPlace);
  return {
    wholeView,
    centerlineHidden: wholeView || input.playingBuffer,
    windowControlsInert: input.playingBuffer,
  };
}
