import { Capacitor, SystemBars, SystemBarsStyle } from "@capacitor/core";

import { reportFailure } from "./report-failure";
import type { Theme } from "@/lib/theme";

/**
 * The phone's own status bar and navigation bar, kept in step with the app's
 * theme inside the native shell (#1973).
 *
 * WHY THIS EXISTS. The native shell never set the bars' style, so Capacitor's
 * core `SystemBars` plugin left them on its `DEFAULT`, which follows the
 * PHONE's dark-mode setting, not the app's. The app's theme is its own
 * toggle (`lib/theme.ts` says why it does not follow the system), so a phone in
 * dark mode showing the app's light theme drew light icons over a light
 * screen. That is what #1973 reports on Android, in the light theme.
 *
 * THE MAPPING. Capacitor names a style by the BACKGROUND it suits:
 * `SystemBarsStyle.Light` is "dark system bar content on a light background"
 * and `Dark` is light content on a dark one (`@capacitor/core`'s typings). On
 * Android, `Light` sets `setAppearanceLightStatusBars(true)` and the same for
 * the navigation bar; on iOS it sets `.darkContent`. Read from the plugin
 * sources in `node_modules/@capacitor/android` and `@capacitor/ios`, not run on
 * a phone. No `bar` is passed, which on Android styles both bars and on iOS
 * the status bar.
 *
 * WEB AND PWA: nothing. Outside the shell the browser owns its chrome, and
 * `theme-color` with `apple-mobile-web-app-status-bar-style` (in
 * `use-theme.ts`) are the levers there. `Capacitor.isNativePlatform()` is the
 * same probe `share-target.ts` and `use-storage-persistence.ts` read.
 *
 * A FAILED CALL is reported once per page, under `"system-bars-style"`, and
 * does not light the Books ≡ marker (`lib/failure-marker.ts`): the bars keep
 * their previous style, nothing the person made is touched, and the theme
 * toggle still works. Once, because this runs on every theme apply, including
 * every mount of the Books screen, and a call that fails every time would
 * otherwise fill the 50-row log and push out a failure a facilitator needs to
 * send.
 */
let reported = false;

export function applySystemBarsStyle(theme: Theme): void {
  if (!Capacitor.isNativePlatform()) return;
  // A synchronous throw is caught as well as a rejection: this runs from
  // `installStoredTheme` before React renders, where a throw would stop the
  // app from starting over a cosmetic call.
  try {
    SystemBars.setStyle({ style: systemBarsStyleFor(theme) }).catch(reportOnce);
  } catch (cause) {
    reportOnce(cause);
  }
}

function reportOnce(cause: unknown): void {
  if (reported) return;
  reported = true;
  reportFailure(cause, "system-bars-style");
}

function systemBarsStyleFor(theme: Theme): SystemBarsStyle {
  switch (theme) {
    case "light":
      return SystemBarsStyle.Light;
    case "dark":
      return SystemBarsStyle.Dark;
  }
}
