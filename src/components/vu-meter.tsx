import { useEffect, useLayoutEffect, useRef } from "react";

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
  /**
   * Whether `readLevel` can be trusted THIS FRAME. A PULL like `readLevel`,
   * polled in the same rAF loop: a live tap on a context that is not `"running"`
   * (iOS `"suspended"`/`"interrupted"` after backgrounding or an interruption)
   * reads zeros indistinguishable from a dead mic, so on a false the strip
   * hatches "unavailable" for that frame instead of animating to empty (#76). It
   * self-recovers to animating the moment the context resumes. Defaults to always
   * available, so a caller with no runtime meter state is unaffected. Distinct
   * from `unavailable` below, which is the STATIC open-time failure.
   */
  readAvailable?: () => boolean;
  /** Whether capture is live. While false the strip rests empty and the loop is off. */
  active: boolean;
  /**
   * The level tap could not be wired on this device (a permanent, open-time
   * failure). The strip shows a hatched, dimmed "unavailable" state instead of an
   * empty bar, so a permanently-empty meter is not mistaken for a dead microphone
   * (Frank R-B6), and it also sets the accessible name. The per-frame runtime
   * equivalent — a wired tap on a suspended context — is `readAvailable` (#76).
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
 * hardcoded. `transform`/`data-zone`/`data-state` are set imperatively and never
 * declared in JSX, so a parent re-render cannot clobber the live values — which
 * matters most for the per-frame hatch (#76): with `data-state` in JSX a re-render
 * while the context is suspended would flip it off for a frame and flicker.
 */
export function VuMeter({
  readLevel,
  readAvailable = () => true,
  active,
  unavailable = false,
  label,
  unavailableLabel,
  className,
}: VuMeterProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const fillRef = useRef<HTMLDivElement | null>(null);
  // Hold the latest readers without retriggering the loop: the hook may hand us
  // a fresh function identity each render, and restarting the loop for that
  // would drop frames for no reason. Synced in an effect, not during render.
  const readLevelRef = useRef(readLevel);
  useEffect(() => {
    readLevelRef.current = readLevel;
  }, [readLevel]);
  const readAvailableRef = useRef(readAvailable);
  useEffect(() => {
    readAvailableRef.current = readAvailable;
  }, [readAvailable]);

  // `useLayoutEffect`, not `useEffect`: on a `meterFailed`+`active` mount the
  // static hatch below must land BEFORE the browser paints, or the freshly
  // mounted meter shows one frame of an empty full-opacity track — the dead-mic
  // look R-B6 forbids — until a passive effect runs (George R1 P3). Same reason,
  // same precedent as `LiveScope`'s first paint (`live-scope.tsx:87-92`). The
  // `data-state` write stays imperative (out of JSX) so a per-frame `elapsedMs`
  // re-render cannot clobber the live hatch; the `aria-label` remains declarative,
  // so accessibility is unaffected by the effect timing.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const fill = fillRef.current;
    if (!root || !fill) return;

    // Empty the fill and mark the track hatched — the shared shape of both the
    // static open-time failure and a per-frame suspended context.
    const hatch = () => {
      fill.style.transform = "scaleX(0)";
      delete fill.dataset.zone;
      root.dataset.state = "unavailable";
    };
    // Empty the fill and clear both the zone and the hatch — the resting look.
    const rest = () => {
      fill.style.transform = "scaleX(0)";
      delete fill.dataset.zone;
      delete root.dataset.state;
    };

    if (!active) {
      rest();
      return;
    }
    if (unavailable) {
      // Open-time tap failure: a static hatch, no loop to run.
      hatch();
      return;
    }

    let raf = 0;
    let lastZone = "";
    // Track the hatch/animate state so the DOM is touched only on a transition,
    // not every frame — the same "only on change" rule the zone attribute uses.
    let hatched: boolean | null = null;
    const tick = () => {
      if (!readAvailableRef.current()) {
        // A wired tap whose context went suspended/interrupted mid-take (#76):
        // the analyser reads zeros, so an animated bar would fall to empty and
        // read as a dead mic. Hatch instead until the context resumes.
        if (hatched !== true) {
          hatch();
          hatched = true;
          lastZone = "";
        }
        raf = requestAnimationFrame(tick);
        return;
      }
      if (hatched !== false) {
        delete root.dataset.state;
        hatched = false;
      }
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

  // The accessible NAME reflects only the persistent open-time failure, keyed on
  // `unavailable` while a take is live — a decorative meter's label "speaks once,
  // not per frame", so a transient suspended-context hatch (#76) changes the
  // visual (via `data-state`, imperatively) without churning the a11y name.
  const showUnavailable = active && unavailable;

  return (
    <div
      ref={rootRef}
      className={cn("vu-meter", className)}
      role="img"
      aria-label={showUnavailable ? unavailableLabel : label}
    >
      <div className="vu-meter__track">
        <div ref={fillRef} className="vu-meter__fill" />
      </div>
    </div>
  );
}
