/**
 * Open Bible Stories catalogue.
 *
 * OBS maps onto the tC Mobile domain model without translation:
 *
 *   OBS story (1–50)  →  Chapter
 *   OBS frame         →  Segment (hangs off the chapter directly; Section is gone)
 *
 * That is why it is the right beta content: testers get a real, ordered,
 * illustrated set of segments without having to build one, and the artwork
 * gives each segment a non-textual identity — which is the whole problem this
 * app has to solve for people who cannot read.
 *
 * Licensing: CC BY-SA 4.0; artwork © Sweet Publishing, CC BY-SA 3.0.
 * See docs/decisions/0006-obs-content.md.
 */

/**
 * Not exported: nothing imports the name, and `ObsStory.frames` types fine
 * against a file-private interface. An `@pivot-pending` tag here would have
 * been a silencer — no batch wires this up — which is the thing that tag must
 * never be.
 */
interface ObsFrame {
  /** 1-based position within the story. */
  readonly frame: number;
  /**
   * Absolute URL of the full-size frame artwork on the Door43 CDN (360px).
   * Used only where the picture is actually looked at — the recording view.
   * The list uses the bundled thumbnail; see `thumbUrl` in `@/lib/obs/catalog`.
   */
  readonly image: string;
  /** The frame's narrative text. Not shown on the primary path — see ADR 0006. */
  readonly text: string;
}

export interface ObsStory {
  /** 1-based story number, 1–50. */
  readonly story: number;
  readonly title: string;
  /** Scripture reference, e.g. "Genesis 1-2". */
  readonly reference: string | null;
  readonly frames: readonly ObsFrame[];
}

export interface ObsCatalog {
  readonly source: string;
  readonly license: string;
  /** Must travel with any display or export of this content. */
  readonly attribution: string;
  readonly imageBase: string;
  readonly generatedFrom: string;
  readonly stories: readonly ObsStory[];
}
