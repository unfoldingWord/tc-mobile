/**
 * Why a stopped capture yielded no usable take — as a CODE, never as a
 * sentence.
 *
 * The recorder's failures used to travel as English prose: `use-recorder.ts`
 * built the sentence at each exit, `use-audio-session.ts`'s backstop typed one
 * of the same sentences out a second time, and `close-plan.ts` carried them
 * through `lib/` as a bare `string`. That is the shape #169 is closing — a
 * second UI language cannot be a data change while the words are minted three
 * layers below the table — and it had already cost something smaller: the
 * "could not finish" sentence existed in two files with nothing tying them
 * together, so a wording edit to one left the other saying the old thing.
 *
 * Splitting the code from the copy also closes a set `close-plan.ts` recorded
 * as open: its `CaptureOutcome.error` docblock warned that "`stopDecodeMessage`'s
 * union is therefore NOT the closed set of stop errors — a `lib/` change or
 * test that treats it as one is wrong", because two of the three producers
 * bypassed the classifier and wrote their sentence inline. The three are now
 * the three members below, and a fourth cannot reach a screen wordless:
 * `captureFailureText`'s `never` default rejects it, and so does the
 * `Record<CaptureFailure, string>` in its test.
 *
 * Only those two. Readers that merely CARRY the value — `classifyCapture`,
 * `planClose` — compile unchanged against a fourth member, which is the point
 * rather than a gap: they were never the ones choosing a sentence. An earlier
 * draft of this docblock said the compiler "names every reader", which is
 * false and was caught on review; what it names is the two that must choose.
 *
 * Pure and DOM-free, like every other classifier here: the words live in
 * `components/strings.ts` and are chosen by `components/capture-failure-copy.ts`.
 */

export type CaptureFailure =
  /**
   * The capture decoded, and decoded to nothing — proven silence. A retry of
   * the same bytes cannot help, so nothing is kept.
   */
  | "silence"
  /**
   * The capture produced bytes this device could not decode (#165). The bytes
   * ARE the take's only copy and are held for the recovery panel, so this is
   * the one failure with audio still behind it.
   */
  | "undecodable"
  /**
   * The engine failed to hand the capture over: a flush that threw (#485) or a
   * `stopRecording` that rejected (#480), each sealing to nothing. Distinct
   * from `"silence"` on purpose — the translator may well have spoken, and
   * telling them "no sound was recorded" would blame them for the engine.
   */
  | "unfinished";
