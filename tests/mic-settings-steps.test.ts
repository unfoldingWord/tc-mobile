import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PermissionPanel } from "@/components/permission-panel";
import {
  micSettingsPlatformFrom,
  type MicSettingsPlatform,
} from "@/hooks/mic-settings-platform";
import {
  MIC_RETRY_TAPPED,
  nextMicRetryPhase,
  showMicSettingsSteps,
  type MicRetryPhase,
} from "@/lib/audio/mic-retry";
import { installLocale } from "@/lib/i18n/locales";
import { SHIPPED_LOCALE } from "@/lib/locale";
import { strings, stringsEn } from "@/lib/strings";

import { one, render } from "./render";

/**
 * #1569: after Retry is refused again, the panel shows numbered steps for the
 * phone's settings, each leading with an icon. Render-harness claims only: the
 * markup the panel emits for a prop. Whether `recorder.tsx` passes the prop on
 * the second refusal (and not the first) is not rendered by any test here, and
 * nothing here ran on a phone.
 */
// The registry's French module is replaced by a table the locale test fills.
const fr = vi.hoisted(() => ({}) as Record<string, unknown>);
vi.mock("@/lib/i18n/fr", () => ({ table: fr }));

afterEach(() => {
  for (const key of Object.keys(fr)) delete fr[key];
  installLocale(SHIPPED_LOCALE);
});

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
    strings.micStepIosAppOn,
    strings.micStepComeBack,
  ],
  "android-chrome": [
    strings.micStepAndroidChrome,
    strings.micStepMicOn,
    strings.micStepComeBack,
  ],
  "ios-safari": [
    strings.micStepOpenSettings,
    strings.micStepIosSafari,
    strings.micStepIosSafariMic,
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

  it("every step follows the locale installed after import", () => {
    for (const [key, value] of Object.entries(stringsEn)) {
      if (key.startsWith("micStep") && typeof value === "string") {
        fr[key] = `FR ${value}`;
      }
    }
    installLocale({ tag: "fr", dir: "ltr" });
    for (const platform of Object.keys(EXPECTED)) {
      const list = one(
        panel(platform as MicSettingsPlatform),
        "ol.o4-err-steps"
      );
      const items = [...list.querySelectorAll("li")];
      expect(items.length).toBeGreaterThan(0);
      for (const li of items) expect(li.textContent).toMatch(/^FR /);
    }
  });

  it("iOS wording names no version-specific control", () => {
    const ios = [
      strings.micStepIosApp,
      strings.micStepIosAppOn,
      strings.micStepIosSafari,
      strings.micStepIosSafariMic,
    ].join(" ");
    expect(ios).not.toMatch(/aA|Page Menu|Website Settings|address bar/);
    expect(strings.micStepIosApp).toBe(
      "Tap Privacy & Security, then Microphone"
    );
  });

  it("a first refusal (no platform) shows no steps", () => {
    expect(panel(null).querySelector(".o4-err-steps")).toBeNull();
    expect(panel().querySelector(".o4-err-steps")).toBeNull();
  });

  it("steps mode: compact header, and the long sentence is absent", () => {
    const sentence = strings.micOsBlocked;
    const container = render(
      createElement(PermissionPanel, {
        message: sentence,
        onRetry: () => {},
        onBack: () => {},
        settingsPlatform: "ios-safari",
      })
    );
    const head = one(container, ".o4-err-head");
    expect(head.querySelector(".o4-err-circle--compact")).not.toBeNull();
    expect(one(head, '[role="alert"]').textContent).toBe(strings.micOffTitle);
    expect(container.textContent).not.toContain(sentence);
    expect(container.querySelector(".o4-err-sub")).toBeNull();
  });

  it("first refusal keeps the old layout: big circle, sentence under the title", () => {
    const sentence = strings.micOsBlocked;
    const container = render(
      createElement(PermissionPanel, {
        message: sentence,
        onRetry: () => {},
        onBack: () => {},
        settingsPlatform: null,
      })
    );
    expect(container.querySelector(".o4-err-head")).toBeNull();
    expect(container.querySelector(".o4-err-circle--compact")).toBeNull();
    expect(one(container, ".o4-err-sub").textContent).toBe(sentence);
    expect(one(container, '[role="alert"]').textContent).toContain(sentence);
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
    expect(micSettingsPlatformFrom("android", "", "", 0, false)).toBe(
      "android-app"
    );
    expect(micSettingsPlatformFrom("ios", "", "", 0, false)).toBe("ios-app");
  });

  it("reads Chrome on Android and Safari on iOS from the user agent", () => {
    expect(
      micSettingsPlatformFrom("web", CHROME_ANDROID, "Linux armv8l", 5, false)
    ).toBe("android-chrome");
    expect(micSettingsPlatformFrom("web", SAFARI_IOS, "iPhone", 5, false)).toBe(
      "ios-safari"
    );
    expect(micSettingsPlatformFrom("web", DESKTOP, "MacIntel", 5, false)).toBe(
      "ios-safari"
    );
  });

  it("gives no steps for other browsers or a desktop", () => {
    expect(
      micSettingsPlatformFrom("web", SAMSUNG, "Linux", 5, false)
    ).toBeNull();
    expect(
      micSettingsPlatformFrom("web", CHROME_IOS, "iPhone", 5, false)
    ).toBeNull();
    expect(
      micSettingsPlatformFrom("web", DESKTOP, "MacIntel", 0, false)
    ).toBeNull();
    expect(micSettingsPlatformFrom("web", "", "", 0, false)).toBeNull();
  });

  it("gives an installed PWA no steps, on Android and iOS alike", () => {
    expect(
      micSettingsPlatformFrom("web", CHROME_ANDROID, "Linux armv8l", 5, true)
    ).toBeNull();
    expect(
      micSettingsPlatformFrom("web", SAFARI_IOS, "iPhone", 5, true)
    ).toBeNull();
    expect(
      micSettingsPlatformFrom("web", DESKTOP, "MacIntel", 5, true)
    ).toBeNull();
  });

  it("keeps the native shells' steps whatever the display mode says", () => {
    expect(micSettingsPlatformFrom("android", "", "", 0, true)).toBe(
      "android-app"
    );
    expect(micSettingsPlatformFrom("ios", "", "", 0, true)).toBe("ios-app");
  });

  it("gives a bare iOS WebView no steps, and keeps desktop-mode iPad", () => {
    const WEBVIEW =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
    expect(
      micSettingsPlatformFrom("web", WEBVIEW, "iPhone", 5, false)
    ).toBeNull();
    expect(micSettingsPlatformFrom("web", DESKTOP, "MacIntel", 5, false)).toBe(
      "ios-safari"
    );
  });
});

describe("mic retry latch (#1569)", () => {
  const run = (
    steps: Array<[Parameters<typeof nextMicRetryPhase>[1], boolean]>
  ): MicRetryPhase => {
    let phase: MicRetryPhase = MIC_RETRY_TAPPED;
    for (const [state, hasError] of steps) {
      phase = nextMicRetryPhase(phase, state, hasError);
    }
    return phase;
  };

  it("the click that starts the second attempt is not a second refusal", () => {
    // The refused panel still painted: idle, error still set, nothing requested.
    expect(run([["idle", true]])).toBe("tapped");
    expect(showMicSettingsSteps("tapped", strings.micSiteBlocked)).toBe(false);
  });

  it("settles to refused only after requesting comes back to idle with an error", () => {
    expect(
      run([
        ["requesting", false],
        ["idle", true],
      ])
    ).toBe("refused");
    expect(run([["requesting", false]])).toBe("inflight");
  });

  it("a take starting ends the sequence", () => {
    expect(
      run([
        ["requesting", false],
        ["recording", false],
        ["idle", true],
      ])
    ).toBe("none");
  });

  it("shows steps only for a permission refusal", () => {
    for (const ok of [
      strings.micSiteBlocked,
      strings.micOsBlocked,
      strings.micPrompt,
    ]) {
      expect(showMicSettingsSteps("refused", ok)).toBe(true);
    }
    for (const no of [
      strings.micNoDevice,
      strings.micStartFailed,
      strings.recordingUnsupported,
      null,
    ]) {
      expect(showMicSettingsSteps("refused", no)).toBe(false);
    }
    expect(showMicSettingsSteps("none", strings.micOsBlocked)).toBe(false);
  });
});
