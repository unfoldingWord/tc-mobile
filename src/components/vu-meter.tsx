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
   * The level tap could not be wired on this device. The strip shows a hatched,
   * dimmed "unavailable" state instead of an empty bar, so a permanently-empty
   * meter is not mistaken for a dead microphone (Frank R-B6). The loop is off.
   */
  unavailable?: boolean;
  /**
   * The whole accessible name. A meter is decorative status, so the graphic is
   * hidden from the reader and this label speaks for it once, not per frame.
   */
  label: string;
  /** The accessible name while `unavailable` — distinct from a resting meter. */
  unavailableLabel: string;
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
export function VuMeter({
  readLevel,
  active,
  unavailable = false,
  label,
  unavailableLabel,
  className,
}: VuMeterProps) {
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

    if (!active || unavailable) {
      // Rest / unavailable: empty and un-zoned, nothing animating. (Unavailable
      // adds a hatched track via data-state below; the fill stays empty.)
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
  }, [active, unavailable]);

  // Surface "unavailable" only while a take is live — the moment an empty strip
  // could be misread as a dead mic. At idle the meter rests empty either way, and
  // a stale failure from a prior take should not pre-emptively read as broken.
  const showUnavailable = active && unavailable;

  return (
    <div
      className={cn("vu-meter", className)}
      role="img"
      aria-label={showUnavailable ? unavailableLabel : label}
      data-state={showUnavailable ? "unavailable" : undefined}
    >
      <div className="vu-meter__track">
        <div ref={fillRef} className="vu-meter__fill" />
      </div>
    </div>
  );
}
