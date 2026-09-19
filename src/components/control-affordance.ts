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
 * Confirm is only ever idle or busy, with no staged second tap. `NameEdit`'s
 * one save Control is the shared caller for both its uses — Rename's Save
 * and New Book's Create (#314/#367) — which is what keeps the glyph/label
 * swap identical on both rather than each inventing its own.
 */

import type { ShareStatus } from "@/hooks/share-flow";
import type { SharePlatform } from "@/hooks/share-target";
import type { IconName } from "./icon";

/**
 * The Share control's idle mark is the PLATFORM'S own (#490, decided
 * 2026-09-19 by the dev lead): Android's three joined dots on the Android
 * build, the tray-with-up-arrow on iOS and the web. The phone has already
 * taught the person that glyph, and the one field data point on the tray
 * (#249's tester comment, Android v0.2.4) is that it did not convey what it
 * would do. `platform` comes from `readSharePlatform()` — the Capacitor
 * runtime, never the user agent. The accessible name is the screen's, from
 * `strings`, and is identical on every platform: only the shape moves.
 *
 * One table for every Share control in the app — the two menus, the failure
 * log's Send, the held-take rescue — so one build never shows two different
 * share marks.
 */
export function shareControlGlyph(platform: SharePlatform): IconName {
  return platform === "android" ? "share-android" : "share";
}

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
 * `idle`: the platform's share glyph ({@link shareControlGlyph}), the same
 * size as every other quiet control on the row. `preparing`: the retry glyph
 * — the same wait mark `Notice`'s `busy` tone already wears — spinning,
 * `aria-busy`, box size UNCHANGED (#164, #351: a size change on tap reflows
 * the row around it). `ready`: the check glyph — the "yes, this is so" mark
 * `is-done`/`is-on` already wear — on the existing primary/XL variant. Only
 * `idle` varies by platform: the wait and the "yes" are the same on every
 * phone.
 *
 * `unconfirmed` (George r2 P2-2, #491) — {@link UseShareFlow.sendUnconfirmed}
 * — overrides the `idle` cell only: `preparing` and `ready` already speak for
 * themselves (a fresh attempt is underway or armed), and a translator only
 * needs telling apart "never tried" from "tried, unconfirmed" at the resting
 * state a plain tray glyph would otherwise show for both. Reuses the
 * `dismissed` outcome's own arrow-back-down mark (`share-outcome-glyph.ts`'s
 * `shareSettledGlyph` makes the identical choice for the modal's own glyph,
 * for the identical reason: not a fourth mark, and not `sent`'s tick, which
 * this resolve did not earn) rather than inventing a new one — the caller
 * pairs it with a distinct accessible label (the "unconfirmed" strings), so
 * the control is not silently mistaken for the plain `idle` cell by a reader
 * relying on the label alone.
 */
export function shareControlAffordance(
  status: ShareStatus,
  platform: SharePlatform,
  unconfirmed = false
): ShareControlAffordance {
  switch (status) {
    case "idle":
      return {
        icon: unconfirmed ? "share-closed" : shareControlGlyph(platform),
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
