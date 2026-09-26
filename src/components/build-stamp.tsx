import { useRef } from "react";

import { registerTap } from "@/lib/phone-check/reveal";

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
 *
 * `onReveal` is the tester's way into the phone check (#1009) on a build with
 * no address bar: five taps within three seconds (`lib/phone-check/reveal.ts`).
 * Undiscoverable on purpose, and on this line because it is already the
 * tester's line. `App` passes it only while opening the check is safe.
 */
export function BuildStamp({ onReveal }: { onReveal?: () => void }) {
  const taps = useRef<readonly number[]>([]);
  const onClick = onReveal
    ? () => {
        const next = registerTap(taps.current, Date.now());
        taps.current = next.taps;
        if (next.reveal) onReveal();
      }
    : undefined;
  return (
    <footer className="build-stamp" aria-hidden="true" onClick={onClick}>
      v{__APP_VERSION__} · {__BUILD_SHA__}
    </footer>
  );
}
