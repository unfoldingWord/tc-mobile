import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor wraps the existing PWA in a native WebView so the same app code
 * ships to TestFlight and as an Android APK for the Nairobi training (#262).
 * This is the shell only — no product changes.
 *
 * `webDir` is the Vite output directory (`dist`) — but the NATIVE build is
 * `npm run build:native` (`vite build --mode native`), not the plain
 * `npm run build` Cloudflare Workers Builds runs for the PWA (#923). Both
 * emit the same application code into `dist/`; the native build additionally
 * swaps `vite-plugin-pwa`'s output for a self-unregistering, cache-clearing
 * `sw.js` and ships no service-worker registration script at all, because a
 * Workbox offline precache adds nothing inside a WebView that already reads
 * its bundle from local files, and a stale one is exactly what left an
 * upgraded APK still running the old build. `cap sync` copies whichever
 * `dist/` is on disk at the time it runs — always the native one for a real
 * native build, per `docs/native/README.md`'s "core loop" — into the native
 * projects; it does not deploy anything, so it cannot collide with the
 * Cloudflare deploy. See `docs/native/README.md` and `vite.config.ts`'s
 * native-mode comment.
 */
const config: CapacitorConfig = {
  appId: "org.unfoldingword.tcmobile",
  appName: "tC Mobile",
  webDir: "dist",
  android: {
    // Explicit false also clears a previous diagnostic sync.
    webContentsDebuggingEnabled: process.env.TC_ANDROID_DIAGNOSTIC === "true",
  },
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
