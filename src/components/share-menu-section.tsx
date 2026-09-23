import type { Ref } from "react";

import { Control } from "./control";
import { shareControlAffordance } from "./control-affordance";
import { Notice } from "./notice";
import { shareErrorText } from "./share-error-copy";
import { shareErrorGlyph, shareOutcomeGlyph } from "./share-outcome-glyph";
import { strings } from "./strings";
import { readSharePlatform } from "@/hooks/share-target";
import type { ShareError, ShareStatus } from "@/hooks/share-flow";

/**
 * The Share rows inside a ≡ menu — the two-gesture control and the three
 * things it can have to say (#160, L-15).
 *
 * Books and Segments each carried this, the same shape with a different noun:
 * the ready/not-ready Control pair, the preparing Notice, the gap Notice and
 * the error Notice, plus the same three derivations feeding them
 * (`shareControlAffordance` with `readSharePlatform()`, `shareOutcomeGlyph`,
 * `shareErrorGlyph`). All three move in here, so the two menus cannot drift
 * into painting the same flow differently.
 *
 * COPY stays at the call site. The three labels are props rather than a
 * scope-keyed table in here, because `strings.ts` is meant to be the one table
 * (#169) and a second one — even a two-row one — is how that stops being true.
 * `scope` is taken only for `shareErrorText`, which already keys on it.
 *
 * What is NOT here is everything around it: Books' menu also holds Rename, a
 * name field and Delete; Segments' holds only this. The menus stay their
 * screens', and this is the part of them that was the same.
 */
export interface ShareMenuSectionProps {
  status: ShareStatus;
  /** The last send settled `unproven` and nothing has re-armed (#491). */
  sendUnconfirmed: boolean;
  error: ShareError | null;
  /** Which noun the error copy uses. */
  scope: "book" | "chapter";
  /** The screen's focus-restore fallback — both menus keep one. */
  controlRef: Ref<HTMLButtonElement>;
  /** "Share chapter" / "Share book". */
  idleLabel: string;
  /** Shown on the control AND in the busy Notice, so they cannot disagree. */
  preparingLabel: string;
  /** The idle label's unconfirmed variant (#491). */
  unconfirmedLabel: string;
  /**
   * Something was left out of what tap 1 prepared. A boolean rather than a
   * count, because a chapter has one kind of gap and a book has two (#116) and
   * only the caller knows how to say so.
   */
  hasGap: boolean;
  /** How the caller says it. Read only while `hasGap`. */
  gapText: string;
  onPrepare: () => void;
  onSend: () => void;
}

export function ShareMenuSection({
  status,
  sendUnconfirmed,
  error,
  scope,
  controlRef,
  idleLabel,
  preparingLabel,
  unconfirmedLabel,
  hasGap,
  gapText,
  onPrepare,
  onSend,
}: ShareMenuSectionProps) {
  const affordance = shareControlAffordance(
    status,
    readSharePlatform(),
    sendUnconfirmed
  );
  const partial = shareOutcomeGlyph("partial");
  const errorText = shareErrorText(error, scope);
  const errorMark = shareErrorGlyph(error);

  return (
    <>
      {/* Two gestures, same spot: tap 1 encodes; once armed the control becomes
          a primary "Share now" that hands the File to the sheet in a fresh
          activation. autoFocus moves focus onto it as it appears, since the
          Menu only lands focus on its open edge. */}
      {status === "ready" ? (
        <Control
          ref={controlRef}
          icon={affordance.icon}
          label={strings.shareSend}
          variant={affordance.variant}
          className={affordance.className}
          autoFocus
          onClick={onSend}
        />
      ) : (
        // `busy`, not `disabled`, while preparing: the control must stay
        // enabled and focusable — a re-tap is already a no-op via the hook's
        // `preparingRef`, and disabling it would drop this control out of
        // Menu's FOCUSABLE set, breaking the Tab trap (George R-B7) — and
        // `busy` is what paints and reads that wait (#354).
        <Control
          ref={controlRef}
          icon={affordance.icon}
          label={
            status === "preparing"
              ? preparingLabel
              : sendUnconfirmed
                ? unconfirmedLabel
                : idleLabel
          }
          variant={affordance.variant}
          busy={affordance.busy}
          onClick={onPrepare}
        />
      )}
      {/* Feedback rides inside the panel because the flow keeps the menu open:
          the busy state while encoding, a gap warning once armed (`info`, not
          `busy` — it is ready, this is a heads-up about what it lacks, #112),
          and any error code mapped above. */}
      {status === "preparing" && <Notice tone="busy">{preparingLabel}</Notice>}
      {status === "ready" && hasGap && (
        // Its own mark, not `info`'s generic ring-and-i (#178): that glyph
        // also carries storage durability (#214/#406), so share would
        // otherwise share a shape with an unrelated condition.
        <Notice tone={partial.tone} icon={partial.icon}>
          {gapText}
        </Notice>
      )}
      {errorText && (
        // `nothing` and `failed` both wear the `alert` tone — that split is
        // #147's open question — so the mark is the only thing separating
        // "record a segment first" from "try again" (#178). The tone comes
        // from the same table as the mark, so a #147 re-tone reaches this line
        // without a second edit (George R3 P3).
        <Notice tone={errorMark?.tone} icon={errorMark?.icon}>
          {errorText}
        </Notice>
      )}
    </>
  );
}
