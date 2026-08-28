import { Control } from "./control";
import type { IconName } from "./icon";

interface EmptyStateProps {
  /** A confident headline — a beginning, not an apology (ui-craft §21). */
  headline: string;
  /**
   * One line that teaches the vocabulary and reassures on offline. On a screen
   * built for people who may not read, this is spoken by a screen reader and is
   * the attach point for a future spoken-prompt layer (see `strings.ts`).
   */
  teach: string;
  /**
   * The single present primary action. While the invite is up, the screen hides
   * its header create control, so this is the one create affordance on the
   * screen — visually and to a screen reader. `label` is the whole accessible
   * name.
   */
  ctaLabel: string;
  ctaIcon: IconName;
  onCta: () => void;
}

/**
 * The invite empty state (ui-craft §21): confident headline, one teaching line,
 * one present primary CTA. Shared by Books and Segments so the two read as one
 * beginning, not two ad-hoc "nothing here" notes.
 */
export function EmptyState({
  headline,
  teach,
  ctaLabel,
  ctaIcon,
  onCta,
}: EmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-[14px] px-[24px] text-center">
      <p className="t-title" style={{ color: "var(--s-ink)" }}>
        {headline}
      </p>
      <p
        className="max-w-[28ch] text-[13px]"
        style={{ color: "var(--s-ink-muted)" }}
      >
        {teach}
      </p>
      <Control
        icon={ctaIcon}
        label={ctaLabel}
        variant="primary"
        size={28}
        onClick={onCta}
      />
    </div>
  );
}
