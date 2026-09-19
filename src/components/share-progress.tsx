import { createPortal } from "react-dom";

import { Icon } from "./icon";
import { noticePresentation } from "./notice-tone";
import { shareProgressText } from "./share-error-copy";
import { shareSettledGlyph } from "./share-outcome-glyph";
import type { ShareProgress as ShareProgressState } from "@/hooks/share-progress";

interface ShareProgressProps {
  /** The hook's timeline. Renders nothing while `hidden`. */
  progress: ShareProgressState;
  /** Picks the secondary text only — the glyphs are the same for both. */
  scope: "chapter" | "book";
  /**
   * A scrim tap while BUSY. Wired to the screen's menu close, which resets
   * the flow: the same cancel a tap on the menu's own scrim gave before this
   * overlay covered it, so a long book encode still has a pointer cancel.
   */
  onCancel: () => void;
  /** A tap anywhere while an OUTCOME is showing: end the flash early. */
  onDismiss: () => void;
}

/**
 * The share modal (#491): one large glyph over a scrim while a share is
 * prepared and handed over, then one outcome glyph — handed to the sheet,
 * dismissed, nothing to share, failed — for a moment, then gone.
 *
 * A share that succeeded on the Android APK looked exactly like one the
 * translator had dismissed (#336's 2026-09-17 report). The busy state was a
 * line of text in the menu and the outcome was absent; for a person who may
 * not read that is the worst of both. This is the state-in-place answer: the
 * glyph is the signal, the line under it is secondary, and the timing — the
 * minimum busy hold, the outcome hold — is the hook's, provable in Node
 * (`hooks/share-progress.ts`), not this component's.
 *
 * Presentational only. Rendered by each screen as a SIBLING of its `Menu`,
 * portalled to `<body>` like `EraseConfirm`, so it survives the menu closing
 * and sits above it (z 90 over the menu's 80; the two are never up together
 * with the confirm, which the screens close the menu before arming).
 *
 * Not a dialog. It has no controls and traps nothing, so it is a live region
 * over a scrim: `role` comes from the tone table (`status` for a wait or a
 * heads-up, `alert` for a failure) and never from the caller — the same rule
 * `Notice` states. Focus is deliberately not moved: `Control`'s `busy`
 * contract keeps focus on the control that started the work, and a modal that
 * grabbed it would have to hand it back on an auto-clear.
 */
export function ShareProgress({
  progress,
  scope,
  onCancel,
  onDismiss,
}: ShareProgressProps) {
  if (progress.phase === "hidden") return null;
  const busy = progress.phase === "busy";
  // The wait wears the same retry mark `Notice`'s `busy` tone does, spun by
  // the stylesheet; an outcome wears the table's mark for it.
  const glyph = busy
    ? { icon: noticePresentation("busy").icon, tone: "busy" as const }
    : shareSettledGlyph(progress.settled);
  const { role } = noticePresentation(glyph.tone);
  // The stylesheet keys the glyph's ink on this, not on the tone: success is
  // `--s-done`, not the `info` tone's amber.
  const outcome = busy ? "busy" : progress.settled;
  return createPortal(
    <div
      className="share-scrim"
      data-outcome={outcome}
      onClick={(e) => {
        // While busy only the scrim cancels — a tap on the panel itself is not
        // read as "stop the encode". An outcome clears on a tap anywhere.
        if (busy) {
          if (e.target === e.currentTarget) onCancel();
        } else onDismiss();
      }}
    >
      <div role={role} className="share-progress">
        <Icon name={glyph.icon} size={48} className="share-progress-glyph" />
        <span className="share-progress-text">
          {shareProgressText(progress, scope)}
        </span>
      </div>
    </div>,
    document.body
  );
}
