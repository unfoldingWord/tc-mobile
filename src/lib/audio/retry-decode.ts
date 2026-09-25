/**
 * The outcome of re-decoding a held take's container bytes (#165) — the
 * decision `use-recorder.ts`'s `retryDecode` used to make inline, where only a
 * source-text regex could reach it (#745).
 *
 * The decode itself is injected, so this runs in plain Node: the hook passes
 * `() => decodeToCanonical(blob)`, and this module never sees the `Blob` or the
 * `AudioContext` behind it.
 *
 * It is NOT `classifyStopDecode` a second time, and the difference is the
 * reason it is its own function. On `stop()`, a decode to zero samples is
 * proven silence and the bytes are dropped. Here it is not proven anything: the
 * bytes are held only because the FIRST decode threw, so a later zero-sample
 * decode is ambiguous (George R3 G-1). This function therefore says nothing
 * about keeping the bytes — it has no `keepBlob` to get wrong. The caller keeps
 * them on every failure; retention is the caller's, never this code's.
 *
 * The costly wrong member is a throw reported as `"silence"`: a translator
 * whose container failed to decode is told nothing was heard, while the only
 * copy is still on the device (#700 round 6).
 *
 * Never throws. A rejected decode is a result, not an exception.
 */

import type { CaptureFailure } from "./capture-failure";

export interface RetryDecodeOutcome {
  readonly samples: Int16Array | null;
  /** Why there are no samples; null exactly when `samples` is usable. */
  readonly error: Extract<CaptureFailure, "silence" | "undecodable"> | null;
}

export async function decodeRetry(
  decode: () => Promise<Int16Array>
): Promise<RetryDecodeOutcome> {
  let samples: Int16Array;
  try {
    samples = await decode();
  } catch {
    return { samples: null, error: "undecodable" };
  }
  // Zero samples is no usable take, but not proof the bytes are empty — see
  // the docblock. The caller keeps them and shows this code.
  if (samples.length === 0) return { samples: null, error: "silence" };
  return { samples, error: null };
}
