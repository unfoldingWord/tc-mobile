import { useCallback, useSyncExternalStore } from "react";

import { reportFailure } from "./report-failure";
import {
  ALWAYS_CHAPTER_NUMBER_KEY,
  chapterNameShown,
  readStoredAlwaysChapterNumber,
  storeAlwaysChapterNumber,
} from "@/lib/settings";
import { strings } from "@/lib/strings";

/**
 * The DOM half of the Settings screen's non-theme settings (#1575). The same
 * shape and the same store as the theme (`hooks/use-theme.ts`, read its
 * docblock first): a module-level live value that every screen reads, with
 * `localStorage` for hydrating once and for best-effort persistence. A failed
 * write costs a relaunch and not a navigation, because `App` renders Books XOR
 * Segments and the screen that toggled may be unmounted when another reads.
 */
let liveAlwaysChapterNumber: boolean | null = null;
const listeners = new Set<() => void>();

function currentAlwaysChapterNumber(): boolean {
  liveAlwaysChapterNumber ??= readAlwaysChapterNumber();
  return liveAlwaysChapterNumber;
}

function readAlwaysChapterNumber(): boolean {
  try {
    return readStoredAlwaysChapterNumber(
      window.localStorage.getItem(ALWAYS_CHAPTER_NUMBER_KEY)
    );
  } catch {
    // Not reported, for the theme's reason (`readTheme`): once per launch, a
    // cosmetic fallback to the default, nothing for anyone to act on.
    return readStoredAlwaysChapterNumber(null);
  }
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

/**
 * Whether chapter labels always show the sequential number (S12). Read-only,
 * for the screens that draw a chapter's label.
 */
function useAlwaysChapterNumber(): boolean {
  return useSyncExternalStore(
    subscribe,
    currentAlwaysChapterNumber,
    currentAlwaysChapterNumber
  );
}

/**
 * A chapter's display heading with the setting applied (S12): the name when it
 * has one, else "Chapter {number}"; with the setting on, always the number.
 * Every screen that draws a chapter's label reads this rather than
 * `strings.chapterHeading` directly, so a toggle moves them all.
 */
export function useChapterHeading(name: string | null, n: number): string {
  const always = useAlwaysChapterNumber();
  return strings.chapterHeading(chapterNameShown(name, always), n);
}

/** The setting and its toggle, for the Settings row. */
export function useAlwaysChapterNumberSetting(): {
  readonly on: boolean;
  readonly toggle: () => void;
} {
  const on = useAlwaysChapterNumber();
  const toggle = useCallback(() => {
    const next = !currentAlwaysChapterNumber();
    // The live value moves first, so the screen is right whatever storage does.
    liveAlwaysChapterNumber = next;
    for (const listener of listeners) listener();
    try {
      window.localStorage.setItem(
        ALWAYS_CHAPTER_NUMBER_KEY,
        storeAlwaysChapterNumber(next)
      );
    } catch (cause) {
      // The choice still applies now and will not survive a relaunch;
      // reported, not shown (the control's own state is the feedback).
      reportFailure(cause, "use-settings: persist");
    }
  }, []);
  return { on, toggle };
}
