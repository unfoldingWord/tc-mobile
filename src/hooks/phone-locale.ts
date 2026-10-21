/**
 * The UI speaks the phone's language (#1538, ADR 0015).
 *
 * The locale is a fact about the phone, read from `navigator.languages`, not a
 * stored choice and not a build constant. It is read before the first render
 * (`installPhoneLocale`, called from `main.tsx` before `createRoot`, the slot
 * `installStoredTheme()` uses), and again on a `languagechange` and on return
 * to the foreground (`usePhoneLocale`).
 *
 * Only locales whose tables are complete are candidates
 * (`completeLocales`, ADR 0015 (g)), so a screen is never half translated:
 * the walk goes on to the phone's next language and ends at English. No table
 * but English is complete today, so every phone still gets English.
 *
 * NEVER UNDER A TAKE (ADR 0015 (e)). While a take is open the follower is not
 * listening, so a change waits; when the take closes it re-reads the phone's
 * list and applies whatever it says then. A hidden page already seals an open
 * take (#836), so a change made in the settings app is applied on return,
 * after that seal.
 *
 * What this does not do: the inline `<head>` script (ADR 0015 (a) item 3, a
 * fallback added only if the right-to-left device check sees a reflow),
 * right-to-left layout, or the manifest and native names, which stay English
 * (ADR 0015 (c)).
 */

import { useCallback, useSyncExternalStore } from "react";

import { completeLocales, installLocale } from "@/lib/i18n/locales";
import { resolveLocale } from "@/lib/i18n/resolve";
import { activeLocale } from "@/lib/locale";

/** The phone's languages, most preferred first. */
function phoneLanguages(): readonly string[] {
  const list = navigator.languages;
  if (Array.isArray(list) && list.length > 0) return list;
  // Some engines leave the list empty and set only the one language.
  return typeof navigator.language === "string" ? [navigator.language] : [];
}

/**
 * Resolve `languages` among the complete locales, install that locale when it
 * is not the running one, and write `lang` and `dir` on the root element.
 * Returns whether the running locale changed, so a caller knows to re-render.
 *
 * `lang` and `dir` are written every time, not only on a change: they are
 * cheap, and the build's static `en`/`ltr` is then never what a resolved
 * phone runs under.
 */
export function applyPhoneLocale(
  languages: readonly string[],
  root: HTMLElement = document.documentElement
): boolean {
  const next = resolveLocale(languages, completeLocales());
  const changed = next !== activeLocale();
  if (changed) installLocale(next);
  root.lang = next.tag;
  root.dir = next.dir;
  return changed;
}

/** The launch pass: before `createRoot`, so the first render is already right. */
export function installPhoneLocale(): void {
  applyPhoneLocale(phoneLanguages());
}

/**
 * Follow the phone's language while the app runs, and re-render when it
 * changes. `takeOpen` is true from the moment the recorder leaves idle until
 * it is idle again; while it is, nothing is listened to or applied.
 *
 * `useSyncExternalStore` with `activeLocale` as the snapshot: a new
 * `takeOpen` is a new `subscribe`, which React re-subscribes, and subscribing
 * is where the closed-take re-read happens. The snapshot is the installed
 * `Locale` object, so React re-renders exactly when a different one is
 * installed. Mounted in `App`, which re-renders every screen beneath it.
 */
export function usePhoneLocale(takeOpen: boolean): void {
  const subscribe = useCallback(
    (notify: () => void): (() => void) => {
      if (takeOpen) return () => {};
      const follow = () => {
        if (applyPhoneLocale(phoneLanguages())) notify();
      };
      const onVisibility = () => {
        if (document.visibilityState === "visible") follow();
      };
      // A change that arrived while a take was open, or while unmounted.
      follow();
      window.addEventListener("languagechange", follow);
      document.addEventListener("visibilitychange", onVisibility);
      return () => {
        window.removeEventListener("languagechange", follow);
        document.removeEventListener("visibilitychange", onVisibility);
      };
    },
    [takeOpen]
  );
  useSyncExternalStore(subscribe, activeLocale);
}
