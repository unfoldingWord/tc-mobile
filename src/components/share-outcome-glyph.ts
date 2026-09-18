import type { IconName } from "./icon";
import type { NoticeTone } from "./notice-tone";
import type { ShareError } from "@/hooks/share-flow";

/**
 * Which mark each share outcome wears (#178), as one pure table.
 *
 * Share is the only way audio leaves the phone. "Your chapter went out with one
 * segment missing", "there is nothing to share yet" and "the share failed" are
 * three outcomes with three different remedies — and when #178 was filed all
 * three carried their whole meaning in text, with one `Notice` shape between
 * them. A facilitator who reads two of them as the same thing collects an
 * incomplete chapter believing it is whole, which is the exact contract the
 * `missing` count exists to enforce.
 *
 * #140 has since given `partial` the `info` tone, so the residual collision was
 * `nothing` against `failed`: both the red alert triangle, for "record
 * something first" and "try again". This gives each outcome its own glyph.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: re-tone anything. #178's fix shape says
 * "reuse the `info`/`alert` tone split from #112 rather than adding a fourth
 * tone", and whether `nothing` is a failure at all is #147's question — which
 * carries `needs-decision`, is Tim's call, and whose table currently reads the
 * share error as genuinely a failure. Re-toning it here would settle that issue
 * by the back door. Three marks, existing tones; the tone question stays where
 * it is owned. `tests/share-outcome-glyph.test.ts` pins that boundary so a
 * later tidy-up cannot cross it by accident.
 *
 * A table, not a ternary at the call site, for the reason `share-error-copy.ts`
 * gives in its own header: a nested ternary ending in `: null` means widening
 * the union compiles cleanly and the screen silently shows nothing. The `never`
 * default makes the compiler name every outcome.
 */

/**
 * What became of a share.
 *
 * Not `ShareError`: `partial` is not an error — the audio went out, some of it
 * was not there to send — and it arrives at the screen as a `missing` count
 * rather than an error code. This union is the presentation grain, which is why
 * it is named for outcomes and lives beside the icons rather than in
 * `hooks/share-flow.ts`.
 */
export type ShareOutcome = "partial" | "nothing" | "failed";

/**
 * Every outcome, for the exhaustiveness tests.
 *
 * Derived, not hand-written. A literal array typed `ShareOutcome[]` checks its
 * ENTRIES and says nothing about completeness — widen the union, handle the
 * new member in the switch below, forget the list, and it still compiled and
 * every test still passed (Frank R1 P2 on #457). A `Record<ShareOutcome, …>`
 * with a key missing does not compile, so the list is complete by
 * construction: the same reasoning as the `never` default in
 * `shareOutcomeGlyph`, at the type level instead of the switch.
 */
const EVERY_OUTCOME: Record<ShareOutcome, true> = {
  partial: true,
  nothing: true,
  failed: true,
};
export const SHARE_OUTCOMES = Object.keys(
  EVERY_OUTCOME
) as readonly ShareOutcome[];

export interface ShareOutcomeGlyph {
  /** The mark. Distinct per outcome — that is this module's whole job. */
  readonly icon: IconName;
  /**
   * The tone, unchanged from what each outcome already wore. `nothing` and
   * `failed` share it, which is precisely why the icons above must differ: with
   * one colour and one role between them, the mark is the only thing a
   * non-reader has.
   */
  readonly tone: NoticeTone;
}

export function shareOutcomeGlyph(outcome: ShareOutcome): ShareOutcomeGlyph {
  switch (outcome) {
    // Some of it went. Built on the share family's tray with its rim broken,
    // and NOT `info`'s generic ring-and-i — that glyph also carries storage
    // durability (#214/#406) and the interruption heads-up, so leaving share on
    // it would mean sharing a mark with an unrelated standing condition.
    case "partial":
      return { icon: "share-partial", tone: "info" };
    // None of it could go, and nothing failed to do it — there is no audio yet.
    // The struck-through tray, so it is not the failure triangle.
    case "nothing":
      return { icon: "share-empty", tone: "alert" };
    // It genuinely failed. Keeps the alert triangle, which is what that mark is
    // for and what the translator has already learned it means.
    case "failed":
      return { icon: "alert", tone: "alert" };
    default: {
      const unhandled: never = outcome;
      return unhandled;
    }
  }
}

/**
 * The mark for a `ShareError` Notice — the bridge from the code the hook
 * produces to the outcome vocabulary above.
 *
 * Paired with `shareErrorText`, which maps the same codes to words: one table
 * for what the line says, one for what its mark is, both exhaustive over
 * `ShareError` so widening that union cannot leave either silent.
 *
 * `encoder` (#166) keeps the `alert` tone's own triangle and is NOT given a
 * glyph here. It is not one of #178's three outcomes, its copy already names a
 * different subsystem, and inventing a fourth mark for it would widen this
 * lane into a case nobody has asked about. Named rather than defaulted, so the
 * choice is visible instead of looking like an oversight.
 */
export function shareErrorGlyph(
  error: ShareError | null
): IconName | undefined {
  if (error === null) return undefined;
  switch (error) {
    case "nothing":
      return shareOutcomeGlyph("nothing").icon;
    case "failed":
      return shareOutcomeGlyph("failed").icon;
    case "encoder":
      return undefined;
    default: {
      const unhandled: never = error;
      return unhandled;
    }
  }
}
