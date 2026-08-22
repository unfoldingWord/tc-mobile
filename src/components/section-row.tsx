import { Icon } from "./icon";
import { Waveform } from "./waveform";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/utils";
import type { SectionCard } from "@/types/view";

interface SectionRowProps {
  section: SectionCard;
  isNext: boolean;
  isPlaying: boolean;
  onOpen: (section: SectionCard) => void;
  onQuickAction: (section: SectionCard) => void;
}

/**
 * A list row, for a chapter with no artwork.
 *
 * Here the waveform is the only identity a section has, so it takes the room
 * the picture would have had. Tapping the row **plays it** rather than
 * entering: without a picture, sound is the only way to confirm which section
 * this is, and that confirmation has to cost one tap, not two.
 */
export function SectionRow({
  section,
  isNext,
  isPlaying,
  onOpen,
  onQuickAction,
}: SectionRowProps) {
  const recorded = section.durationMs !== null;

  return (
    <div
      className={cn("row", isNext && "row--next", isPlaying && "row--active")}
    >
      <button
        type="button"
        onClick={() => onQuickAction(section)}
        aria-label={
          recorded
            ? `Play section ${section.ordinal}`
            : `Record section ${section.ordinal}`
        }
        className="flex min-w-0 flex-1 items-center gap-[14px] border-0 bg-transparent p-0 text-left"
      >
        <span
          className="t-ordinal grid h-[40px] w-[40px] flex-none place-items-center rounded-[10px]"
          style={{
            border: "1px dashed var(--s-edge)",
            color: "var(--s-ink-muted)",
            fontSize: "var(--p-text-md)",
          }}
        >
          {section.ordinal}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-[5px]">
          <Waveform peaks={section.peaks} height={26} recorded={recorded} />
          <span className="t-count">
            {section.durationMs === null
              ? "—"
              : formatDuration(section.durationMs)}
          </span>
        </span>
      </button>

      <button
        type="button"
        onClick={() => onOpen(section)}
        aria-label={`Open section ${section.ordinal}`}
        className={cn("control flex-none", !recorded && "control--record")}
      >
        <Icon name={recorded ? "next" : "record"} size={recorded ? 20 : 24} />
      </button>
    </div>
  );
}
