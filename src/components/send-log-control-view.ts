import type { IconName } from "./icon";
import type { NoticeTone } from "./notice-tone";
import { shareSettledGlyph } from "./share-outcome-glyph";
import { strings } from "@/lib/strings";

/**
 * The label {@link SendLogControl} shows — as the control's accessible name
 * (unchanged from before #1088) AND, new for #1088 item 2, as VISIBLE text
 * under the glyph.
 *
 * `Control`'s own docblock says the visible UI carries no text everywhere
 * else, on purpose: a zero-text screen is the point for a translator who may
 * not read. This control is the one exception the DRI named — it is "for the
 * facilitator standing next to the translator, not for the translator"
 * (`send-log-control.tsx`'s own header) — and a facilitator can read. Pure,
 * so the cell a test calls is the same one that decides the accessible name,
 * not a second copy of the ternary that could drift from it — the shape
 * `control-affordance.ts` already uses for the neighbouring Share controls.
 */
export function sendLogLabel(ready: boolean, sendUnconfirmed: boolean): string {
  if (ready) return strings.shareSend;
  return sendUnconfirmed
    ? strings.shareFailureLogUnconfirmed
    : strings.shareFailureLog;
}

/**
 * What a send settled to, for the purpose of the state-in-place confirmation
 * below. A subset of `useFailureLogShare().send()`'s own `ShareOutcome`:
 * `retry` and `failed` are not a hand-off at all (nothing left the phone, and
 * `failed` already has its own error line), and `superseded` means a NEWER
 * run owns the screen now, so the stale run's resolve says nothing about it.
 */
export type SendLogHandoff = "sent" | "dismissed" | "unproven";

export interface SendLogHandoffView {
  readonly icon: IconName;
  readonly tone: NoticeTone;
  readonly text: string;
}

/**
 * The state-in-place confirmation after a hand-off (#1088 item 2).
 *
 * Before this, only an UNPROVEN send left any trace on screen at all —
 * `sendUnconfirmed` relabels the idle control on its very next render. A
 * PROVEN send or a dismissed sheet left the screen exactly as it was a
 * moment before the tap, with nothing telling the facilitator the gesture
 * had done anything.
 *
 * Reuses the SAME outcome table and copy the chapter/book share overlay
 * settles on — `share-outcome-glyph.ts`'s `shareSettledGlyph` (the D16
 * table) and `strings.shareSent` / `shareDismissed` / `shareUnproven` —
 * rather than inventing a fourth vocabulary for a fourth share surface. By
 * construction this cannot say "sent" or "delivered": those three strings
 * are the ones that already follow the rule `shareSent`'s own comment states
 * (`strings.ts`) — the app can only say the log reached the OS share sheet,
 * never that anything received it.
 */
export function sendLogHandoffView(
  outcome: SendLogHandoff
): SendLogHandoffView {
  const glyph = shareSettledGlyph(outcome);
  switch (outcome) {
    case "sent":
      return { icon: glyph.icon, tone: glyph.tone, text: strings.shareSent };
    case "dismissed":
      return {
        icon: glyph.icon,
        tone: glyph.tone,
        text: strings.shareDismissed,
      };
    case "unproven":
      return {
        icon: glyph.icon,
        tone: glyph.tone,
        text: strings.shareUnproven,
      };
    default: {
      const unhandled: never = outcome;
      return unhandled;
    }
  }
}
