import { useCallback, useSyncExternalStore } from "react";

import { reportFailure } from "./report-failure";
import {
  ALWAYS_CHAPTER_NUMBER_KEY,
  NORMALIZE_ON_FINISHED_KEY,
  chapterNameShown,
  readStoredAlwaysChapterNumber,
  readStoredNormalizeOnFinished,
  storeAlwaysChapterNumber,
  storeNormalizeOnFinished,
} from "@/lib/settings";
import { headingNumber } from "@/lib/chapter-slot";
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
 * has one, else "Chapter {n}"; with the setting on, always the sequential
 * number. `slot` is the chapter's place in its book and `templateNumber` the
 * number a template gave it (`null` for a chapter added by hand), and
 * `headingNumber` picks between them (#1272, the DRI's Q1 (b)). Every screen
 * that draws a chapter's label reads this rather than `strings.chapterHeading`
 * directly, so a toggle moves them all.
 */
export function useChapterHeading(
  name: string | null,
  slot: number,
  templateNumber: number | null
): string {
  const always = useAlwaysChapterNumber();
  return strings.chapterHeading(
    chapterNameShown(name, always),
    headingNumber(slot, templateNumber, always)
  );
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

/**
 * Whether the Finished transcode evens out a segment's loudness (#1433, U6b).
 * Read per segment by the sweep, outside React, so a change applies from the
 * next segment on and never to one already finished.
 */
export function normalizeOnFinished(): boolean {
  try {
    return readStoredNormalizeOnFinished(
      window.localStorage.getItem(NORMALIZE_ON_FINISHED_KEY)
    );
  } catch {
    // Not reported, for `readAlwaysChapterNumber`'s reason: storage that
    // cannot be read falls back to the default, nothing to act on.
    return readStoredNormalizeOnFinished(null);
  }
}

/**
 * The loudness switch and its toggle, for the Settings row (#1433, U6b).
 * Unlike the chapter-number setting there is no live copy: the sweep reads
 * storage itself, so the row reads storage too and can never show a value the
 * sweep will not use. A write that fails leaves the row as it was, and is
 * reported.
 */
export function useNormalizeOnFinishedSetting(): {
  readonly on: boolean;
  readonly toggle: () => void;
} {
  const on = useSyncExternalStore(
    subscribe,
    normalizeOnFinished,
    normalizeOnFinished
  );
  const toggle = useCallback(() => {
    try {
      window.localStorage.setItem(
        NORMALIZE_ON_FINISHED_KEY,
        storeNormalizeOnFinished(!normalizeOnFinished())
      );
    } catch (cause) {
      reportFailure(cause, "use-settings: persist");
      return;
    }
    for (const listener of listeners) listener();
  }, []);
  return { on, toggle };
}
