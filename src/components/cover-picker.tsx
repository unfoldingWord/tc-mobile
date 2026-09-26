import {
  COVER_COLOUR_KEYS,
  coverColourHex,
  type CoverColourKey,
} from "@/lib/cover-colour";
import { strings } from "@/lib/strings";
import { coverColourName } from "./cover-colour-copy";
import { Icon } from "./icon";

export interface CoverPickerProps {
  /** The book's resolved colour (`lib/cover-colour.ts`'s `resolveCoverKey`) —
   *  always one live palette key, never `null`: a book always shows SOME
   *  colour, chosen or derived, and this row is what marks which one. */
  selected: CoverColourKey;
  /** Called with the tapped swatch's key. The caller (the sheets lane's
   *  new-book sheet, #943, or the menus lane's book menu, #949) owns the
   *  write — this component is presentation only and holds no store call. */
  onSelect: (key: CoverColourKey) => void;
  /** Disables every swatch while a write from a previous tap is in flight —
   *  the same shape `Control`'s `busy` disables a single button on. */
  disabled?: boolean;
}

/**
 * A row of cover-colour swatches (#957, from #937's D7/D8).
 *
 * Mounted in the O4 book menu (#949, `o4-book-menu.tsx`'s `O4CoverPick`).
 * The new-book sheet (#943) does not mount it yet.
 *
 * Each swatch is a real `<button>`, not a coloured `<div>` with a click
 * handler: `aria-pressed` is the machine-readable half of its selected state
 * and a `<div>` cannot carry one. The fill colour is set inline
 * (`style={{ backgroundColor }}`) rather than through a themed CSS role —
 * `lib/cover-colour.ts`'s docblock is where that boundary is argued, not
 * repeated here. The selected ring is the one themed part of this markup
 * (`.cover-swatch[aria-pressed="true"]` in `3-components.css`), because
 * unlike the fill it is a UI affordance that may legitimately want more
 * contrast in one theme than the other.
 *
 * The selected check glyph is painted white (inline, alongside the fill, for
 * the same reason the fill itself is inline). Every one of the ten final
 * hexes (#937 D8b, decided 2026-09-25) reads as a medium-to-dark, moderately
 * saturated colour by eye, which is why white was chosen over an ink role —
 * but that is an unverified assumption, not a measured claim: no test in this
 * PR computes a WCAG ratio for white against each hex the way
 * `tests/contrast.test.ts` does for the theme's own roles. Flagged as a
 * residual for whichever lane (#943 or #949) first renders this for real.
 */
export function CoverPicker({
  selected,
  onSelect,
  disabled,
}: CoverPickerProps) {
  return (
    <div
      role="group"
      aria-label={strings.coverColourLabel}
      className="cover-swatch-row"
    >
      {COVER_COLOUR_KEYS.map((key) => {
        const isSelected = key === selected;
        const name = coverColourName(key);
        return (
          <button
            key={key}
            type="button"
            className="cover-swatch"
            style={{ backgroundColor: coverColourHex(key), color: "#fff" }}
            aria-pressed={isSelected}
            aria-label={strings.coverSwatchLabel(name, isSelected)}
            title={name}
            disabled={disabled}
            onClick={() => onSelect(key)}
          >
            {isSelected ? (
              // Decorative for AT — the accessible name above already says
              // "selected". White, not an ink role — see the docblock above
              // for why, and for what is NOT verified about it.
              <Icon name="check" size={16} />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
