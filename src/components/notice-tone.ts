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
 * is **no** — #147's open question, in one place instead of at each call site.
 *
 * The members:
 *
 *   - `staleChapter` (`segments-screen.tsx`, twice) — another live copy deleted
 *     this book or chapter under the screen (#378). `useChapterSegments`
 *     classifies it that way itself: it sets `staleTarget` and clears `error`
 *     in the same breath.
 *   - `shareOutcomeGlyph("nothing")` — there is no audio yet to share. Nothing
 *     failed to go; nothing was ever recorded.
 *
 * Both are "you cannot do this (or any more), and nothing is wrong and nothing
 * is at risk" — a settled fact plus what to do next, which is the `info`
 * contract as #147 states it.
 *
 * WHAT THEY SHARE IS THE TONE, NOT THE MARK. `alert` carries the failure
 * colour and `role="alert"` for both, but only `staleChapter` also shows the
 * failure triangle: it passes no `icon`, so it takes the tone's own glyph,
 * while `shareOutcomeGlyph("nothing")` substitutes `share-empty` (#178). So the
 * mis-signal `info` was added to stop (#112, #140) reaches a translator who
 * cannot read through the colour and the interrupting role, and through the
 * glyph at one of the two sites.
 *
 * **This constant does not answer the question; it makes the answer one token.**
 * Whether these should be `info` is Tim's call, not an engineering one, and it
 * is unanswered: the value here is the `alert` both already wore, so this
 * re-tones nothing. What it buys is that the members cannot drift apart while
 * the question waits, which is what #147 asks for — "rather than fixing one and
 * leaving the rest to drift".
 *
 * If the answer is `info`, it is this line. If it differs PER SITE, split this
 * constant into the classes that were answered differently — never hardcode a
 * tone back at one call site, which is exactly the drift it exists to prevent.
 *
 * `tests/notice-nothing-failed.test.ts` pins the membership from both
 * directions, so the list above cannot silently gain or lose a site. The audit
 * behind the class, and what became of the third member #147 was filed for, are
 * on #147 and in PR #684 — deliberately not restated here, where they would go
 * stale as the tree moves.
 */
export const NOTHING_FAILED_TONE: NoticeTone = "alert";
