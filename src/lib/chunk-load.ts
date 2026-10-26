/**
 * A lazily loaded chunk that would not load, and what to do about it (#1421
 * O1).
 *
 * After an app update the service worker deletes the old build's hashed files
 * (`cleanupOutdatedCaches` in `vite.config.ts`), but a page that was already
 * open still asks for them by their old names. The first `import()` of a lazy
 * chunk — the zip library behind Share Book and Export project, the language
 * list, the OBS catalogue — then fails, and the action fails with it.
 *
 * The DRI's pick on #1421, verbatim: "Reload once, then fail (Recommended)".
 * The browser side lives in `hooks/stale-chunk-reload.ts`; this file holds the
 * two decisions that need no browser, so they can be tested in Node.
 */

/**
 * The messages each engine gives a dynamic `import()` whose module could not
 * be fetched, lower-cased. Matched as substrings, because Chromium and Firefox
 * append the URL.
 *
 * Only the Chromium message is observed by a test that runs a real engine
 * (`e2e/stale-chunk-reload.spec.ts`). The WebKit and Gecko strings are the
 * engines' own wording as published, not seen here; a WebKit or Gecko build
 * that words it differently falls through to an ordinary failure, which is
 * what happened before this file existed.
 */
const CHUNK_LOAD_MESSAGES: readonly string[] = [
  // Chromium (Chrome, Android WebView, Edge)
  "failed to fetch dynamically imported module",
  // WebKit (Safari, every iOS browser, the iOS shell)
  "importing a module script failed",
  // Gecko (Firefox)
  "error loading dynamically imported module",
  // Vite's own preload helper, when a chunk's stylesheet is the missing file
  "unable to preload css for",
];

/** True when `cause` is a failed fetch of a lazily loaded chunk. */
export function isChunkLoadError(cause: unknown): boolean {
  const message =
    typeof cause === "string"
      ? cause
      : typeof (cause as { message?: unknown } | null)?.message === "string"
        ? (cause as { message: string }).message
        : null;
  if (message === null) return false;
  const lower = message.toLowerCase();
  return CHUNK_LOAD_MESSAGES.some((m) => lower.includes(m));
}

/**
 * Why a chunk failure is reported instead of reloaded:
 *
 *   unsaved-audio    a reload would lose audio that exists only in memory
 *   already-reloaded this build already reloaded once for a chunk, so a second
 *                    reload would land on the same build and fail again
 *   no-guard         the once-per-build mark cannot be read, so nothing would
 *                    stop a reload loop
 */
type ChunkFailureReason = "unsaved-audio" | "already-reloaded" | "no-guard";

export type ChunkRecovery =
  | { readonly kind: "reload" }
  | { readonly kind: "report"; readonly reason: ChunkFailureReason };

/**
 * Reload once per build, never over unsaved audio.
 *
 * `reloadedBuild` is the build that last reloaded for a chunk in this tab:
 * `null` when none has, `undefined` when the mark cannot be read. Unsaved
 * audio is checked first: losing a recording is worse than a failed share.
 */
export function chooseChunkRecovery(input: {
  readonly build: string;
  readonly reloadedBuild: string | null | undefined;
  readonly holdsUnsavedAudio: boolean;
}): ChunkRecovery {
  if (input.holdsUnsavedAudio) {
    return { kind: "report", reason: "unsaved-audio" };
  }
  if (input.reloadedBuild === undefined) {
    return { kind: "report", reason: "no-guard" };
  }
  if (input.reloadedBuild === input.build) {
    return { kind: "report", reason: "already-reloaded" };
  }
  return { kind: "reload" };
}
