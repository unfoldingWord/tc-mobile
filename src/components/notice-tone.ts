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
 * `info` is a heads-up about something already done — a completeness warning,
 * a caveat: full ink, its own glyph, announced politely. Not red (nothing
 * failed) and not muted (it is news, not a wait).
 */
export type NoticeTone = "alert" | "busy" | "info";

/** Every tone, for a test to sweep. */
export const NOTICE_TONES: readonly NoticeTone[] = ["alert", "busy", "info"];

export interface NoticePresentation {
  /** A failure interrupts; everything else waits its turn. */
  readonly role: "alert" | "status";
  readonly icon: IconName;
  /** Wears the failure colour (`--s-live`) on the edge and the glyph. */
  readonly failure: boolean;
  /** Text in the muted ink — a wait, not news. */
  readonly muted: boolean;
}

export function noticePresentation(tone: NoticeTone): NoticePresentation {
  switch (tone) {
    case "alert":
      return { role: "alert", icon: "alert", failure: true, muted: false };
    case "busy":
      return { role: "status", icon: "retry", failure: false, muted: true };
    case "info":
      return { role: "status", icon: "info", failure: false, muted: false };
  }
}
