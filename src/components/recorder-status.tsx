import { Notice } from "./notice";
import { recorderStatusKind } from "./processing-status";
import { strings } from "@/lib/i18n/strings";
import type { RecorderState } from "@/hooks/use-recorder";

/**
 * The recorder's commit-window status line — or nothing, when there is nothing
 * to say.
 *
 * #39: the commit window used to draw no status — no dot, no timer, no copy —
 * so the stop → decode → save wait (and a #59 interruption's frozen take) read
 * as a dead app. The status was the missing half. The gate spans `isClosing`,
 * not just `processing`, because state flips to idle mid-save (Frank/George
 * R1); it lives in the pure `recorderStatusKind` so the predicate is tested,
 * not just the wording. As a `Notice` it carries the glyph a non-reader needs
 * and its own `role`, so there is no hand-rolled `aria-busy` to leave stuck.
 *
 * **Why this is a module and not an inline block in `recorder.tsx` (#197).**
 * `recorder.tsx` mounts the audio hook graph, so no `tests/` file renders it —
 * which left the tone each branch passes reachable by nothing.
 * `recorderStatusKind` was already lifted out for that reason; this is the same
 * reasoning taken the one step further that makes the *rendering* reachable
 * too, so `tests/recorder-status.test.ts` can render this component directly
 * and read the `data-tone` that comes out.
 */
export function RecorderStatus({
  state,
  isClosing,
}: {
  state: RecorderState;
  isClosing: boolean;
}) {
  const status = recorderStatusKind(state, isClosing);
  if (!status) return null;
  return (
    <div className="px-[12px] pt-[8px]">
      <Notice tone="busy">{strings.recorderSaving}</Notice>
    </div>
  );
}
