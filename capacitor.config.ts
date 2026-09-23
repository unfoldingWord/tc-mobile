import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor wraps the existing PWA in a native WebView so the same web build
 * (`npm run build` -> `dist/`) ships to TestFlight and as an Android APK for
 * the Nairobi training (#262). This is the shell only — no product changes.
 *
 * `webDir` is the Vite output directory (`dist`), the same bundle Cloudflare
 * Workers Builds serves for the PWA. Capacitor copies it into the native
 * projects at `cap sync`; it does not deploy anything, so it cannot collide
 * with the Cloudflare deploy. See docs/native/README.md.
 */
const config: CapacitorConfig = {
  appId: "org.unfoldingword.tcmobile",
  appName: "tC Mobile",
  webDir: "dist",
  plugins: {
    App: {
      // `@capacitor/app`'s Android `OnBackPressedCallback` starts DISABLED, and
      // `attachNativeBack` (use-nav-stack.ts) enables it only while the app's
      // own `backButton` listener is registered. Left enabled with no listener
      // — the crash screen, the window before the first paint's effects — the
      // plugin consumes a root Back and does nothing (`AppPlugin.java`
      // `handleOnBackPressed`: no listeners and `!canGoBack` → return), so the
      // activity default that used to leave the app never runs (#374, George
      // r1 P2-2 on PR 634). Disabled, the press falls through to that default.
      disableBackButtonHandler: true,
    },
  },
};

export default config;
