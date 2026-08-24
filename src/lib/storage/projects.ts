/**
 * Project repository — the Book → Chapter → Section → Segment → Take tree.
 *
 * Ordering is explicit (`chapterIds`, `sectionIds`, `segmentIds` arrays)
 * rather than derived from a sort key, because export is defined as
 * "concatenation of sections" and the order of that concatenation is a
 * decision the user makes, not a property of the data.
 */

import { getDb } from "./db";
import { resolveSegmentAudio } from "./segment-audio";
import type {
  Chapter,
  ChapterId,
  ClipId,
  Project,
  ProjectId,
  RecordingStatus,
  Section,
  SectionId,
  SectionRef,
  Segment,
  SegmentId,
  Take,
  TakeId,
} from "@/types/domain";

const uuid = (): string => crypto.randomUUID();

export async function createProject(
  name: string,
  languageCode: string | null = null,
  now: number = Date.now()
): Promise<Project> {
  const project: Project = {
    id: uuid() as ProjectId,
    name,
    languageCode,
    chapterIds: [],
    createdAt: now,
    updatedAt: now,
  };
  const db = await getDb();
  await db.put("projects", project);
  return project;
}

export async function listProjects(): Promise<Project[]> {
  const db = await getDb();
  return (await db.getAll("projects")).sort(
    (a, b) => b.updatedAt - a.updatedAt
  );
}

export async function addChapter(
  projectId: ProjectId,
  number: number
): Promise<Chapter> {
  const db = await getDb();
  const tx = db.transaction(["projects", "chapters"], "readwrite");
  const project = await tx.objectStore("projects").get(projectId);
  if (!project) throw new Error(`No such project: ${projectId}`);

  const chapter: Chapter = {
    id: uuid() as ChapterId,
    projectId,
    number,
    sectionIds: [],
  };
  await tx.objectStore("chapters").put(chapter);
  await tx.objectStore("projects").put({
    ...project,
    chapterIds: [...project.chapterIds, chapter.id],
    updatedAt: Date.now(),
  });
  await tx.done;
  return chapter;
}

/**
 * Add a section. A section is always created with one segment, so the
 * section-by-section UI can record immediately without the user ever having
 * to understand that segments exist.
 */
export async function addSection(
  chapterId: ChapterId,
  ref: SectionRef,
  label: string | null = null
): Promise<{ section: Section; segment: Segment }> {
  const db = await getDb();
  const tx = db.transaction(["chapters", "sections", "segments"], "readwrite");
  const chapter = await tx.objectStore("chapters").get(chapterId);
  if (!chapter) throw new Error(`No such chapter: ${chapterId}`);

  const sectionId = uuid() as SectionId;
  const segment: Segment = {
    id: uuid() as SegmentId,
    sectionId,
    index: 1,
    takeIds: [],
    activeTakeId: null,
    status: "not-started",
  };
  const section: Section = {
    id: sectionId,
    chapterId,
    ref,
    label,
    segmentIds: [segment.id],
  };

  await tx.objectStore("segments").put(segment);
  await tx.objectStore("sections").put(section);
  await tx.objectStore("chapters").put({
    ...chapter,
    sectionIds: [...chapter.sectionIds, sectionId],
  });
  await tx.done;
  return { section, segment };
}

/**
 * Record a new take against a segment and make it the active one.
 *
 * New takes become active because the overwhelmingly common case is
 * "that wasn't right, try again" — but prior takes are retained, never
 * overwritten, so nothing a translator recorded is destroyed by a retry.
 */
export async function addTake(
  segmentId: SegmentId,
  clipId: ClipId,
  durationMs: number,
  now: number = Date.now()
): Promise<Take> {
  const db = await getDb();
  const tx = db.transaction(["segments", "takes"], "readwrite");
  const segment = await tx.objectStore("segments").get(segmentId);
  if (!segment) throw new Error(`No such segment: ${segmentId}`);

  const take: Take = {
    id: uuid() as TakeId,
    segmentId,
    clipId,
    createdAt: now,
    durationMs,
  };
  await tx.objectStore("takes").put(take);
  await tx.objectStore("segments").put({
    ...segment,
    takeIds: [...segment.takeIds, take.id],
    activeTakeId: take.id,
    // A fresh take demotes an "affirmed" segment back to draft: the audio a
    // reviewer approved is no longer the audio that would be exported.
    status: "draft",
  });
  await tx.done;
  return take;
}

export async function setActiveTake(
  segmentId: SegmentId,
  takeId: TakeId | null
): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("segments", "readwrite");
  const segment = await tx.store.get(segmentId);
  if (!segment) throw new Error(`No such segment: ${segmentId}`);
  if (takeId !== null && !segment.takeIds.includes(takeId)) {
    throw new Error(`Take ${takeId} does not belong to segment ${segmentId}`);
  }
  await tx.store.put({
    ...segment,
    activeTakeId: takeId,
    status: takeId === null ? "not-started" : segment.status,
  });
  await tx.done;
}

/**
 * @pivotpending No caller yet, and deliberately so. B1 (#27) wires this to the
 * per-segment finished checkbox on page 3 of the mockups. The five-value
 * `RecordingStatus` stays in the model beneath a binary UI toggle; Phase 2
 * needs the wider enum.
 */
export async function setSegmentStatus(
  segmentId: SegmentId,
  status: RecordingStatus
): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("segments", "readwrite");
  const segment = await tx.store.get(segmentId);
  if (!segment) throw new Error(`No such segment: ${segmentId}`);
  await tx.store.put({ ...segment, status });
  await tx.done;
}

export async function getChapter(id: ChapterId): Promise<Chapter | undefined> {
  return (await getDb()).get("chapters", id);
}

export async function getSectionsOfChapter(
  chapterId: ChapterId
): Promise<Section[]> {
  const db = await getDb();
  const chapter = await db.get("chapters", chapterId);
  if (!chapter) return [];
  const sections = await Promise.all(
    chapter.sectionIds.map((id) => db.get("sections", id))
  );
  // Preserve the chapter's declared order; drop any dangling ids.
  return sections.filter((s): s is Section => s !== undefined);
}

/**
 * Resolve a chapter to the ordered list of clips that make up its export.
 *
 * Segments with no active take are skipped rather than treated as an error:
 * a partially-recorded chapter should still export the parts that are done.
 * The returned `missing` count lets the UI say so honestly.
 *
 * "Honestly" is why every id here is one `resolveSegmentAudio` has confirmed
 * has both halves of its clip behind it — the metadata row and the samples
 * key. It probes the second rather than reading it, so the check costs a key
 * lookup per segment and not a chapter of PCM.
 *
 * It used to push `take.clipId` on the strength of the take row alone. Once an
 * export path exists (#18), a take whose clip had gone would count as
 * exported: the chapter would read as complete and the segment would be
 * absent from the file. A gap the count admits to is recoverable; one it does
 * not is not.
 */
export async function resolveChapterClipIds(
  chapterId: ChapterId
): Promise<{ clipIds: ClipId[]; missing: number }> {
  const sections = await getSectionsOfChapter(chapterId);
  const clipIds: ClipId[] = [];
  let missing = 0;

  for (const section of sections) {
    for (const segmentId of section.segmentIds) {
      const audio = await resolveSegmentAudio(segmentId);
      if (audio.kind === "resolved") clipIds.push(audio.clip.id);
      else missing++;
    }
  }
  return { clipIds, missing };
}
