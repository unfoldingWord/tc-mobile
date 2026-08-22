import { SectionCell } from "./section-cell";
import { SectionRow } from "./section-row";
import type { ChapterCard, SectionCard } from "@/types/view";

interface SectionBrowserProps {
  chapter: ChapterCard;
  nextSectionId: string | null;
  playingSectionId: string | null;
  onOpen: (section: SectionCard) => void;
  onQuickAction: (section: SectionCard) => void;
}

/**
 * The section browser.
 *
 * One conditional decides everything: **a chapter with artwork is browsed by
 * picture; a chapter without one is browsed by sound.** Layout and tap
 * behaviour both follow from it, and both branches render the same
 * `SectionCard` model — this is two compositions of one thing, not two
 * features.
 */
export function SectionBrowser({
  chapter,
  nextSectionId,
  playingSectionId,
  onOpen,
  onQuickAction,
}: SectionBrowserProps) {
  if (chapter.hasArtwork) {
    return (
      <div className="grid grid-cols-2 gap-[6px]">
        {chapter.sections.map((section) => (
          <SectionCell
            key={section.sectionId}
            section={section}
            isNext={section.sectionId === nextSectionId}
            onOpen={onOpen}
            onQuickAction={onQuickAction}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[6px]">
      {chapter.sections.map((section) => (
        <SectionRow
          key={section.sectionId}
          section={section}
          isNext={section.sectionId === nextSectionId}
          isPlaying={section.sectionId === playingSectionId}
          onOpen={onOpen}
          onQuickAction={onQuickAction}
        />
      ))}
    </div>
  );
}
