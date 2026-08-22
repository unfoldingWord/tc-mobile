import { Icon } from "./icon";

interface NoticeProps {
  /**
   * What kind of thing is being said.
   *
   * `alert` is a failure: red, an alert glyph, and announced immediately.
   * `busy` is work in progress the translator has to wait for — the same one
   * line in the same place, but neutral and announced politely, because a
   * status that shouts in the colour of failure teaches people to ignore the
   * colour.
   */
  tone?: "alert" | "busy";
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
  const alert = tone === "alert";
  return (
    <div
      // A failure interrupts; a status waits its turn.
      role={alert ? "alert" : "status"}
      className="flex items-center gap-[10px] rounded-[10px] p-[12px] text-[13px]"
      style={{
        background: "var(--s-surface)",
        border: `1px solid ${alert ? "var(--s-live)" : "var(--s-edge)"}`,
        color: alert ? "var(--s-ink)" : "var(--s-ink-muted)",
      }}
    >
      <span
        className="shrink-0"
        style={{ color: alert ? "var(--s-live)" : "var(--s-ink-muted)" }}
      >
        <Icon name={alert ? "alert" : "retry"} size={20} />
      </span>
      {children}
    </div>
  );
}
