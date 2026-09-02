import { Icon } from "./icon";
import { noticePresentation, type NoticeTone } from "./notice-tone";

interface NoticeProps {
  /**
   * What kind of thing is being said. See `notice-tone.ts` for the three: a
   * failure (`alert`), a wait (`busy`), and a heads-up about something already
   * done (`info`, #112). The status tones are the same one line in the same
   * place as the failure, but neutral and announced politely, because a status
   * that shouts in the colour of failure teaches people to ignore the colour.
   */
  tone?: NoticeTone;
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
 */
export function Notice({ tone = "alert", children }: NoticeProps) {
  const { role, icon, failure, muted } = noticePresentation(tone);
  // The heads-up glyph takes the warn colour: not the failure red, and not the
  // muted ink a wait wears, so the three marks stay apart in colour as well as
  // shape for a reader who cannot parse the sentence.
  const glyphColor = failure
    ? "var(--s-live)"
    : muted
      ? "var(--s-ink-muted)"
      : "var(--s-warn)";
  return (
    <div
      role={role}
      className="flex items-center gap-[10px] rounded-[10px] p-[12px] text-[13px]"
      style={{
        background: "var(--s-surface)",
        border: `1px solid ${failure ? "var(--s-live)" : "var(--s-edge)"}`,
        color: muted ? "var(--s-ink-muted)" : "var(--s-ink)",
      }}
    >
      <span className="shrink-0" style={{ color: glyphColor }}>
        <Icon name={icon} size={20} />
      </span>
      {children}
    </div>
  );
}
