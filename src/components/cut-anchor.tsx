import { type CSSProperties, type ReactNode } from "react";

import { cutAnchorPercent } from "./recorder-stage";
import type { WaveformViewport } from "@/lib/audio/viewport";
import type { SampleRange } from "@/types/audio";

interface CutAnchorProps {
  /** The open selection frame, or `null` when nothing is picked — the bin
   *  (#862) renders through this component too, with no selection to
   *  center under. */
  readonly selection: SampleRange | null;
  readonly win: WaveformViewport;
  readonly children: ReactNode;
}

/**
 * Positions the Cut affordance under the SELECTION's own midpoint (#1102),
 * not the stage: the reported bug was the scissors sitting at the stage's
 * centre, drifting off-center under the band as it moved or changed length.
 *
 * Extracted out of `recorder.tsx`'s JSX (the same move #513 made for
 * `CenterlineOverlay`) so one thing both calls the pure percentage
 * ({@link cutAnchorPercent}) and owns the element it positions — a render
 * test can assert the actual `--o4-cut-left` the wrapper carries, not just the
 * source text of the call.
 *
 * With no selection, renders `children` unwrapped: the bin (#862) shares
 * `.recorder-cut` with the scissors but has no span to center under, and
 * `.recorder-cut`'s own `justify-content: center` (3-components.css) still
 * centers it at the stage — unchanged from before #1102.
 *
 * The actual positioning is CSS, scoped under `[data-design="o4"]`
 * (`o4/recorder.css`): this component always sets `--o4-cut-left` when there is
 * a selection, in every look, but the "current" look's stylesheet has no
 * matching rule for `.cut-anchor`, so the property sits unused there and the
 * wrapper renders as an ordinary flex child — the same centered position
 * `justify-content: center` already gave it.
 */
export function CutAnchor({ selection, win, children }: CutAnchorProps) {
  const percent = cutAnchorPercent(selection, win);
  if (percent === null) return <>{children}</>;

  return (
    <div
      className="cut-anchor"
      style={{ "--o4-cut-left": `${percent}%` } as CSSProperties}
    >
      {children}
    </div>
  );
}
