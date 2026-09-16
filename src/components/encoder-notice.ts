/**
 * What the Books shelf says about an encoder that has stopped working (#166) —
 * the whole gate, in a DOM-free function.
 *
 * Lifted out of `books-screen.tsx` for the reason `processing-status.ts` was
 * lifted out of the recorder: this repo has no DOM test runner, so a mount
 * predicate left in JSX is pinned by nothing. Three decisions live here rather
 * than in a `&&` — whether the line appears at all, which mark it wears, and
 * which string it says — and each of them is wrong in a way no type-check would
 * catch.
 *
 * On the tone. `alert` is a failure and wears the red mark; `busy` is a wait.
 * Neither is true here. Every recording is safe, nothing is in flight, and the
 * translator did nothing that went wrong — this is a heads-up about a background
 * condition, which is exactly what `info` was added for (#112). Painting it red
 * on the app's home screen would teach people to ignore red, which is the cost
 * `notice-tone.ts` exists to avoid, and it is the same call
 * `processing-status.ts` makes for the #59 interruption.
 */

import { strings } from "./strings";
import type { NoticeTone } from "./notice-tone";
import type { EncoderHealth } from "@/hooks/mp3-codec";

export interface EncoderNotice {
  readonly tone: NoticeTone;
  readonly text: string;
}

/** The shelf's one line about the encoder, or `null` when there is nothing to say. */
export function encoderNotice(health: EncoderHealth): EncoderNotice | null {
  if (health === "ok") return null;
  return { tone: "info", text: strings.encoderFailing };
}
