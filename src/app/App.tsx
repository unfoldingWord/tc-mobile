import { useCallback, useEffect, useRef, useState } from "react";

import { Control } from "@/components/control";
import { SectionBrowser } from "@/components/section-browser";
import { SectionView } from "@/components/section-view";
import { playSamples, type PlaybackHandle } from "@/hooks/audio-io";
import { useObsChapter } from "@/hooks/use-chapter";
import { useRecorder } from "@/hooks/use-recorder";
import { getClip } from "@/lib/storage/clips";
import { getDb } from "@/lib/storage/db";
import { firstUnrecorded, recordedCount } from "@/types/view";
import type { SectionCard } from "@/types/view";

/**
 * Phase-1 prototype.
 *
 * Story picker → section browser → section view. The browser's layout and tap
 * behaviour both follow one rule: a chapter with artwork is browsed by
 * picture, a chapter without one is browsed by sound.
 */
export function App() {
  const [storyNumber, setStoryNumber] = useState(1);
  const [openSectionId, setOpenSectionId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [referencePlaying, setReferencePlaying] = useState(false);

  const { chapter, loading, error, saveTake } = useObsChapter(storyNumber);
  const recorder = useRecorder();

  const playbackRef = useRef<PlaybackHandle | null>(null);
  const referenceRef = useRef<HTMLAudioElement | null>(null);

  const stopPlayback = useCallback(() => {
    playbackRef.current?.stop();
    playbackRef.current = null;
    setPlayingId(null);
  }, []);

  const stopReference = useCallback(() => {
    referenceRef.current?.pause();
    setReferencePlaying(false);
  }, []);

  useEffect(
    () => () => {
      playbackRef.current?.stop();
      referenceRef.current?.pause();
    },
    []
  );

  const playSection = useCallback(
    async (section: SectionCard) => {
      stopReference();
      if (playingId === section.sectionId) {
        stopPlayback();
        return;
      }
      stopPlayback();

      const db = await getDb();
      const segment = await db.get("segments", section.segmentId);
      if (!segment?.activeTakeId) return;
      const take = await db.get("takes", segment.activeTakeId);
      const clip = take ? await getClip(take.clipId) : undefined;
      if (!clip) return;

      setPlayingId(section.sectionId);
      playbackRef.current = await playSamples(clip.samples, {
        onEnded: stopPlayback,
      });
    },
    [playingId, stopPlayback, stopReference]
  );

  const startRecording = useCallback(async () => {
    stopPlayback();
    stopReference();
    await recorder.start();
  }, [recorder, stopPlayback, stopReference]);

  const stopRecording = useCallback(
    async (section: SectionCard) => {
      const samples = await recorder.stop();
      if (samples && samples.length > 0)
        await saveTake(section.segmentId, samples);
    },
    [recorder, saveTake]
  );

  const toggleReference = useCallback(() => {
    if (!chapter?.referenceAudioUrl) return;
    stopPlayback();
    referenceRef.current ??= new Audio();
    const el = referenceRef.current;
    if (referencePlaying) {
      el.pause();
      setReferencePlaying(false);
      return;
    }
    if (el.src !== chapter.referenceAudioUrl)
      el.src = chapter.referenceAudioUrl;
    el.onended = () => setReferencePlaying(false);
    void el
      .play()
      .then(() => setReferencePlaying(true))
      .catch(() => setReferencePlaying(false));
  }, [chapter, referencePlaying, stopPlayback]);

  if (loading && !chapter) return <Splash message="Loading" />;
  if (error) return <Splash message={error} tone="error" />;
  if (!chapter) return <Splash message="No chapter" />;

  const openSection =
    chapter.sections.find((s) => s.sectionId === openSectionId) ?? null;
  const next = firstUnrecorded(chapter);
  const done = recordedCount(chapter);

  if (openSection) {
    const i = chapter.sections.indexOf(openSection);
    const step = (delta: number) => () => {
      stopPlayback();
      stopReference();
      setOpenSectionId(chapter.sections[i + delta]?.sectionId ?? null);
    };
    return (
      <main className="app-shell mx-auto h-full max-w-md">
        <SectionView
          chapter={chapter}
          section={openSection}
          recording={recorder.state === "recording"}
          elapsedMs={recorder.elapsedMs}
          playing={playingId === openSection.sectionId}
          referencePlaying={referencePlaying}
          onBack={() => {
            stopPlayback();
            stopReference();
            setOpenSectionId(null);
          }}
          onPrev={i > 0 ? step(-1) : null}
          onNext={i < chapter.sections.length - 1 ? step(1) : null}
          onRecord={() => void startRecording()}
          onStop={() => void stopRecording(openSection)}
          onPlay={() => void playSection(openSection)}
          onToggleReference={toggleReference}
        />
      </main>
    );
  }

  return (
    <main className="app-shell mx-auto h-full max-w-md">
      <div className="flex items-center gap-[14px] px-[4px] py-[2px]">
        <Control
          icon="prev"
          label="Previous story"
          variant="quiet"
          disabled={storyNumber <= 1}
          onClick={() => setStoryNumber((n) => Math.max(1, n - 1))}
        />
        <span className="t-title flex-1 text-center">{chapter.ordinal}</span>
        <Control
          icon="next"
          label="Next story"
          variant="quiet"
          disabled={storyNumber >= 50}
          onClick={() => setStoryNumber((n) => Math.min(50, n + 1))}
        />
      </div>

      <div className="flex items-center gap-[10px] px-[6px]">
        <span
          className="h-[5px] flex-1 overflow-hidden rounded-[3px]"
          style={{ background: "var(--s-raised)" }}
          role="progressbar"
          aria-valuenow={done}
          aria-valuemin={0}
          aria-valuemax={chapter.sections.length}
          aria-label={`${done} of ${chapter.sections.length} sections recorded`}
        >
          <span
            className="block h-full rounded-[3px]"
            style={{
              width: `${(done / chapter.sections.length) * 100}%`,
              background: "var(--s-voice)",
            }}
          />
        </span>
        <span className="t-count">
          {done} / {chapter.sections.length}
        </span>
      </div>

      {recorder.error && (
        <p
          className="rounded-[10px] p-[12px] text-[13px]"
          style={{ background: "var(--p-red-950)", color: "var(--p-red-100)" }}
        >
          {recorder.error}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <SectionBrowser
          chapter={chapter}
          nextSectionId={next?.sectionId ?? null}
          playingSectionId={playingId}
          onOpen={(s) => {
            stopPlayback();
            setOpenSectionId(s.sectionId);
          }}
          onQuickAction={(s) => {
            if (s.durationMs === null) {
              setOpenSectionId(s.sectionId);
              void startRecording();
            } else {
              void playSection(s);
            }
          }}
        />
      </div>
    </main>
  );
}

function Splash({ message, tone }: { message: string; tone?: "error" }) {
  return (
    <main className="app-shell grid h-full place-items-center">
      <p
        className="text-[13px]"
        style={{
          color: tone === "error" ? "var(--s-live)" : "var(--s-ink-muted)",
        }}
      >
        {message}
      </p>
    </main>
  );
}
