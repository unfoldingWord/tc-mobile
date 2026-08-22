import { useCallback, useEffect, useState } from "react";

import { computePeaks } from "@/lib/audio/peaks";
import { getStory, obsFrameScope, OBS_BOOK_CODE, thumbUrl } from "@/lib/obs";
import { getClip, newClipId, putClip } from "@/lib/storage/clips";
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
import { narrationUrl } from "./obs-media";
import type {
  ChapterId,
  ProjectId,
  SectionId,
  SegmentId,
} from "@/types/domain";
import type { ChapterCard, SectionCard } from "@/types/view";

const PEAK_BUCKETS = 120;

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
 * Load an OBS story as a working chapter, creating it on first open.
 *
 * The catalogue supplies the shape (frames, artwork, order); IndexedDB supplies
 * whatever has been recorded against it. Peaks are computed once during load
 * rather than in the row, so scrolling never walks raw samples.
 */
export function useObsChapter(storyNumber: number) {
  const [chapter, setChapter] = useState<ChapterCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const card = await loadObsChapterCard(storyNumber);
        // Guards a story change or unmount landing after a slow read.
        if (cancelled) return;
        setChapter(card);
        setError(null);
      } catch (cause) {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [storyNumber, reloadToken]);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  /** Persist a recording against a section and refresh the chapter. */
  const saveTake = useCallback(
    async (segmentId: SegmentId, samples: Int16Array) => {
      const clipId = newClipId();
      const meta = await putClip(clipId, samples, CANONICAL_SAMPLE_RATE);
      await addTake(segmentId, clipId, meta.durationMs);
      reload();
    },
    [reload]
  );

  return { chapter, loading, error, reload, saveTake };
}

/**
 * Find or create the local project/chapter/sections mirroring an OBS story.
 *
 * Idempotent: opening story 1 twice must not create two chapters, or a
 * translator's recordings would silently detach from the sections they belong
 * to.
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

export const OBS_PROJECT_NAME = "Open Bible Stories";

export type { SectionId };
