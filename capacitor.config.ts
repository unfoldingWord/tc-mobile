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
};

export default config;
