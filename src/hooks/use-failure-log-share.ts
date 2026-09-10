import { useCallback } from "react";

import { formatFailureLog } from "@/lib/failure-text";
import { readFailures } from "@/lib/storage/failures";
import {
  type ShareError,
  type ShareOutcome,
  type ShareStatus,
  useShareFlow,
} from "./share-flow";

export interface UseFailureLogShare {
  readonly status: ShareStatus;
  readonly error: ShareError | null;
  /**
   * Tap 1: read the log, render it to a text File and arm the send gesture.
   * Never rejects — a reason surfaces through `error`.
   */
  prepare: () => Promise<void>;
  /** Tap 2: hand the armed File to the OS share sheet. See {@link useShareFlow}. */
  send: () => Promise<ShareOutcome>;
  /** Drop any prepared file and return to idle (panel close, unmount). */
  reset: () => void;
}

/**
 * Carry the failure log off the phone (#205).
 *
 * The log is durable, which makes it retrievable by a maintainer holding the
 * phone. That is not the situation the October training is: the phone is in a
 * translator's hand in Nairobi and the maintainer is not in the room. So the
 * log needs the same exit every recording has — the OS share sheet, which on
 * both platforms reaches mail, a messaging app, or a file the facilitator can
 * collect later, with no network of our own and no telemetry.
 *
 * The two-gesture flow is reused rather than a direct `navigator.share`, even
 * though rendering text is fast enough that iOS's activation window would
 * probably survive it. "Probably" is the whole problem: the read is an
 * IndexedDB open, which on a cold start is arbitrarily slow, and a share that
 * silently does nothing on one platform is the defect class B7 already paid
 * for. Reusing the flow also inherits its `NotAllowedError` handling and its
 * run-generation token for free.
 *
 * Not on the encoder lane — there is no encode here, and putting a text render
 * behind a Finished transcode would make the log unreachable exactly when the
 * encoder is the thing that is stuck (#166).
 */
export function useFailureLogShare(): UseFailureLogShare {
  const { status, error, prepare: run, send, reset } = useShareFlow();

  const prepare = useCallback(
    (): Promise<void> =>
      run(async (isCurrent) => {
        const entries = await readFailures();
        // The panel that offers this only renders its Share control when the
        // log is non-empty, so an empty read here means the log was cleared
        // between the render and the tap. `"nothing"` is the honest code, and
        // the panel already has copy for it.
        if (entries.length === 0) return isCurrent() ? "nothing" : null;
        if (!isCurrent()) return null;
        const text = formatFailureLog(entries, __APP_VERSION__);
        const file = new File([text], failureLogFilename(), {
          type: "text/plain",
        });
        // `missing` is a share-with-gaps count and has no meaning for a log
        // that is whole by construction.
        return { file, missing: 0 };
      }),
    [run]
  );

  return { status, error, prepare, send, reset };
}

/**
 * The shared file's name.
 *
 * Dated and version-stamped, because a facilitator collecting these from a
 * roomful of phones ends up with a folder of them and "log.txt" nine times over
 * is not a folder anyone can use. Colons are stripped from the ISO timestamp —
 * they are illegal in a filename on Windows, where these will be read.
 */
function failureLogFilename(): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `tc-mobile-log-${__APP_VERSION__}-${stamp}.txt`;
}
