/**
 * Reload once when a lazily loaded chunk fails to load after an update, then
 * fail (#1421 O1). The DRI's pick, verbatim: "Reload once, then fail
 * (Recommended)".
 *
 * Every dynamic `import()` in the build goes through Vite's preload helper,
 * and that helper dispatches `vite:preloadError` on `window` for any rejection
 * of the import before it rethrows. One listener therefore covers all of
 * them: the zip library (`lib/export/book.ts`), the language list
 * (`lib/languages/list.ts`), the OBS catalogue (`lib/obs/catalog.ts`) and the
 * Capacitor plugins' web halves. `tests/dist-stale-chunk.test.ts` checks the
 * built bundle for that, so a dynamic import that stops going through the
 * helper fails a test rather than going unhandled.
 *
 * The listener does not call `preventDefault()`: the import still rejects, so
 * the action that asked for it fails the way it always did. What this adds
 * happens after that:
 *
 *   - a chunk failure (`isChunkLoadError`) with nothing unsaved reloads the
 *     page once for this build, after the failure log has flushed, writing an
 *     informational `"stale-chunk-reload"` row first;
 *   - a second chunk failure in the same build, in the same tab, does not
 *     reload again; it is reported as `"stale-chunk"`;
 *   - so is any chunk failure while audio exists only in memory — an open
 *     recorder sheet, a take whose save has not landed, a cut phrase — because
 *     a reload would lose it. That is the same question `App` already answers
 *     for a database upgrade (`holdsUnsavedAudio` in `lib/takes/pending-take.ts`),
 *     and `App` registers that answer here with `setUnsavedAudioCheck`.
 *
 * The once-per-build mark is in `sessionStorage`, keyed to the build stamp, so
 * it lasts across the reload in this tab and no longer. A reload that lands on
 * a NEW build may reload once more for that build; a reload that lands on the
 * same build (the old service worker still in charge) cannot.
 */

import { flushFailureLog } from "./failure-log";
import { reportFailure } from "./report-failure";
import { chooseChunkRecovery, isChunkLoadError } from "@/lib/chunk-load";
import { restartAfterFlush } from "@/lib/restart-after-flush";

const RELOADED_BUILD_KEY = "tc-stale-chunk-reloaded-build";

export interface StaleChunkDeps {
  /** This build's stamp. */
  readonly build: string;
  /** `sessionStorage`, or `null` where it cannot be reached. */
  readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  readonly holdsUnsavedAudio: () => boolean;
  readonly report: (cause: unknown, context: string) => void;
  readonly flush: () => Promise<void>;
  readonly reload: () => void;
  /**
   * Runs `run` on a later task, so the failing action's own catch (and the
   * row it writes) gets there first, unless that catch itself awaits.
   */
  readonly defer: (run: () => void) => void;
}

/**
 * The handler for one page. Once it has scheduled a reload, every later
 * failure on the page is ignored: the page is going away, unless unsaved audio
 * calls the reload off at the last moment, which re-arms the handler.
 */
export function createStaleChunkHandler(
  deps: StaleChunkDeps
): (cause: unknown) => void {
  let reloading = false;
  return (cause) => {
    if (reloading || !isChunkLoadError(cause)) return;
    const { storage } = deps;
    let reloadedBuild: string | null | undefined = undefined;
    if (storage !== null) {
      try {
        reloadedBuild = storage.getItem(RELOADED_BUILD_KEY);
      } catch {
        // A blocked or private store: no mark can be read, so the decision
        // below refuses to reload and reports instead.
        reloadedBuild = undefined;
      }
    }
    const choice = chooseChunkRecovery({
      build: deps.build,
      reloadedBuild,
      holdsUnsavedAudio: deps.holdsUnsavedAudio(),
    });
    if (choice.kind === "report" || storage === null) {
      deps.report(cause, "stale-chunk");
      return;
    }
    try {
      storage.setItem(RELOADED_BUILD_KEY, deps.build);
    } catch {
      // A mark that cannot be written cannot stop a loop, so no reload; the
      // chunk failure is the row worth keeping.
      deps.report(cause, "stale-chunk");
      return;
    }
    reloading = true;
    deps.report(cause, "stale-chunk-reload");
    // Audio can become unsaved while the reload waits on the defer and the
    // flush (a recorder opened, a take landed), so ask again in the same turn
    // as the reload. If it is held now, the reload is called off: the mark is
    // put back so a later failure may still reload once, and the chunk
    // failure is reported the way any other refusal is.
    const previousMark = reloadedBuild;
    const reloadUnlessUnsaved = (): void => {
      if (!deps.holdsUnsavedAudio()) {
        deps.reload();
        return;
      }
      reloading = false;
      try {
        if (typeof previousMark === "string") {
          storage.setItem(RELOADED_BUILD_KEY, previousMark);
        } else storage.removeItem(RELOADED_BUILD_KEY);
      } catch {
        // The mark stays consumed, so this build will not reload for a chunk
        // again in this tab: the safe direction. The row below records it.
      }
      deps.report(cause, "stale-chunk");
    };
    deps.defer(() => {
      void restartAfterFlush(false, () => {}, deps.flush, reloadUnlessUnsaved);
    });
  };
}

let unsavedAudioCheck: () => boolean = () => false;

/**
 * Register what `App` holds in memory. Returns the removal. Before `App`
 * mounts there is no recorder, take or clipboard to lose.
 */
export function setUnsavedAudioCheck(check: () => boolean): () => void {
  unsavedAudioCheck = check;
  return () => {
    if (unsavedAudioCheck === check) unsavedAudioCheck = () => false;
  };
}

/** Whether `App` holds audio a reload would lose, as last registered. */
export function holdsUnsavedAudioNow(): boolean {
  return unsavedAudioCheck();
}

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage ?? null;
  } catch {
    // Reading the property itself throws where storage is blocked; `null`
    // makes the handler report instead of reload.
    return null;
  }
}

/** Install the `vite:preloadError` listener for the life of the page. */
export function installStaleChunkReload(): void {
  const handle = createStaleChunkHandler({
    build: `${__APP_VERSION__}+${__BUILD_SHA__}`,
    storage: sessionStore(),
    holdsUnsavedAudio: holdsUnsavedAudioNow,
    report: reportFailure,
    flush: flushFailureLog,
    reload: () => window.location.reload(),
    defer: (run) => setTimeout(run, 0),
  });
  window.addEventListener("vite:preloadError", (event) => {
    handle((event as Event & { payload?: unknown }).payload);
  });
}
