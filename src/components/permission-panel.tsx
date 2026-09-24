import { Control } from "./control";
import { Icon } from "./icon";
import { strings } from "./strings";

/**
 * The mic-needed / mic-denied full-panel recovery screen (#203).
 *
 * **Why this is a module and not an inline block in `recorder.tsx` (#197).**
 * `recorder.tsx` mounts the audio hook graph, so no `tests/` file renders it —
 * which left this panel's `role="alert"` scoping (#276) reachable by nothing.
 * `RecorderStatus` was lifted out for the same reason; this is that reasoning
 * applied here, so `tests/permission-panel.test.ts` can render this component
 * directly and read the attributes it actually emits.
 *
 * **`role="alert"` is on the title `<p>` alone, not the outer wrapper**
 * (deferred from the round-3 dual review of #260, George R3 P3, tracked as
 * #276). `role="alert"` implies `aria-live="assertive"` + `aria-atomic="true"`;
 * on the wrapper, that region also contained the `autoFocus`ed Retry control
 * and Back. When the async permission refine (`use-recorder.ts`'s
 * `navigator.permissions` query resolving after Retry has already autofocused)
 * updates `message` in place, a wrapper-scoped alert re-announces the whole
 * subtree — the two button labels included — with the focused control sitting
 * INSIDE the live region, the shape ARIA authoring practice warns against for
 * interactive content. Scoping the role to the title alone keeps Retry and
 * Back outside the live region, so the refined message announces cleanly
 * without re-reading the buttons and without the focused control fighting its
 * own live region.
 *
 * `LoadErrorPanel`'s wrapper-level `role="alert"` is not the same case: its
 * title is static, so its alert only fires once, at mount.
 */
export function PermissionPanel({
  message,
  onRetry,
  onBack,
}: {
  /** The actual error when there is one (a denied mic, or a failed decode) — */
  /** honest over the generic mic-needed title. */
  message: string | null;
  onRetry: () => void;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-[18px] px-[22px] text-center">
      <span className="text-live">
        <Icon name="alert" size={52} />
      </span>
      <p role="alert" className="t-title text-ink">
        {message ?? strings.micNeededTitle}
      </p>
      <Control
        icon="retry"
        label={strings.micRetry}
        variant="primary"
        size={30}
        autoFocus
        onClick={onRetry}
      />
      <Control
        icon="back"
        label={strings.micBack}
        variant="quiet"
        onClick={onBack}
      />
    </div>
  );
}
