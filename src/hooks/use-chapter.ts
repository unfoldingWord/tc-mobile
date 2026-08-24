import { useCallback, useEffect, useRef, useState } from "react";

import { computePeaks } from "@/lib/audio/peaks";
import { getStory, obsFrameScope, OBS_BOOK_CODE, thumbUrl } from "@/lib/obs";
import { deleteClip, getClip, newClipId, putClip } from "@/lib/storage/clips";
import {
  addChapter,
  addSection,
  addTake,
  createProject,
  getSectionsOfChapter,
  listProjects,
} from "@/lib/storage/projects";
import { getDb } from "@/lib/storage/db";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import {
  discardSave,
  failSave,
  retrySave,
  startSave,
  succeedSave,
  type PendingTake,
} from "@/lib/takes/pending-take";
import { narrationUrl } from "./obs-media";
import { saveFailureKind } from "./save-failure";
import type { ChapterId, ProjectId, SegmentId } from "@/types/domain";
import type { ChapterCard, SectionCard } from "@/types/view";

const PEAK_BUCKETS = 120;

/**
 * The held recording and its transitions live in `lib/takes/pending-take.ts`.
 *
 * Re-exported here because this hook is where the type is consumed from, and
 * because the move is the point: the state machine that decides whether a
 * translator keeps or loses a take is now testable in plain Node.
 */
export type { PendingTake };

/**
 * Load an OBS story as a working chapter, creating it on first open.
 *
 * The catalogue supplies the shape (frames, artwork, order); IndexedDB supplies
 * whatever has been recorded against it. Peaks are computed once here rather
 * than in the row, so scrolling never walks raw samples.
 */
/**
 * Assemble one OBS story into a working chapter.
 *
 * Pure data loading with no React state, so the hook below can call it from an
 * effect without setting state before its first await — and so it can be
 * reasoned about (and later tested) on its own.
 */
async function loadObsChapterCard(storyNumber: number): Promise<ChapterCard> {
  const story = await getStory(storyNumber);
  if (!story) throw new Error(`No OBS story ${storyNumber}`);

  const chapterId = await ensureObsChapter(storyNumber, story.frames.length);
  const sections = await getSectionsOfChapter(chapterId);
  const db = await getDb();

  const cards: SectionCard[] = [];
  for (const [i, section] of sections.entries()) {
    const frame = story.frames[i];
    const segmentId = section.segmentIds[0] as SegmentId | undefined;
    const segment = segmentId ? await db.get("segments", segmentId) : undefined;

    let peaks = null;
    let durationMs: number | null = null;
    if (segment?.activeTakeId) {
      const take = await db.get("takes", segment.activeTakeId);
      const clip = take ? await getClip(take.clipId) : undefined;
      if (clip) {
        peaks = computePeaks(clip.samples, PEAK_BUCKETS);
        durationMs = clip.meta.durationMs;
      }
    }

    cards.push({
      sectionId: section.id,
      segmentId: segmentId as SegmentId,
      ordinal: i + 1,
      scope: section.ref.scope,
      thumbUrl: frame ? thumbUrl(storyNumber, frame.frame) : null,
      imageUrl: frame?.image ?? null,
      peaks,
      durationMs,
      status: segment?.status ?? "not-started",
    });
  }

  return {
    chapterId,
    title: story.title,
    ordinal: storyNumber,
    // The single conditional the whole browser turns on.
    hasArtwork: cards.some((c) => c.thumbUrl !== null),
    referenceAudioUrl: narrationUrl(storyNumber),
    sections: cards,
  };
}

/**
 * A load, and the story it belongs to.
 *
 * The story number is part of the state rather than something compared against
 * it afterwards, so there is no representable value that pairs one story's
 * card with another story's number.
 */
type ChapterLoad =
  | { readonly story: number; readonly status: "loading" }
  | {
      readonly story: number;
      readonly status: "ready";
      readonly card: ChapterCard;
    }
  | {
      readonly story: number;
      readonly status: "error";
      readonly message: string;
    };

/**
 * Load an OBS story as a working chapter, creating it on first open.
 *
 * The catalogue supplies the shape (frames, artwork, order); IndexedDB supplies
 * whatever has been recorded against it. Peaks are computed once during load
 * rather than in the row, so scrolling never walks raw samples.
 */
export function useObsChapter(storyNumber: number) {
  /**
   * One state, stamped with the story it describes.
   *
   * As three independent states this could report a chapter and a story that
   * were not the same story: `loading` never went back to `true` and `chapter`
   * was never cleared when `storyNumber` changed, so after a story change the
   * screen kept rendering — and accepting taps on — the previous story's rows
   * until the new chapter arrived. A tap there could open a section and start
   * the microphone, and the arriving chapter then tore that section view down
   * by a lookup that missed.
   *
   * Keying the state on the story answers staleness during render, where it
   * cannot be raced, rather than in a second effect that has a window of its
   * own.
   */
  const [load, setLoad] = useState<ChapterLoad>({
    story: storyNumber,
    status: "loading",
  });
  const [reloadToken, setReloadToken] = useState(0);
  /**
   * A reload triggered by a successful save, still in flight.
   *
   * Clearing the pending slot is not the end of a save: the card on screen
   * still carries `durationMs: null` for the section just recorded, and
   * `loadObsChapterCard` re-reads every active clip in the chapter to
   * recompute peaks — seconds of PCM on a full chapter. In that window the
   * Record control would re-enable over a section that reads as unrecorded,
   * and a translator who records again gets a second take made active,
   * demoting the good one. The save is finished when the card says so.
   */
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const card = await loadObsChapterCard(storyNumber);
        // Guards a story change or unmount landing after a slow read.
        if (cancelled) return;
        setLoad({ story: storyNumber, status: "ready", card });
        setRefreshing(false);
      } catch (cause) {
        if (cancelled) return;
        setLoad({
          story: storyNumber,
          status: "error",
          message: cause instanceof Error ? cause.message : String(cause),
        });
        // Cleared on the failure path too: a reload that never lands must not
        // leave the record control disabled for the rest of the session.
        setRefreshing(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [storyNumber, reloadToken]);

  // A load belonging to a story we have left shows nothing at all — not its
  // rows, not its error. Until the current story arrives the screen is honestly
  // loading. A `reload` after a save keeps the same story, so a saved take
  // never flashes the section view away.
  const current = load.story === storyNumber ? load : null;
  const chapter = current?.status === "ready" ? current.card : null;
  const error = current?.status === "error" ? current.message : null;
  const loading = current === null || current.status === "loading";

  const reload = useCallback(() => {
    setRefreshing(true);
    setReloadToken((t) => t + 1);
  }, []);

  /**
   * The one unsaved recording the app is holding.
   *
   * State rather than a ref, because it has to both survive a re-render *and*
   * cause one — the recovery screen only exists if the store holding the audio
   * is render-visible.
   *
   * The hook is mounted by `App`, which never unmounts, so the slot survives
   * opening a section, leaving it, and changing story. Every transition of it
   * is a pure function in `lib/takes/pending-take.ts`; what is left here is the
   * writes, the slot, and the orphan delete.
   */
  const [pending, setPending] = useState<PendingTake | null>(null);
  /**
   * Whether a write is in flight, readable synchronously.
   *
   * `retrySave` already refuses a second concurrent attempt, but it can only
   * judge the slot it is handed, and the hook reads that from the render
   * closure. Two taps on Retry in one frame both saw `state: "failed"`, both
   * produced a fresh `{ state: "saving" }`, and both committed — and `addTake`
   * appends unconditionally, so one clip became two take rows with the second
   * active. A ref answers for the current moment rather than the last render.
   */
  const savingRef = useRef(false);

  const commit = useCallback(
    async (take: PendingTake): Promise<boolean> => {
      // Synchronous, before the first await: this is what a second tap in the
      // same frame reads.
      savingRef.current = true;
      try {
        const meta = await putClip(
          take.clipId,
          take.samples,
          CANONICAL_SAMPLE_RATE
        );
        await addTake(take.segmentId, take.clipId, meta.durationMs);
        // Cleared only here, and only for this attempt. A `finally` would drop
        // the samples on the failure path, which is the one path they exist
        // for — and nothing would catch it: `tests/pending-take.test.ts`
        // covers `failSave` carrying the samples through, not this hook, which
        // has no renderer to drive it (checked by adding
        // `finally { setPending(null) }` here: the suite stays green). This
        // line and the `catch` above are the whole guard.
        setPending((held) => succeedSave(held, take.clipId));
        reload();
        return true;
      } catch (cause) {
        console.error("Saving a take failed", cause);
        setPending((held) =>
          failSave(held, take.clipId, saveFailureKind(cause))
        );
        return false;
      } finally {
        // Safe in a `finally` where `setPending(null)` is not: this releases a
        // guard rather than dropping the samples, and a guard left set would
        // lock out the retry that the failure path exists to offer.
        savingRef.current = false;
      }
    },
    [reload]
  );

  /**
   * Persist a recording against a section and refresh the chapter.
   *
   * Never rejects: a failure becomes visible state instead, because the caller
   * for this is a tap handler and a rejection there is an unhandled promise
   * that renders nothing.
   */
  const saveTake = useCallback(
    async (segmentId: SegmentId, samples: Int16Array): Promise<boolean> => {
      const take = startSave(pending, {
        segmentId,
        // Minted here rather than per attempt: IndexedDB `put` is an upsert,
        // so a retry with the same id overwrites the bytes a failed attempt
        // may already have written instead of spending the space twice.
        clipId: newClipId(),
        samples,
      });
      // Identity means refused: a recording is already held, and displacing it
      // is the silent loss all of this exists to prevent. Reaching this is an
      // invariant break — the screens disable recording while a take is held —
      // so it is logged rather than passed over quietly.
      if (take === pending) {
        console.error(
          "A finished take was refused: one is already held",
          pending.clipId
        );
        return false;
      }
      // Before the first await, so there is never a moment when the only
      // reference to a finished take is a local inside a function that can
      // throw.
      setPending(take);
      return commit(take);
    },
    [commit, pending]
  );

  const retryPendingTake = useCallback(() => {
    // The live guard, ahead of the pure one: `pending` here is last render's
    // slot, and `SaveFailed` only hides Retry once the saving re-render lands.
    if (savingRef.current) return;
    const next = retrySave(pending);
    // Identity means refused: nothing held, or a save already in flight.
    if (!next || next === pending) return;
    setPending(next);
    void commit(next);
  }, [commit, pending]);

  /** Deliberate, confirmed loss of the held recording. */
  const discardPendingTake = useCallback(() => {
    // The same live guard Retry takes, and for the same window. `SaveFailed`
    // derives `saving` from the slot it was last rendered with, so between a
    // Retry tap and that re-render the armed Delete is still on screen and
    // still live. Discarding there races the write Retry just started: the
    // clip is deleted out from under a take `addTake` has already made active
    // — a section that reads unrecorded and a play control that does nothing —
    // or the write lands after the discard and a recording the translator
    // confirmed deleting comes back on the next reload. Both are the silent
    // loss this slot exists to prevent, on the one screen whose entire job is
    // to make keep-or-throw a decision.
    if (savingRef.current) return;
    const { next, orphan } = discardSave(pending);
    setPending(next);
    // Nothing references the bytes a failed attempt may already have written,
    // so leaving them would hold exactly the space the save ran out of.
    if (orphan) {
      void deleteClip(orphan).catch((cause: unknown) => {
        console.error("An unsaved clip could not be removed", cause);
      });
    }
  }, [pending]);

  return {
    chapter,
    loading,
    error,
    reload,
    refreshing,
    saveTake,
    pendingTake: pending,
    retryPendingTake,
    discardPendingTake,
  };
}

/**
 * Find or create the local project/chapter/sections mirroring an OBS story.
 *
 * Idempotent for *sequential* calls, which is what opening a story twice does:
 * the second call finds the chapter and returns it, so a translator's
 * recordings cannot silently detach from the sections they belong to.
 *
 * **Not atomic, and not safe against overlapping calls** — issue #8. This is a
 * sequence of separate writes with no transaction around it, so two loads of a
 * never-opened story that interleave can both miss the chapter and both create
 * one, and a run that fails part-way leaves a chapter with fewer sections than
 * the story has frames, which nothing here repairs. Do not read "idempotent"
 * as a concurrency guarantee.
 */
async function ensureObsChapter(
  storyNumber: number,
  frameCount: number
): Promise<ChapterId> {
  const db = await getDb();
  const projects = await listProjects();
  let project = projects.find((p) => p.name === OBS_PROJECT_NAME);
  if (!project) project = await createProject(OBS_PROJECT_NAME, "en");

  const existing = await Promise.all(
    project.chapterIds.map((id) => db.get("chapters", id))
  );
  const found = existing.find((c) => c?.number === storyNumber);
  if (found) return found.id;

  const chapter = await addChapter(project.id as ProjectId, storyNumber);
  for (let frame = 1; frame <= frameCount; frame++) {
    await addSection(chapter.id, {
      book: OBS_BOOK_CODE,
      scope: obsFrameScope(storyNumber, frame),
    });
  }
  return chapter.id;
}

const OBS_PROJECT_NAME = "Open Bible Stories";
