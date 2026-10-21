import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { PermissionPanel } from "@/components/permission-panel";
import {
  micSettingsPlatformFrom,
  type MicSettingsPlatform,
} from "@/hooks/mic-settings-platform";
import { strings } from "@/lib/strings";

import { one, render } from "./render";

/**
 * #1569: after Retry is refused again, the panel shows numbered steps for the
 * phone's settings, each leading with an icon. Render-harness claims only: the
 * markup the panel emits for a prop. Whether `recorder.tsx` passes the prop on
 * the second refusal (and not the first) is not rendered by any test here, and
 * nothing here ran on a phone.
 */
const panel = (settingsPlatform?: MicSettingsPlatform | null) =>
  render(
    createElement(PermissionPanel, {
      message: null,
      onRetry: () => {},
      onBack: () => {},
      settingsPlatform,
    })
  );

const EXPECTED: Record<MicSettingsPlatform, string[]> = {
  "android-app": [
    strings.micStepOpenSettings,
    strings.micStepAndroidApp,
    strings.micStepMicOn,
    strings.micStepComeBack,
  ],
  "ios-app": [
    strings.micStepOpenSettings,
    strings.micStepIosApp,
    strings.micStepMicOn,
    strings.micStepComeBack,
  ],
  "android-chrome": [
    strings.micStepAndroidChrome,
    strings.micStepMicOn,
    strings.micStepComeBack,
  ],
  "ios-safari": [
    strings.micStepIosSafari,
    strings.micStepMicOn,
    strings.micStepComeBack,
  ],
};

describe("PermissionPanel settings steps (#1569)", () => {
  for (const [platform, texts] of Object.entries(EXPECTED)) {
    it(`${platform}: numbered steps, each led by an icon`, () => {
      const list = one(
        panel(platform as MicSettingsPlatform),
        "ol.o4-err-steps"
      );
      const items = [...list.querySelectorAll("li")];
      expect(items.map((li) => li.textContent)).toEqual(texts);
      for (const li of items) {
        const icon = one(li, ".o4-err-step-icon");
        expect(icon.getAttribute("aria-hidden")).toBe("true");
        expect(icon.querySelector("svg")).not.toBeNull();
        // The icon comes before the words.
        expect(li.firstElementChild).toBe(icon);
      }
    });
  }

  it("a first refusal (no platform) shows no steps", () => {
    expect(panel(null).querySelector(".o4-err-steps")).toBeNull();
    expect(panel().querySelector(".o4-err-steps")).toBeNull();
  });

  it("keeps the steps outside the alert and Retry and Back present", () => {
    const container = panel("android-app");
    const alert = one(container, '[role="alert"]');
    expect(alert.querySelector(".o4-err-steps")).toBeNull();
    expect(container.querySelectorAll("button")).toHaveLength(2);
  });
});

describe("micSettingsPlatformFrom (#1569)", () => {
  const CHROME_ANDROID =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
  const SAMSUNG = CHROME_ANDROID + " SamsungBrowser/25.0";
  const SAFARI_IOS =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  const CHROME_IOS = SAFARI_IOS + " CriOS/130.0.0.0";
  const DESKTOP =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15";

  it("names the native shells by Capacitor's id", () => {
    expect(micSettingsPlatformFrom("android", "", "", 0)).toBe("android-app");
    expect(micSettingsPlatformFrom("ios", "", "", 0)).toBe("ios-app");
  });

  it("reads Chrome on Android and Safari on iOS from the user agent", () => {
    expect(
      micSettingsPlatformFrom("web", CHROME_ANDROID, "Linux armv8l", 5)
    ).toBe("android-chrome");
    expect(micSettingsPlatformFrom("web", SAFARI_IOS, "iPhone", 5)).toBe(
      "ios-safari"
    );
    expect(micSettingsPlatformFrom("web", DESKTOP, "MacIntel", 5)).toBe(
      "ios-safari"
    );
  });

  it("gives no steps for other browsers or a desktop", () => {
    expect(micSettingsPlatformFrom("web", SAMSUNG, "Linux", 5)).toBeNull();
    expect(micSettingsPlatformFrom("web", CHROME_IOS, "iPhone", 5)).toBeNull();
    expect(micSettingsPlatformFrom("web", DESKTOP, "MacIntel", 0)).toBeNull();
    expect(micSettingsPlatformFrom("web", "", "", 0)).toBeNull();
  });
});
