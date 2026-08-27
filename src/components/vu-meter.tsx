import { useEffect, useRef } from "react";

import { meterZone, toDisplayLevel } from "@/lib/audio/meter";
import { cn } from "@/lib/utils";

interface VuMeterProps {
  /**
   * Reads the live capture level, in the raw amplitude domain `toDisplayLevel`
   * maps from. Returns 0 when nothing is recording. Per D-LEVEL-PULL this is a
   * PULL: the meter polls it on its own frame clock so the recorder never
   * re-renders per frame.
   */
  readLevel: () => number;
  /** Whether capture is live. While false the strip rests empty and the loop is off. */
  active: boolean;
  /**
   * The whole accessible name. A meter is decorative status, so the graphic is
   * hidden from the reader and this label speaks for it once, not per frame.
   */
  label: string;
  className?: string;
}

/**
 * The green/yellow/red level strip under the waveform (mockup 3).
 *
 * It owns its per-frame update. While `active`, a requestAnimationFrame loop
 * pulls `readLevel()`, maps it to a 0..1 display fraction and a zone via the
 * pure `@/lib/audio/meter` functions, and writes the bar's width and zone
 * straight to the DOM — no React state, so only this element repaints and the
 * loop stops cleanly when `active` goes false or the component unmounts.
 *
 * The fraction and zone thresholds live in `lib/audio/meter`; nothing here is
 * hardcoded. `transform`/`data-zone` are set imperatively and never declared in
 * JSX, so a parent re-render cannot clobber the live values.
 */
export function VuMeter({ readLevel, active, label, className }: VuMeterProps) {
  const fillRef = useRef<HTMLDivElement | null>(null);
  // Hold the latest reader without retriggering the loop: the hook may hand us
  // a fresh function identity each render, and restarting the loop for that
  // would drop frames for no reason. Synced in an effect, not during render.
  const readLevelRef = useRef(readLevel);
  useEffect(() => {
    readLevelRef.current = readLevel;
  }, [readLevel]);

  useEffect(() => {
    const fill = fillRef.current;
    if (!fill) return;

    if (!active) {
      // Rest strip: empty and un-zoned, nothing animating.
      fill.style.transform = "scaleX(0)";
      delete fill.dataset.zone;
      return;
    }

    let raf = 0;
    let lastZone = "";
    const tick = () => {
      const fraction = toDisplayLevel(readLevelRef.current());
      fill.style.transform = `scaleX(${fraction})`;
      const zone = meterZone(fraction);
      // Only touch the attribute on a change; width is what moves every frame.
      if (zone !== lastZone) {
        fill.dataset.zone = zone;
        lastZone = zone;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  return (
    <div className={cn("vu-meter", className)} role="img" aria-label={label}>
      <div className="vu-meter__track">
        <div ref={fillRef} className="vu-meter__fill" />
      </div>
    </div>
  );
}
