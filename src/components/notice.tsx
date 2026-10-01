import { Icon, type IconName } from "./icon";
import { noticePresentation, type NoticeTone } from "./notice-tone";

interface NoticeProps {
  /**
   * What kind of thing is being said. See `notice-tone.ts` for the three: a
   * failure (`alert`), a wait (`busy`), and a heads-up (`info`, #112) that
   * covers both a completeness caveat about something already done and a
   * standing condition worth naming on its own (e.g. storage durability,
   * #214/#406). The status tones are the same one line in the same place as
   * the failure, but neutral and announced politely, because a status that
   * shouts in the colour of failure teaches people to ignore the colour.
   */
  tone?: NoticeTone;
  /**
   * A MORE SPECIFIC mark within the tone (#178). The tone still decides the
   * colour and the ARIA role; this only substitutes the shape.
   *
   * It exists because `nothing` and `failed` share the `alert` tone — that
   * split is #147's open question, not this prop's to answer — so the mark is
   * the only thing separating "record something first" from "try again" for a
   * translator who cannot read. Callers do not pick a glyph freely: the share
   * screens read `shareOutcomeGlyph`, a table, for exactly the reason
   * `share-error-copy.ts` is a table.
   */
  icon?: IconName;
  children: React.ReactNode;
}

/**
 * Something the screen has to say, said once, in one place.
 *
 * There are two screens that can fail — the browser and the section view — and
 * before this there was one banner, on the browser, below an early return that
 * the section view never reached. A denied microphone inside a section was
 * therefore completely invisible: the record button simply did nothing.
 *
 * The same shape covers a control that is temporarily unavailable, which is the
 * other half of the same defect: a disabled button with no reason beside it is
 * still a tap that does nothing.
 *
 * The glyph is not decoration. A translator who cannot read still needs to know
 * that this is a failure and not a state, and the colour plus the mark carry
 * that when the sentence cannot. The wording itself is a UX question that has
 * not been answered yet, so it is kept short and literal rather than invented.
 *
 * The presentation lives in `.notice` (layer 3), keyed on `data-tone`, and not
 * in an inline `style` as it did before #164's L-14. That was never only a
 * tidiness question: an inline `style` outranks every `@layer`, so while this
 * component painted itself it could not HAVE a component rule — anything
 * written in layer 3 for it would have lost to the element. `tone` is the only
 * thing this file decides now; `notice-tone.ts` maps it to the role and the
 * glyph, and the stylesheet maps it to colour.
 */
export function Notice({ tone = "alert", icon, children }: NoticeProps) {
  // `role` is taken from the tone and is NOT overridable — a caller may
  // substitute the mark, never how urgently a screen reader interrupts.
  const { role, icon: toneIcon } = noticePresentation(tone);
  return (
    <div role={role} data-tone={tone} className="notice">
      <span className="notice-glyph">
        <Icon name={icon ?? toneIcon} size={20} />
      </span>
      {children}
    </div>
  );
}
