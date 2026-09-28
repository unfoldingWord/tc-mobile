import { forwardRef, type ComponentProps } from "react";

import { cn } from "@/lib/utils";
import { Control } from "./control";

/**
 * The O4 shared control wrappers (#941, epic #936): the four control shapes
 * O4's screens repeat — speaker 52, square 56 r14, row transport 72 and pill
 * 60 r30 (`docs/design/o4-design-system.md` §3).
 *
 * Each one IS a `Control` with a shape class and a default glyph size, never
 * a second button. `Control` already carries every accessibility guarantee
 * this app has paid for — `busy` keeping focus (#137), a hinted control
 * staying focusable and speaking its reason (#135), `pressed` (#286), the
 * guide ring (#604) — so a screen that swaps a `Control` for one of these in
 * its O4 branch keeps the same name and the same inert behaviour, which is
 * what #936's switch contract asks of every lane.
 *
 * The shapes live in `app/styles/o4/controls.css`, scoped under
 * `[data-design="o4"]`. These components do not read `useDesign()`
 * themselves: a screen renders them only in its O4 branch, and with the
 * switch off the class names match nothing.
 */
type ControlProps = ComponentProps<typeof Control>;

/**
 * The circular "hear this" button: the `hear` glyph on the well.
 *
 * @pivotpending O4 batch 1 — the Books, Segments and Recorder lanes (#942,
 * #944, #945) mount it; nothing does yet.
 */
export const SpeakerButton = forwardRef<
  HTMLButtonElement,
  Omit<ControlProps, "icon" | "variant" | "caption">
>(function SpeakerButton({ className, size = 24, ...rest }, ref) {
  return (
    <Control
      ref={ref}
      {...rest}
      icon="hear"
      size={size}
      className={cn("o4-speaker", className)}
    />
  );
});

/**
 * The 56 × 56 rounded square (New book, Add a segment). The Books header's
 * New book (#942) mounts it.
 */
export const SquareButton = forwardRef<
  HTMLButtonElement,
  Omit<ControlProps, "variant" | "caption">
>(function SquareButton({ className, size = 28, ...rest }, ref) {
  return (
    <Control
      ref={ref}
      {...rest}
      size={size}
      className={cn("o4-square", className)}
    />
  );
});

/**
 * A segment row's 72 × 72 play or record circle. `kind` picks `Control`'s
 * existing `play` or `record` variant, so the fill, the ink and the inert
 * desaturation are the ones those variants already have.
 *
 * @pivotpending O4 batch 1 — the Segments lane (#944) mounts it; nothing
 * does yet.
 */
export const TransportButton = forwardRef<
  HTMLButtonElement,
  Omit<ControlProps, "variant" | "caption"> & { kind: "play" | "record" }
>(function TransportButton({ kind, className, size = 30, ...rest }, ref) {
  return (
    <Control
      ref={ref}
      {...rest}
      variant={kind}
      size={size}
      className={cn("o4-transport", className)}
    />
  );
});

/**
 * The 60-tall pill with a glyph and a visible caption (Ask your helper, Send
 * report). The caption is shown, not announced: `label` stays the name.
 *
 * @pivotpending O4 batch 2 — the mic-denied and crash lane (#948) mounts it;
 * nothing does yet.
 */
export const PillButton = forwardRef<
  HTMLButtonElement,
  Omit<ControlProps, "variant" | "caption"> & { caption: string }
>(function PillButton({ className, size = 22, ...rest }, ref) {
  return (
    <Control
      ref={ref}
      {...rest}
      size={size}
      className={cn("o4-pill", className)}
    />
  );
});
