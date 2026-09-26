import { forwardRef } from "react";

import { Icon, type IconName } from "./icon";
import type { ShareO4View } from "./share-o4-view";
import { strings } from "@/lib/strings";

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
  /**
   * What the O4 circle draws (`shareO4View`), present only while the O4
   * design is on (#947). Absent, the panel renders exactly the markup it
   * always has, which is what keeps the current look unchanged.
   */
  o4?: ShareO4View;
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
>(function ShareProgressPanel({ role, icon, text, o4 }, ref) {
  if (o4 === undefined)
    return (
      <div ref={ref} tabIndex={-1} role={role} className="share-progress">
        <Icon name={icon} size={48} className="share-progress-glyph" />
        <span className="share-progress-text">{text}</span>
      </div>
    );
  return (
    <div ref={ref} tabIndex={-1} role={role} className="share-progress">
      {o4.chips.length > 0 && <O4Chips chips={o4.chips} />}
      <O4Circle view={o4} />
      <span className="share-progress-text">{text}</span>
    </div>
  );
});

/**
 * The workbench's numbered chips (D21, `vShare`'s `.schips`): one per item,
 * in order, above the circle. A finished chip shows a check; every other
 * chip shows its item's number. The row is one image labelled "N of M go
 * out" and each chip inside it is `aria-hidden`: the chips are decorative
 * (D22), and the label says what they add.
 */
function O4Chips({ chips }: { chips: ShareO4View["chips"] }) {
  const out = chips.filter((c) => c.state !== "stays").length;
  return (
    <span
      className="share-o4-chips"
      role="img"
      aria-label={strings.shareItemsGoOut(out, chips.length)}
    >
      {chips.map((chip, i) => (
        <span
          key={i}
          className="share-o4-chip"
          data-chip={chip.state}
          aria-hidden="true"
        >
          {chip.state === "finished" ? (
            <Icon name="check" size={18} />
          ) : (
            chip.label
          )}
        </span>
      ))}
    </span>
  );
}
/** The workbench's ring: radius 84 on a 176 box, stroke 7 (states 15/G7). */
const RING_RADIUS = 84;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * The O4 140-in-176 circle (#947): the filling ring, when there is a count
 * to fill it by, around the core that holds the glyph. Its colours, and the
 * outcome rings D14 and D16 draw, are `o4/share.css`'s, keyed on the scrim's
 * `data-outcome`. The ring is `aria-hidden`. The core is a progress bar
 * while the view gives it a meter (D22), labelled from `strings.ts` and
 * valued 0 to 100, with no value before the first count; on an outcome it
 * is a plain box and the panel's role and text carry the state, as in the
 * current look.
 */
function O4Circle({ view }: { view: ShareO4View }) {
  const meter = view.meter;
  return (
    <span className="share-o4-frame">
      {view.ring !== null && (
        <svg className="share-o4-ring" viewBox="0 0 176 176" aria-hidden="true">
          <circle className="share-o4-track" cx="88" cy="88" r={RING_RADIUS} />
          <circle
            className="share-o4-fill"
            cx="88"
            cy="88"
            r={RING_RADIUS}
            strokeDasharray={RING_LENGTH}
            strokeDashoffset={RING_LENGTH * (1 - view.ring)}
          />
        </svg>
      )}
      <span
        className="share-o4-core"
        {...(meter === null
          ? {}
          : {
              role: "progressbar",
              "aria-label": strings.sharePreparingLabel,
              "aria-valuemin": 0,
              "aria-valuemax": 100,
              ...(meter.now === null ? {} : { "aria-valuenow": meter.now }),
            })}
      >
        <Icon name={view.icon} size={52} className="share-o4-glyph" />
      </span>
    </span>
  );
}
