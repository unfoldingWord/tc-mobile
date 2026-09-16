/**
 * What a busy `Control` and a ready `Control` look like — one table,
 * mirroring `notice-tone.ts`'s rule that a wait and a result must never share
 * a mark (#112). Before this, `Control`'s `busy` set `aria-busy` and nothing
 * painted or read differently (#383), and Share's `ready` state changed only
 * the box size and label — a glyph a non-reader can tell from `preparing` had
 * no visible expression at all (#354).
 *
 * Two tables, not one, because the two callers have different shapes: Share
 * is a three-state "prepare then send" flow (idle → preparing → ready); a
 * Confirm — New Book's, and Rename's Save, which has the identical
 * write-in-flight-with-a-silent-control gap today — is only ever idle or
 * busy, with no staged second tap.
 */

import type { ShareStatus } from "@/hooks/share-flow";
import type { IconName } from "./icon";

export interface ShareControlAffordance {
  readonly icon: IconName;
  readonly variant: "quiet" | "primary";
  /** Forwarded to `Control`'s `busy` — sets `aria-busy` and the layer-3 spin. */
  readonly busy: boolean;
  /**
   * Forwarded to `Control`'s `className`. Only `ready` carries one — the
   * `--s-done` glyph tint (`.control-ready`, 3-components.css) — so the tone
   * lives in this table rather than being reattached by hand at each call
   * site (George R1 P3, #384: an omitted class would silently ship a ready
   * Control with the check glyph and the XL box but none of the "yes, this
   * is so" ink #354 asks for).
   */
  readonly className: string | undefined;
}

/**
 * `idle`: the plain share glyph, the same size as every other quiet control
 * on the row. `preparing`: the retry glyph — the same wait mark `Notice`'s
 * `busy` tone already wears — spinning, `aria-busy`, box size UNCHANGED
 * (#164, #351: a size change on tap reflows the row around it). `ready`: the
 * check glyph — the "yes, this is so" mark `is-done`/`is-on` already wear —
 * on the existing primary/XL variant.
 */
export function shareControlAffordance(
  status: ShareStatus
): ShareControlAffordance {
  switch (status) {
    case "idle":
      return {
        icon: "share",
        variant: "quiet",
        busy: false,
        className: undefined,
      };
    case "preparing":
      return {
        icon: "retry",
        variant: "quiet",
        busy: true,
        className: undefined,
      };
    case "ready":
      return {
        icon: "check",
        variant: "primary",
        busy: false,
        className: "control-ready",
      };
  }
}

export interface ConfirmControlAffordance {
  readonly icon: IconName;
  readonly busy: boolean;
}

/**
 * A single Confirm `Control`'s affordance while its write is in flight. The
 * retry glyph while `saving`, the check glyph once it is safe to tap again —
 * never the reverse, and never the same glyph for both, or the control would
 * read as idle during the write, which is the defect #383 names.
 */
export function confirmControlAffordance(
  saving: boolean
): ConfirmControlAffordance {
  return saving
    ? { icon: "retry", busy: true }
    : { icon: "check", busy: false };
}

/**
 * Whether a dismiss — `Menu`'s scrim tap, its Close control, or Escape when no
 * child already handled it — may proceed while a Confirm's write is in flight
 * (George R3, #384). The write itself cannot be aborted, so letting the
 * dismiss through does not stop it: it still commits moments later with no
 * menu open to show it. The same "Cancel is a no-op while in flight" rule
 * `EraseConfirm`'s Cancel already follows, pulled out as its own decision so
 * it is pinned once rather than re-derived at each call site.
 */
export function canDismissWhileSaving(saving: boolean): boolean {
  return !saving;
}
