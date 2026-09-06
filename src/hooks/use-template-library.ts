import { useCallback, useRef, useState } from "react";

import { reportFailure } from "./report-failure";
import { beginCreate, endCreate } from "./template-create-guard";
import { listStories } from "@/lib/obs/catalog";
import { createBookFromTemplate, type Template } from "@/lib/storage/templates";
import { getBook } from "@/lib/storage/books";
import type { BookId, ChapterId } from "@/types/domain";

/** One entry in the OBS story preview list (#246's picker). */
export interface ObsStoryRow {
  readonly story: number;
  readonly title: string;
  readonly frameCount: number;
}

// Not exported: nothing outside this file names it — `UseTemplateLibrary`'s
// `create` return type carries the shape structurally, mirroring
// `lib/storage/templates.ts`'s own `TemplateChapter` (also file-local for the
// same reason).
interface CreatedBook {
  readonly bookId: BookId;
  readonly firstChapterId: ChapterId;
}

export interface UseTemplateLibrary {
  /** `null` while unloaded/loading; set once `listStories()` resolves. */
  readonly obsStories: readonly ObsStoryRow[] | null;
  readonly obsLoadFailed: boolean;
  /**
   * Fetch the story list, once. A second call while already loaded (or
   * already failed) is a no-op unless `force` — the picker's retry control —
   * is passed, so re-opening the OBS category repeatedly does not repeat the
   * dynamic `import()` of the catalogue chunk.
   */
  loadObsStories: (force?: boolean) => void;
  /** Template ids (`"obs"`, `"bible:RUT"`, …) with a create in flight. */
  readonly creatingIds: ReadonlySet<string>;
  /** Template ids whose last create attempt failed — cleared by a retry. */
  readonly failedIds: ReadonlySet<string>;
  /**
   * Resolve a template and create its Book in one call. `id` identifies the
   * template for the busy/failed sets (`Template.id` — pass it before the
   * template itself is resolved, since `obsTemplate()` is an async dynamic
   * import and the UI-level double-tap guard below must close over the id
   * the tap named, not a value only available after that import settles).
   *
   * Never rejects: a failure reports to the sink and resolves `null`.
   */
  create: (
    id: string,
    resolve: () => Template | Promise<Template>
  ) => Promise<CreatedBook | null>;
}

/**
 * The Template Library's UI-facing state (#246, part of B7's #33): the OBS
 * story list (a preview, loaded lazily) and the create flow shared by both
 * template categories.
 *
 * **Idempotency at the UI (AGENTS.md's bar, applied above the storage
 * layer's own).** `createBookFromTemplate` already makes a REPEATED import of
 * the SAME template safe — it creates a second, independently-named book
 * rather than colliding (#253) — so the risk here is narrower: a double-tap
 * on the SAME row before React re-renders it disabled, which would fire two
 * concurrent creates the storage layer would happily both honour, producing
 * TWO books from one tap. `creatingRef` (a `Set`, checked synchronously
 * before any `await`) closes exactly that window, and it is keyed per
 * template id rather than a single flag so tapping a DIFFERENT template
 * while one is still writing is a legitimate second action, not a repeat of
 * the first — 66 Bible-book rows would otherwise all block on each other.
 */
export function useTemplateLibrary(): UseTemplateLibrary {
  const [obsStories, setObsStories] = useState<readonly ObsStoryRow[] | null>(
    null
  );
  const [obsLoadFailed, setObsLoadFailed] = useState(false);
  const [creatingIds, setCreatingIds] = useState<ReadonlySet<string>>(
    new Set()
  );
  const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(new Set());
  // The synchronous half of the double-tap guard — see the docblock above.
  // React state alone cannot close this window: two taps in the same event
  // loop turn both read `creatingIds` from the same pre-update render.
  const creatingRef = useRef<Set<string>>(new Set());

  const loadObsStories = useCallback(
    (force = false) => {
      if (!force && (obsStories !== null || obsLoadFailed)) return;
      setObsLoadFailed(false);
      void (async () => {
        try {
          const stories = await listStories();
          setObsStories(stories);
        } catch (cause) {
          reportFailure(cause, "template-library-obs-list");
          setObsLoadFailed(true);
        }
      })();
    },
    [obsStories, obsLoadFailed]
  );

  const create = useCallback(
    async (
      id: string,
      resolve: () => Template | Promise<Template>
    ): Promise<CreatedBook | null> => {
      if (!beginCreate(creatingRef.current, id)) return null; // already in flight
      setCreatingIds(new Set(creatingRef.current));
      setFailedIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      try {
        const template = await resolve();
        const bookId = await createBookFromTemplate(template);
        const book = await getBook(bookId);
        const firstChapterId = book?.chapterIds[0];
        // Every `Template` this module knows builds at least one chapter
        // (`obsTemplate`'s 50, `bibleBookTemplate`'s book-chapter-count, both
        // non-empty) — so a book with none, or gone entirely, is a genuine
        // failure to surface rather than a silent no-navigate.
        if (firstChapterId === undefined) {
          throw new Error(
            `Created book ${bookId} from template "${id}" has no chapters`
          );
        }
        return { bookId, firstChapterId };
      } catch (cause) {
        reportFailure(cause, "template-library-create");
        setFailedIds((prev) => new Set(prev).add(id));
        return null;
      } finally {
        endCreate(creatingRef.current, id);
        setCreatingIds(new Set(creatingRef.current));
      }
    },
    []
  );

  return {
    obsStories,
    obsLoadFailed,
    loadObsStories,
    creatingIds,
    failedIds,
    create,
  };
}
