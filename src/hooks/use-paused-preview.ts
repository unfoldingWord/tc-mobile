import { useCallback, useRef, useState } from "react";

import type { UseAudioSession } from "./use-audio-session";
import {
  buildPreview,
  stateAfterAbort,
  type PreparedPreview,
  type PreviewState,
} from "@/lib/takes/paused-preview";

/** Peak resolution for the paused-take preview (#101), matched to the editor's. */
const PREVIEW_PEAK_BUCKETS = 400;

/** The slice of the audio session a preview needs. */
type PreviewAudio = Pick<
  UseAudioSession,
  "previewCapture" | "playBuffer" | "audioNeedsGesture"
>;

export interface UsePausedPreview {
  /** The prepared preview, or null. Null until a paused Play decodes one. */
  readonly preview: PreparedPreview | null;
  /** `"decoding"` while a decode is in flight, `"failed"` when this device could not. */
  readonly previewState: PreviewState;
  /**
   * Replay the prepared preview, or decode and prepare one.
   *
   * `working` and `insertAt` are passed per call rather than held, because both
   * move under the translator's edits and a stale copy would splice the capture
   * into the wrong place.
   */
  requestPreview: (working: Int16Array, insertAt: number) => void;
  /**
   * Invalidate an in-flight decode but KEEP any prepared buffer on stage — the
   * ≡ menu, Back, a #59 interruption.
   */
  abortPreview: () => void;
  /**
   * Discard the preview outright. Only a resume or a new record uses this: the
   * take GROWS, so the next Play must re-decode rather than replay stale audio.
   */
  cancelPreview: () => void;
  /**
   * Drop the prepared PCM, keep its peaks. The stage reads `peaks` and the
   * overlay is inactive while closing, so holding the ~5.3 MB/min `Int16Array`
   * across a commit buys nothing (George R5 #2) — and keeping the peaks is what
   * stops the waveform blanking mid-save.
   */
  dropPreviewPcm: () => void;
  /**
   * Invalidate an in-flight decode WITHOUT touching state — the refs only.
   *
   * The caller's leave-paused effect uses this. It is deliberately not
   * {@link abortPreview}: that one calls `setPreviewState`, and this runs from
   * an effect, where a set-state would be the shape the hooks rules forbid. The
   * leftover `previewState` is inert, because the caller gates Play on it only
   * while paused.
   */
  invalidateDecode: () => void;
}

/**
 * The paused-take preview (#101), lifted out of `recorder.tsx` (#160, L-1).
 *
 * While a take is paused, Play sounds the take-so-far spliced into the working
 * buffer where Back will save it. The component held two `useState`s, three
 * refs, two callbacks, an effect and the decode itself — ten of the
 * responsibilities L-1 counts, for one feature.
 *
 * The RULES are in `lib/takes/paused-preview.ts` and tested there (#160, L-2).
 * What is here is what genuinely needs React and the browser, and it is the
 * half that still has no automated coverage: the epoch, the synchronous
 * in-flight guard, the promise chain and the leave-paused effect. They are
 * described below so a reader does not have to infer them from the code.
 *
 * ── The epoch ──
 *
 * `genRef` is bumped by every transport tap. A decode that resolves after its
 * epoch has moved on drops its result silently: writing `preview` or calling
 * `playBuffer` then would sound stale audio into a live take (Frank + George
 * R1), or leave a preview holding the floor a recording has since claimed. It
 * is checked at every await boundary, including after the synchronous splice,
 * which is not instant on a long take.
 *
 * ── The synchronous guard ──
 *
 * `decodingRef` is written before any await, because a second Play tap can land
 * before the `"decoding"` state commits — and two decodes of a long take is two
 * full PCM buffers on a phone (George R2 #3).
 *
 * ── What is NOT here ──
 *
 * The leave-paused effect. It has to run the caller's own playback stop
 * (`stopPlaybackDroppingPan`), which is derived from refs and callbacks the
 * component owns and which are declared after the derivations that read this
 * hook's `preview`. Pulling it in would mean reordering half the component to
 * satisfy one effect. It stays there and calls {@link
 * UsePausedPreview.invalidateDecode}, which is the part of it this hook owns.
 *
 * ── The promise chain ──
 *
 * `promiseRef` serialises decodes rather than replacing them. A
 * Play → Resume → Play loop leaves the first decode still running (a resume
 * does not abort it), so a fresh promise would let two `decodeToCanonical`
 * passes allocate together (George R5 #1). The caller deliberately does not
 * await this chain on close — that delayed `stop()`'s pagehide-safe
 * capture-steal (George R7 P1).
 */
export function usePausedPreview(audio: PreviewAudio): UsePausedPreview {
  const [preview, setPreview] = useState<PreparedPreview | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState>("none");
  const genRef = useRef(0);
  const decodingRef = useRef(false);
  const promiseRef = useRef<Promise<void> | null>(null);

  const abortPreview = useCallback(() => {
    genRef.current++;
    decodingRef.current = false;
    setPreviewState(stateAfterAbort);
  }, []);

  const cancelPreview = useCallback(() => {
    genRef.current++;
    decodingRef.current = false;
    setPreview(null);
    setPreviewState("none");
  }, []);

  const dropPreviewPcm = useCallback(() => {
    setPreview((p) => (p ? { buffer: new Int16Array(0), peaks: p.peaks } : p));
  }, []);

  const invalidateDecode = useCallback(() => {
    genRef.current++;
    decodingRef.current = false;
  }, []);

  const requestPreview = useCallback(
    (working: Int16Array, insertAt: number) => {
      if (previewState === "decoding" || decodingRef.current) return;
      if (preview) {
        audio.playBuffer(preview.buffer, 0, { preemptPausedMic: true });
        return;
      }
      const gen = genRef.current;
      const previous = promiseRef.current;
      decodingRef.current = true;
      setPreviewState("decoding");
      promiseRef.current = (async () => {
        try {
          // Wait out a prior decode's WORK; its RESULT is dropped by the epoch.
          // One full PCM buffer exists at a time, not two.
          if (previous) await previous;
          if (gen !== genRef.current) return;
          const pcm = await audio.previewCapture();
          if (gen !== genRef.current) return;
          if (pcm === null) {
            // This device could not decode the paused container — chiefly iOS,
            // which writes the moov atom only on stop. Play degrades to disabled
            // with a Notice rather than a false or silent preview.
            setPreviewState("failed");
            return;
          }
          const prepared = buildPreview(
            working,
            pcm,
            insertAt,
            PREVIEW_PEAK_BUCKETS
          );
          // Re-check after the synchronous splice and peaks, which are not
          // instant on a long take: a transport tap can land in that window too.
          if (gen !== genRef.current) return;
          setPreview(prepared);
          setPreviewState("none");
          // Auto-play only if the context is audible NOW. This runs after the
          // decode await, OUTSIDE the Play tap's gesture, so an iOS context left
          // "interrupted" by a route change, Siri or a background DURING the
          // decode would sound a silent preview that looks like it is playing
          // (George R9). When it needs a gesture, the prepared preview stays on
          // stage — Play stays enabled and the waveform shows — so the next tap
          // replays it in-gesture and sounds.
          if (!audio.audioNeedsGesture()) {
            audio.playBuffer(prepared.buffer, 0, { preemptPausedMic: true });
          }
        } catch (cause) {
          // `buildPreview` allocates the whole result and can throw on a
          // low-memory device (the OOM class the save path already guards).
          // Surface it as a failed preview rather than leaving Play stuck on
          // "decoding" (George R1 P5); only when this epoch still owns the state.
          console.error("Could not prepare the take preview", cause);
          if (gen === genRef.current) setPreviewState("failed");
        } finally {
          // Release the synchronous guard only if this decode still owns the
          // epoch; a cancel already cleared it, and a newer decode owns it next.
          if (gen === genRef.current) decodingRef.current = false;
        }
      })();
    },
    [audio, preview, previewState]
  );

  return {
    preview,
    previewState,
    requestPreview,
    abortPreview,
    cancelPreview,
    dropPreviewPcm,
    invalidateDecode,
  };
}
