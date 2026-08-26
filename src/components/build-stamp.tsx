/**
 * The build identity, shown as a muted footer line.
 *
 * Two facts a tester needs and could not get before: the release version (for
 * humans — "0.1.1") and the exact commit (for precision — which build am I
 * actually on). It also proves the PWA service worker updated: if the stamp did
 * not change after a redeploy, the old cached build is still being served.
 *
 * Both values are injected at build time (`vite.config.ts` `define`), so this is
 * a static string with no runtime cost. `aria-hidden` — it is developer/tester
 * metadata, not content for the non-reading translator this UI is for.
 */
export function BuildStamp() {
  return (
    <footer className="build-stamp" aria-hidden="true">
      v{__APP_VERSION__} · {__BUILD_SHA__}
    </footer>
  );
}
