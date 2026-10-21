import { Control } from "./control";
import { Icon, type IconName } from "./icon";
import type { MicSettingsPlatform } from "@/hooks/mic-settings-platform";
import { strings } from "@/lib/strings";

type Step = { icon: IconName; text: string };

// Built per call, never at module scope: a module-level `Step` would hold the
// string of whichever locale was running at import, and keep it.
const comeBack = (): Step => ({
  icon: "restart",
  text: strings.micStepComeBack,
});
const micOn = (): Step => ({ icon: "mic", text: strings.micStepMicOn });
const openSettings = (): Step => ({
  icon: "phone",
  text: strings.micStepOpenSettings,
});

/**
 * The walk-through for each build (#1569): every step leads with an icon, the
 * words are beside it. A function and not a module constant so the table is
 * read when called, after `strings` has settled on the locale.
 */
function micSettingsSteps(platform: MicSettingsPlatform): Step[] {
  switch (platform) {
    case "android-app":
      return [
        openSettings(),
        { icon: "tap-hand", text: strings.micStepAndroidApp },
        micOn(),
        comeBack(),
      ];
    case "ios-app":
      return [
        openSettings(),
        { icon: "tap-hand", text: strings.micStepIosApp },
        { icon: "mic", text: strings.micStepIosAppOn },
        comeBack(),
      ];
  }
}

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
  settingsPlatform = null,
}: {
  /** The actual error when there is one (a denied mic, or a failed decode) — */
  /** honest over the generic mic-needed title. */
  message: string | null;
  onRetry: () => void;
  onBack: () => void;
  /**
   * Set once Retry has been refused again (#1569): the build to show the
   * phone-settings steps for. `null` is the first refusal, or a build with no
   * known steps, and renders the panel as it always was.
   */
  settingsPlatform?: MicSettingsPlatform | null;
}) {
  // State 16 (#948). The workbench's speaker button and "Ask your helper"
  // pill are not here: neither has a behaviour in this app to wire to (no
  // prompt-audio path, no helper action), and a control that does nothing is
  // a stub.
  return (
    <div className="o4-err o4-err-split flex flex-1 flex-col items-center px-[22px] text-center">
      <div className="o4-err-body">
        {settingsPlatform !== null ? (
          // The steps are showing (#1569): a compact header, the circle shrunk
          // to a small icon beside the title, and no refusal sentence. The
          // steps say what to do, and the title alone keeps the alert's
          // meaning, so nothing is held back for screen readers.
          <div className="o4-err-head">
            <span
              className="o4-err-circle o4-err-circle--denied o4-err-circle--compact"
              aria-hidden="true"
            >
              <Icon name="mic" size={26} />
            </span>
            <p role="alert" className="o4-err-title text-ink">
              {strings.micOffTitle}
            </p>
          </div>
        ) : (
          <>
            <span
              className="o4-err-circle o4-err-circle--denied"
              aria-hidden="true"
            >
              <Icon name="mic" size={58} />
            </span>
            {/* D15 (#948): the title is always "Microphone is off", and the
          recorder's refusal sentence, when there is one, is a second line
          under it. The sentence sits INSIDE the alert `<p>` because it is
          the part the async permission refine updates in place, so it must
          stay in the live region; the buttons stay outside it (#276). */}
            <p role="alert" className="o4-err-title text-ink">
              {strings.micOffTitle}
              {message !== null && (
                <span className="o4-err-sub">{message}</span>
              )}
            </p>
          </>
        )}
        {settingsPlatform !== null && (
          <ol className="o4-err-steps" aria-label={strings.micStepsLabel}>
            {micSettingsSteps(settingsPlatform).map((step) => (
              <li key={step.text} className="o4-err-step">
                <span className="o4-err-step-icon" aria-hidden="true">
                  <Icon name={step.icon} size={30} />
                </span>
                <span className="o4-err-step-text">{step.text}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="o4-err-footer">
        <Control
          icon="restart"
          label={strings.micRetry}
          variant="primary"
          size={34}
          className="o4-err-wide"
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
    </div>
  );
}
