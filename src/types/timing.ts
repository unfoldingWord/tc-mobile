/**
 * Frame-level audio timing.
 *
 * As of 2026-08-22 **no such data exists** for Open Bible Stories. Verified:
 * the DCS catalogue has no audio subject; the one OBS audio repository on
 * Door43 holds 703 files, all story-level MP3s with no timing; `en_obs`
 * contains no VTT, cue or timing files; Bolls carries no OBS at all.
 *
 * It is modelled anyway, because the *format* is settled even though the data
 * is missing — Scripture Burrito's alignment spec defines exactly this, and if
 * unfoldingWord publishes one, frame-aligned reference playback becomes a
 * registration rather than a feature.
 *
 * Everything downstream asks `loadChapterTiming()` and copes with `null`. When
 * timing arrives, one `registerTimingProvider()` call turns it on.
 */

/** A single frame's span within a chapter-length audio file. */
export interface FrameTiming {
  /** 1-based frame number within the chapter. */
  readonly frame: number;
  readonly startMs: number;
  readonly endMs: number;
}

/** What a provider is asked for. */
export interface TimingRef {
  /** USFM book code, or "OBS". */
  readonly book: string;
  /** Chapter — the story number for OBS. */
  readonly chapter: number;
}

export interface ChapterTiming {
  readonly ref: TimingRef;
  /** The audio these timings address. */
  readonly audioUrl: string;
  /**
   * Ordered by `frame`, non-overlapping. Enforced — not assumed — by
   * `validateFrameTimings` at the registry boundary, because a provider is
   * an outside source.
   */
  readonly frames: readonly FrameTiming[];
  /** Which provider produced this, for debugging and for honest UI. */
  readonly providerId: string;
}

/**
 * A source of timing data.
 *
 * `load` returns `null` — never throws — when this provider simply has nothing
 * for the reference. A provider that throws is reporting a genuine fault
 * (malformed data, network failure), which the registry logs and steps past.
 */
export interface TimingProvider {
  readonly id: string;
  /** One line, shown in diagnostics so an absent provider is explicable. */
  readonly describe: string;
  load(ref: TimingRef): Promise<ChapterTiming | null>;
}
