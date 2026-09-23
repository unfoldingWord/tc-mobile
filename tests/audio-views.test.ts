import { describe, expect, it } from "vitest";

import type {
  RecorderAudio,
  SegmentsAudio,
  UseAudioSession,
} from "@/hooks/use-audio-session";

/**
 * The two narrow audio views (#160, L-18), asserted rather than counted.
 *
 * `SegmentsAudio` and `RecorderAudio` are `Pick`s over `UseAudioSession`, and
 * the property that matters is not how many members each has — it is that the
 * MICROPHONE is reachable from exactly one of them, and that no member of the
 * session falls through both views unnoticed.
 *
 * This exists because the lists drifted for real. #614 retired the paused
 * preview and took four members off the interface; #601 added one. Both views
 * were stale afterwards, the docblock's three counts were all wrong, and the
 * only thing that objected was `tsc` — on the CALL SITES, not on the views.
 *
 * These are TYPE-level assertions, so `npm run typecheck` is what runs them
 * (`tsc -b` compiles `tests/`), in `verify` and in CI. The runtime cases below
 * exist so a reader of the test output can see the guarantee is claimed, and
 * so an assertion that stops compiling cannot vanish silently.
 */

/** `true` only if A and B are the same type. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** Members of the session that neither screen's view admits. */
type Unclassified = Exclude<
  keyof UseAudioSession,
  keyof SegmentsAudio | keyof RecorderAudio
>;

/** Mic verbs must NOT be reachable from the list screen's view. */
type MicOnList = Extract<
  keyof SegmentsAudio,
  "startRecording" | "stopRecording"
>;

// Each `true` below is the assertion; a drift makes the annotation fail `tsc`.
const micIsOffTheList: Exact<MicOnList, never> = true;
const onlyPrimeIsUnclassified: Exact<Unclassified, "primeAudioContext"> = true;
const listCanPlay: Exact<
  Extract<keyof SegmentsAudio, "playTake">,
  "playTake"
> = true;
const recorderCanRecord: Exact<
  Extract<keyof RecorderAudio, "startRecording">,
  "startRecording"
> = true;

describe("the two audio views partition the session", () => {
  it("keeps the microphone off the list screen's view", () => {
    // `startRecording` on SegmentsAudio makes `MicOnList` that key rather than
    // `never`, and the annotation above stops compiling. A list that can start
    // the mic has no sheet up to stop it.
    expect(micIsOffTheList).toBe(true);
  });

  it("leaves exactly one session member on neither view", () => {
    // `primeAudioContext`, which App calls itself. Any OTHER member that ends
    // up on neither view is a member a screen quietly lost access to, or one
    // added to the session and wired to nothing — which is how both views went
    // stale under #614 and #601 with nothing here to object.
    expect(onlyPrimeIsUnclassified).toBe(true);
  });

  it("still grants each screen the verb it exists for", () => {
    // The other direction, so a view narrowed to `never` could not pass the
    // two assertions above by admitting nothing at all.
    expect(listCanPlay).toBe(true);
    expect(recorderCanRecord).toBe(true);
  });
});
