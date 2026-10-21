import { vi } from "vitest";

import { CHAPTER_IDLE } from "@/hooks/chapter-player";
import type { ChapterAudio } from "@/hooks/use-audio-session";

/**
 * A `ChapterAudio` for a test that mounts `BooksScreen` and does not care
 * about chapter play: idle, every call a spy, no progress to read. A test
 * that does care passes `overrides`.
 */
export function idleChapterAudio(
  overrides: Partial<ChapterAudio> = {}
): ChapterAudio {
  return {
    chapterPlay: CHAPTER_IDLE,
    playChapter: vi.fn(),
    pauseChapter: vi.fn(),
    stopChapter: vi.fn(),
    readChapterProgress: () => null,
    ...overrides,
  };
}
