import { Icon } from "./icon";
import { Waveform } from "./waveform";
import { cn } from "@/lib/utils";
import type { SectionCard } from "@/types/view";

interface SectionCellProps {
  section: SectionCard;
  isNext: boolean;
  onOpen: (section: SectionCard) => void;
  onQuickAction: (section: SectionCard) => void;
}

/**
 * A grid cell, for a chapter that has artwork.
 *
 * The picture *is* the row: it fills the cell and state overlays it on a scrim.
 * Tapping the cell **enters** the section, because with artwork present the
 * picture identifies it well enough that entering is the useful move — and the
 * frame is full width in there.
 */
export function SectionCell({
  section,
  isNext,
  onOpen,
  onQuickAction,
}: SectionCellProps) {
  const recorded = section.durationMs !== null;

  return (
    <div className={cn("cell", isNext && "cell--next")}>
      <button
        type="button"
        onClick={() => onOpen(section)}
        aria-label={`Open section ${section.ordinal}${
          recorded ? ", recorded" : ", not yet recorded"
        }`}
        className="absolute inset-0 h-full w-full cursor-pointer border-0 bg-transparent p-0"
      >
        {section.thumbUrl && (
          <img
            src={section.thumbUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        )}
      </button>

      <span
        className="t-ordinal pointer-events-none absolute top-0 left-0 rounded-br-[10px] px-[7px] py-[4px]"
        style={{ background: "var(--s-scrim)", color: "var(--s-ink)" }}
      >
        {section.ordinal}
      </span>

      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end gap-[6px] px-[8px] pt-[26px] pb-[7px]"
        style={{
          backgroundImage:
            "linear-gradient(to top, var(--s-scrim), transparent)",
        }}
      >
        <span className="min-w-0 flex-1">
          <Waveform peaks={section.peaks} height={18} recorded={recorded} />
        </span>
        <button
          type="button"
          onClick={() => onQuickAction(section)}
          aria-label={
            recorded
              ? `Play section ${section.ordinal}`
              : `Record section ${section.ordinal}`
          }
          className={cn(
            "control pointer-events-auto h-[34px] w-[34px] flex-none",
            recorded ? "control--play" : "control--record"
          )}
        >
          <Icon name={recorded ? "play" : "record"} size={16} />
        </button>
      </div>
    </div>
  );
}
