import { useCallback, useEffect, useState } from "react";

import { Control } from "@/components/control";
import { Notice } from "@/components/notice";
import { SaveFailed } from "@/components/save-failed";
import { SectionBrowser } from "@/components/section-browser";
import { SectionView } from "@/components/section-view";
import { useAudioSession } from "@/hooks/use-audio-session";
import { useObsChapter } from "@/hooks/use-chapter";
import { firstUnrecorded, recordedCount } from "@/types/view";
import type { SectionCard } from "@/types/view";

/**
 * Phase-1 prototype.
 *
 * Story picker → section browser → section view. The browser's layout and tap
 * behaviour both follow one rule: a chapter with artwork is browsed by
 * picture, a chapter without one is browsed by sound.
 *
 * This screen holds no audio of its own any more. Every sound belongs to
 * `useAudioSession`, and every screen change goes through `navigate`, so
 * "leaving ends what was sounding" is one call in one place instead of a pair
 * of stop calls that each new handler had to remember.
 */
export function App() {
  const [storyNumber, setStoryNumber] = useState(1);
  const [openSectionId, setOpenSectionId] = useState<string | null>(null);

  const {
    chapter,
    loading,
    error,
    refreshing,
    saveTake,
    pendingTake,
    retryPendingTake,
    discardPendingTake,
  } = useObsChapter(storyNumber);
  const audio = useAudioSession();
  const {
    leave,
    playTake,
    startRecording: beginRecording,
    stopRecording: endRecording,
  } = audio;

  const navigate = useCallback(
    (to: { story?: number; sectionId?: string | null }) => {
      // Every navigation ends whatever this screen was sounding, in the same
      // task as the tap.
      leave();
      if (to.story !== undefined) {
        setStoryNumber(to.story);
        // A section id belongs to a chapter, so a story change closes the open
        // section by construction rather than by a lookup that happens to miss.
        setOpenSectionId(null);
      }
      if (to.sectionId !== undefined) setOpenSectionId(to.sectionId);
    },
    [leave]
  );

  const startRecording = useCallback(() => {
    // One unsaved take at a time. A second would displace the first in the
    // pending slot, which is the silent loss all of this exists to prevent.
    // The screens disable the record control and say why while a take is held
    // (`saving` below), so this is the backstop, not the message: a refusal
    // nobody is told about is the defect `Notice` exists for.
    if (pendingTake || refreshing) return;
    beginRecording();
  }, [beginRecording, pendingTake, refreshing]);

  const stopRecording = useCallback(
    (section: SectionCard) => {
      void (async () => {
        const samples = await endRecording();
        // `saveTake` takes hold of the samples before its first await and never
        // rejects, so there is no window in which the only reference to a
        // finished take is a local that an exception can discard.
        if (samples && samples.length > 0)
          await saveTake(section.segmentId, samples);
      })().catch((cause: unknown) => {
        // Neither call rejects by contract. This is the last net under the one
        // path where a failure costs a recording that cannot be made again.
        console.error("Finishing a recording failed", cause);
      });
    },
    [endRecording, saveTake]
  );

  const openSection =
    chapter?.sections.find((s) => s.sectionId === openSectionId) ?? null;

  // The takeover waits for the first failure — the ordinary save is fast, and
  // flashing a full-screen "Saving" after every take would be its own defect.
  // Until then the section view says so and disables the record control.
  const recovery = pendingTake && pendingTake.attempts > 0 ? pendingTake : null;
  const recovering = recovery !== null;

  useEffect(() => {
    // The recovery screen offers two buttons, and neither of them can stop a
    // sound. A take still playing when it takes over would go on under an
    // `aria-modal` screen with no control able to reach it, so the takeover
    // leaves the same way every tap does.
    if (recovering) leave();
  }, [recovering, leave]);

  // An open section id that no longer names a section of the chapter on screen:
  // the section view is about to be torn down by something that was not a tap.
  // The microphone may be open behind it, and `leave()` is only wired to
  // `navigate`, so this render would otherwise fall through to the browser with
  // a recording still running and no Stop control anywhere on screen.
  //
  // The id itself is left alone: `openSection` is derived from the chapter, so
  // a stale id shows nothing, and clearing it here would be a second render
  // chasing the first.
  // Every way the section view can disappear without a tap. `openSection ===
  // null` is the stale-id case; `error` and a missing chapter are the reload
  // failures below, which replace the whole tree with a splash that has no
  // Stop control. Requiring `chapter !== null` here would exclude exactly the
  // dead-end case: a rejected reload leaves the microphone recording behind an
  // error screen the translator cannot get out of.
  const leavingSection =
    openSectionId !== null &&
    (openSection === null || error !== null || chapter === null);

  useEffect(() => {
    if (leavingSection) leave();
  }, [leavingSection, leave]);

  // Ahead of the loading / error returns below: a chapter that fails to reload
  // must never replace the screen that is holding an unsaved recording.
  if (recovery) {
    return (
      <main className="app-shell grid h-full place-items-center">
        <SaveFailed
          state={recovery.state}
          kind={recovery.kind}
          ordinal={
            chapter?.sections.find((s) => s.segmentId === recovery.segmentId)
              ?.ordinal ?? null
          }
          attempts={recovery.attempts}
          onRetry={retryPendingTake}
          onDiscard={discardPendingTake}
        />
      </main>
    );
  }

  if (loading && !chapter) return <Splash message="Loading" />;
  if (error) return <Splash message={error} tone="error" />;
  if (!chapter) return <Splash message="No chapter" />;

  const next = firstUnrecorded(chapter);
  const done = recordedCount(chapter);

  // A save is not over when the slot clears — the card still reads as
  // unrecorded until the reload lands. Holding the controls until then is what
  // stops a second take being recorded over a good one.
  const saving = pendingTake !== null || refreshing;
  // The notice is global, so it says which section it means: stepping to
  // another section while the first is still writing otherwise reads as though
  // the section on screen were the one being saved.
  const savingOrdinal =
    chapter.sections.find((s) => s.segmentId === pendingTake?.segmentId)
      ?.ordinal ?? null;

  if (openSection) {
    const i = chapter.sections.indexOf(openSection);
    const step = (delta: number) => () =>
      navigate({ sectionId: chapter.sections[i + delta]?.sectionId ?? null });
    return (
      <main className="app-shell mx-auto h-full max-w-md">
        <SectionView
          chapter={chapter}
          section={openSection}
          recorderState={audio.recorderState}
          elapsedMs={audio.elapsedMs}
          playing={audio.playingId === openSection.sectionId}
          supported={audio.supported}
          saving={saving}
          savingOrdinal={savingOrdinal}
          error={audio.error}
          onBack={() => navigate({ sectionId: null })}
          onPrev={i > 0 ? step(-1) : null}
          onNext={i < chapter.sections.length - 1 ? step(1) : null}
          onRecord={startRecording}
          onStop={() => stopRecording(openSection)}
          onPlay={() => playTake(openSection)}
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
          onClick={() => navigate({ story: Math.max(1, storyNumber - 1) })}
        />
        <span className="t-title flex-1 text-center">{chapter.ordinal}</span>
        <Control
          icon="next"
          label="Next story"
          variant="quiet"
          disabled={storyNumber >= 50}
          onClick={() => navigate({ story: Math.min(50, storyNumber + 1) })}
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

      {/* One line, one place — the same rule the section view follows. */}
      {audio.error ? (
        <Notice>{audio.error}</Notice>
      ) : saving ? (
        <Notice tone="busy">
          {savingOrdinal === null
            ? "Saving your recording."
            : `Saving section ${savingOrdinal}.`}
        </Notice>
      ) : (
        // Last, deliberately. A save in flight disables Record, and a refusal
        // the screen does not explain is the defect `Notice` exists for — so
        // the busy line owns the slot while it is running, including during
        // the re-record this count exists to prompt. The count is a standing
        // condition; it can wait for the control to come back.
        chapter.audioFaults > 0 && (
          <Notice>
            {chapter.audioFaults === 1
              ? "One section is missing its recording. Record it again."
              : `${chapter.audioFaults} sections are missing their recordings. Record them again.`}
          </Notice>
        )
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <SectionBrowser
          chapter={chapter}
          nextSectionId={next?.sectionId ?? null}
          playingSectionId={audio.playingId}
          onOpen={(s) => {
            // Same refusal as the quick action below. Entering lands the
            // translator on a section whose record control does nothing, with
            // no explanation there; the Notice on this screen is already
            // giving one.
            if (saving) return;
            navigate({ sectionId: s.sectionId });
          }}
          onQuickAction={(s) => {
            if (s.durationMs === null) {
              // A take is still being written, or the card has not caught up
              // with one that just was, so recording is refused. Opening the
              // section anyway would strand the translator on a screen whose
              // record control does nothing; the Notice on this screen is
              // already saying why. `saving`, not `pendingTake`: during the
              // reload the slot is empty and this section still reads as
              // unrecorded, which is the window a second take is lost in.
              if (saving) return;
              navigate({ sectionId: s.sectionId });
              // Still nothing awaited before the microphone is asked for: iOS
              // spends the user activation on the first await.
              startRecording();
            } else {
              playTake(s);
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
