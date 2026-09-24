import { forwardRef } from "react";

import { Icon, type IconName } from "./icon";

interface ShareProgressPanelProps {
  /** From `noticePresentation(glyph.tone).role` — never a caller-chosen
   *  dialog role; see `share-progress.tsx`'s own header on why this never
   *  wears `role="dialog"`. */
  role: "alert" | "status";
  /** `"share-busy"` while the overlay is busy, or one of
   *  `shareSettledGlyph`'s outcome marks once it has settled. */
  icon: IconName;
  /** `shareProgressText(progress, scope)` — the secondary line under the
   *  glyph; the glyph itself carries the meaning (#491). `null` only for the
   *  `hidden` phase, which `ShareProgress` never reaches this panel for. */
  text: string | null;
}

/**
 * `ShareProgress`'s own panel, pulled out of that component so it can
 * actually be RENDERED and read (#197).
 *
 * `ShareProgress` portals its content to `document.body`
 * (`createPortal`), and `react-dom/server`'s `renderToStaticMarkup` —
 * `tests/render.ts`'s whole mechanism — cannot render a portal at all
 * ("Portals are not currently supported by the server renderer"). So before
 * this split, nothing in `tests/` could mount the panel and read which icon
 * it actually emits while busy; a wrong or reverted icon name would compile,
 * pass every existing test, and only be caught by eye. The same gap
 * `RecorderStatus` was lifted out of `recorder.tsx` to close
 * (`tests/recorder-status.test.ts`), for the same reason.
 *
 * This component owns none of `ShareProgress`'s focus-grab or keydown-
 * capture logic — those stay in `ShareProgress`, which forwards its own
 * `panelRef` in here as `ref`, so the DOM node this focuses is the same node
 * it always was.
 */
export const ShareProgressPanel = forwardRef<
  HTMLDivElement,
  ShareProgressPanelProps
>(function ShareProgressPanel({ role, icon, text }, ref) {
  return (
    <div ref={ref} tabIndex={-1} role={role} className="share-progress">
      <Icon name={icon} size={48} className="share-progress-glyph" />
      <span className="share-progress-text">{text}</span>
    </div>
  );
});
