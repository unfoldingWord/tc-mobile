import {
  Download,
  Mic,
  Play,
  Scissors,
  Square,
  Trash2,
  Undo2,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { Waveform } from "@/components/waveform";
import { cut } from "@/lib/audio/edit";
import { CANONICAL_SAMPLE_RATE, framesToMs } from "@/lib/audio/format";
import { cn, formatBytes, formatDuration } from "@/lib/utils";
import { playSamples, type PlaybackHandle } from "@/hooks/audio-io";
import { useRecorder } from "@/hooks/use-recorder";

/**
 * Phase-1 vertical slice.
 *
 * This screen exists to prove the pipeline end to end on a real phone —
 * record → canonical PCM → waveform → playback → cut → MP3 export — not to be
 * the shipped UI. Tim has said the interface "needs lots of changes, but I
 * don't know what they are yet," so the durable work is in `lib/` and this is
 * deliberately disposable.
 */
export function App() {
  const recorder = useRecorder();
  const [samples, setSamples] = useState<Int16Array>(new Int16Array(0));
  const [history, setHistory] = useState<Int16Array[]>([]);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [selection, setSelection] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const playbackRef = useRef<PlaybackHandle | null>(null);
  const rafRef = useRef<number | null>(null);

  const hasAudio = samples.length > 0;
  const durationMs = framesToMs(samples.length);

  const commit = useCallback(
    (next: Int16Array) => {
      setHistory((h) => [...h, samples]);
      setSamples(next);
      setSelection(null);
    },
    [samples]
  );

  const stopPlayback = useCallback(() => {
    playbackRef.current?.stop();
    playbackRef.current = null;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setPlayhead(null);
  }, []);

  const handleRecord = async () => {
    if (recorder.state === "recording") {
      const captured = await recorder.stop();
      if (captured && captured.length > 0) commit(captured);
      return;
    }
    stopPlayback();
    await recorder.start();
  };

  const handlePlay = async () => {
    if (playbackRef.current) {
      stopPlayback();
      return;
    }
    if (!hasAudio) return;
    const handle = await playSamples(samples, { onEnded: stopPlayback });
    playbackRef.current = handle;

    const tick = () => {
      const current = playbackRef.current;
      if (!current) return;
      setPlayhead(current.elapsed() / current.duration);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const handleCut = () => {
    if (!selection || !hasAudio) return;
    const { remaining } = cut(samples, {
      start: Math.floor(selection.start * samples.length),
      end: Math.floor(selection.end * samples.length),
    });
    stopPlayback();
    commit(remaining);
  };

  const handleUndo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    stopPlayback();
    setHistory((h) => h.slice(0, -1));
    setSamples(previous);
    setSelection(null);
  };

  const handleClear = () => {
    stopPlayback();
    commit(new Int16Array(0));
  };

  const handleExport = async () => {
    if (!hasAudio) return;
    setBusy("Encoding MP3…");
    try {
      // Loaded on demand: the LAME encoder is ~500 kB, and making first paint
      // wait for it would be paid by every user on every launch to serve the
      // one action that needs it. The service worker still precaches the
      // chunk, so export works offline on the first try.
      const { encodeMp3 } = await import("@/lib/audio/mp3");
      const mp3 = encodeMp3(samples, { sampleRate: CANONICAL_SAMPLE_RATE });
      const blob = new Blob([mp3 as BlobPart], { type: "audio/mpeg" });
      const file = new File([blob], "tc-mobile-take.mp3", {
        type: "audio/mpeg",
      });

      // Share sheet first: on iOS installed to the home screen, an <a download>
      // is inert, and sharing is how a file actually leaves the device.
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
      } else {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = file.name;
        anchor.click();
        URL.revokeObjectURL(url);
      }
    } finally {
      setBusy(null);
    }
  };

  const handleScrub = (fraction: number) => {
    if (!hasAudio) return;
    setSelection((current) =>
      current === null || current.end !== current.start
        ? { start: fraction, end: fraction }
        : {
            start: Math.min(current.start, fraction),
            end: Math.max(current.start, fraction),
          }
    );
  };

  const recording = recorder.state === "recording";

  return (
    <main className="mx-auto flex h-full max-w-md flex-col gap-4 p-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold text-slate-100">tC Mobile</h1>
        <span className="text-xs text-slate-500">
          v{__APP_VERSION__} · scaffold
        </span>
      </header>

      {!recorder.supported && (
        <p className="rounded-lg bg-amber-950/60 p-3 text-sm text-amber-200">
          This browser cannot record audio.
        </p>
      )}
      {recorder.error && (
        <p className="rounded-lg bg-red-950/60 p-3 text-sm text-red-200">
          {recorder.error}
        </p>
      )}

      <Waveform
        samples={samples}
        playhead={playhead}
        selection={
          selection && selection.end > selection.start ? selection : null
        }
        onScrub={handleScrub}
      />

      <div className="flex items-center justify-between text-sm text-slate-400">
        <span>
          {recording
            ? formatDuration(recorder.elapsedMs)
            : formatDuration(durationMs)}
        </span>
        <span>{formatBytes(samples.length * 2)}</span>
      </div>

      <p className="text-xs text-slate-500">
        Tap the waveform once to drop a marker, tap again to close an edit
        window, then cut.
      </p>

      <div className="mt-auto grid grid-cols-4 gap-3">
        <ActionButton
          label="Record"
          onClick={() => void handleRecord()}
          active={recording}
          disabled={!recorder.supported || recorder.state === "processing"}
        >
          {recording ? <Square size={28} /> : <Mic size={28} />}
        </ActionButton>

        <ActionButton
          label="Play"
          onClick={() => void handlePlay()}
          disabled={!hasAudio || recording}
        >
          <Play size={28} />
        </ActionButton>

        <ActionButton
          label="Cut"
          onClick={handleCut}
          disabled={!selection || selection.end <= selection.start || recording}
        >
          <Scissors size={28} />
        </ActionButton>

        <ActionButton
          label="Undo"
          onClick={handleUndo}
          disabled={history.length === 0 || recording}
        >
          <Undo2 size={28} />
        </ActionButton>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <ActionButton
          label="Clear"
          onClick={handleClear}
          disabled={!hasAudio || recording}
        >
          <Trash2 size={24} />
        </ActionButton>
        <ActionButton
          label={busy ?? "Export MP3"}
          onClick={() => void handleExport()}
          disabled={!hasAudio || recording || busy !== null}
        >
          <Download size={24} />
        </ActionButton>
      </div>
    </main>
  );
}

interface ActionButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}

/**
 * Icon-first button. The label is present for screen readers and for us during
 * development; the spec's target user should be able to operate this without
 * reading it.
 */
function ActionButton({
  label,
  onClick,
  disabled,
  active,
  children,
}: ActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        // min-h-20 keeps every target well above the 44px touch minimum, which
        // matters when the device is held one-handed in a field setting.
        "flex min-h-20 flex-col items-center justify-center gap-1 rounded-2xl",
        "bg-slate-800 text-slate-100 transition active:scale-95",
        "disabled:opacity-30",
        active && "bg-red-600"
      )}
    >
      {children}
      <span className="text-[10px] tracking-wide text-slate-400">{label}</span>
    </button>
  );
}
