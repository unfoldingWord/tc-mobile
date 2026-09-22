/**
 * What each `Notice` tone looks and sounds like — one table, so the three tones
 * can be pinned distinct in plain Node (#112).
 *
 * The app is for people who may not read, so the glyph carries the meaning. A
 * failure, a wait, and a heads-up are three different messages and must never
 * share a mark: the share gap warning ("N segments were left out") used to ride
 * on `busy`, wearing the same wait/retry glyph the translator had just watched
 * for "Preparing the chapter to share" — for something already finished.
 */

import type { IconName } from "./icon";

/**
 * `alert` is a failure: red, an alert glyph, announced immediately.
 * `busy` is work in progress the translator has to wait for: muted, the retry
 * glyph, announced politely.
 * `info` is a heads-up that is not a failure and not a wait: full ink, its own
 * glyph, announced politely. Covers both a completeness caveat about
 * something already done (a share gap, an interruption) and a standing
 * condition worth naming on its own — e.g. storage durability (#12) — where
 * nothing has failed yet but the risk is ongoing rather than a one-time
 * event. Not red (nothing failed) and not muted (it is news, not a wait).
 */
export type NoticeTone = "alert" | "busy" | "info";

export interface NoticePresentation {
  /** A failure interrupts; everything else waits its turn. */
  readonly role: "alert" | "status";
  readonly icon: IconName;
  /** Wears the failure colour on the edge. */
  readonly failure: boolean;
  /** Text in the muted ink — a wait, not news. */
  readonly muted: boolean;
  /**
   * The glyph's semantic colour token. In the table, not the JSX, because for a
   * translator who cannot read the colour is the second half of what tells the
   * three marks apart — so it is pinned with the glyph rather than left where no
   * test can see it (George G3).
   */
  readonly glyph: string;
}

export function noticePresentation(tone: NoticeTone): NoticePresentation {
  switch (tone) {
    case "alert":
      return {
        role: "alert",
        icon: "alert",
        failure: true,
        muted: false,
        glyph: "var(--s-live)",
      };
    case "busy":
      return {
        role: "status",
        icon: "retry",
        failure: false,
        muted: true,
        glyph: "var(--s-ink-muted)",
      };
    case "info":
      return {
        role: "status",
        icon: "info",
        failure: false,
        muted: false,
        glyph: "var(--s-warn)",
      };
  }
}

/**
 * The tone worn by every Notice whose answer to "is this genuinely a failure?"
 * is **no** — #147's open question, in one place instead of three.
 *
 * The three members of the class, as the audit found them:
 *
 *   - `previewUnavailable` (`recorder.tsx`) — this device could not decode the
 *     PAUSED, uncommitted take for a preview (#101). The take itself is intact;
 *     Back commits it and it plays from the Segments list.
 *   - `staleChapter` (`segments-screen.tsx`, twice) — another live copy deleted
 *     this book or chapter under the screen (#378). `useChapterSegments` says so
 *     itself: it sets `staleTarget` and clears `error` in the same breath, so
 *     the hook already classifies this as not-a-failure while the screen paints
 *     it in the failure colour.
 *   - `shareOutcomeGlyph("nothing")` — there is no audio yet to share. Nothing
 *     failed to go; nothing was ever recorded.
 *
 * All three are "you cannot do this yet (or any more), and nothing is wrong and
 * nothing is at risk" — a settled fact plus what to do next, which is the `info`
 * contract as #147 states it. All three are `alert` today, so a translator who
 * cannot read gets the red failure triangle for a state where nothing has gone
 * wrong. That is the mis-signal `info` was added to stop (#112, #140).
 *
 * **This constant does not answer the question; it makes the answer one token.**
 * The counter-argument #147 records is real — from where the translator sits
 * they tapped Play and got silence, or tapped Share and nothing was shared — and
 * it is Tim's call, not an engineering one. Two earlier passes (#457, and #147's
 * own filing) declined to decide it, and this one declines too: the value below
 * is the `alert` all three already wore, so this change re-tones nothing.
 *
 * What it buys is that the three cannot drift apart while the question waits,
 * which is what #147 asks for — "rather than fixing one and leaving the rest to
 * drift". If the answer is `info`, it is this line. If the answer differs PER
 * SITE (#147's comment thread notes the share case is the weakest `alert` of the
 * three, since it is only reached from a menu the translator opened themselves),
 * then the right move is to split this constant into the classes that were
 * answered differently — not to hardcode a tone back at one call site, which is
 * exactly the drift it exists to prevent.
 */
export const NOTHING_FAILED_TONE: NoticeTone = "alert";
