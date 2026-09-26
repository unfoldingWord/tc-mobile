import { useRef, useState } from "react";

import { strings } from "@/lib/strings";
import { copyText, type CopyOutcome } from "@/hooks/copy-text";
import {
  usePhoneCheck,
  type PhoneCheckActivity,
  type PhoneCheckState,
} from "@/hooks/use-phone-check";
import { formatPhoneCheckReport } from "@/lib/phone-check/report";

/**
 * The phone check (#1009, from #1002 §6): a hidden tester screen that measures
 * encode speed, storage speed and the memory ceiling, and hands back a
 * plain-text report to paste into #974.
 *
 * Reached by five taps on the build stamp (`components/build-stamp.tsx`, the
 * only way in on an APK, where there is no address bar) or by `?check=phone`
 * (`app/App.tsx`). It replaces the app's screens while open, the way the
 * recovery screens do, and `App` only opens it from Books with nothing held,
 * so no take or playback can be under it.
 *
 * Nothing runs until a Start is tapped. The memory ceiling has its own Start,
 * below a warning, because it can make the app restart.
 */
export function PhoneCheckScreen({ onClose }: { onClose: () => void }) {
  const { state, runChecks, runMemory } = usePhoneCheck();
  return (
    <PhoneCheckView
      state={state}
      version={__APP_VERSION__}
      sha={__BUILD_SHA__}
      onStart={runChecks}
      onStartMemory={runMemory}
      onClose={onClose}
    />
  );
}

function activityLine(activity: PhoneCheckActivity): string | null {
  if (activity === null) return null;
  switch (activity.kind) {
    case "waiting":
      return strings.phoneCheckRunWaiting;
    case "device":
      return strings.phoneCheckRunDevice;
    case "encode":
      return strings.phoneCheckRunEncode;
    case "storage":
      return strings.phoneCheckRunStorage;
    case "memory":
      return strings.phoneCheckMemoryStep(activity.mb);
    default: {
      const never: never = activity;
      return never;
    }
  }
}

const BUTTON =
  "rounded-full bg-raised px-4 py-2 text-ink disabled:opacity-50 min-h-11";

export interface PhoneCheckViewProps {
  state: PhoneCheckState;
  version: string;
  sha: string;
  onStart: () => void;
  onStartMemory: () => void;
  onClose: () => void;
}

/** The screen itself, from props — what the render tests read. */
export function PhoneCheckView({
  state,
  version,
  sha,
  onStart,
  onStartMemory,
  onClose,
}: PhoneCheckViewProps) {
  const reportRef = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState<CopyOutcome | null>(null);
  const running = state.activity !== null;
  const report = formatPhoneCheckReport({
    version,
    sha,
    device: state.device,
    encode: state.encode,
    storage: state.storage,
    allocation: state.allocation,
  });
  const status = activityLine(state.activity);

  const onCopy = () => {
    // No `await` before `copyText` reaches `writeText`: the tap's activation
    // is what the Clipboard API needs (see `hooks/copy-text.ts`).
    void copyText(report, navigator.clipboard, () => {
      reportRef.current?.focus();
      reportRef.current?.select();
    }).then(setCopied);
  };

  return (
    <section
      className="text-ink flex min-h-full flex-col gap-4 px-4 py-4"
      aria-labelledby="phone-check-title"
    >
      <header className="flex items-center justify-between gap-2">
        <h1 id="phone-check-title" className="t-title">
          {strings.phoneCheckTitle}
        </h1>
        {/* Disabled while a probe runs: the probes cannot be cancelled, and
            closing would put Books back on screen while the memory ceiling
            keeps allocating or the encode keeps the encoder lane. */}
        <button
          type="button"
          className={BUTTON}
          onClick={onClose}
          disabled={running}
          data-phone-check="close"
        >
          {strings.phoneCheckClose}
        </button>
      </header>
      <p className="text-ink-muted text-[13px]">{strings.phoneCheckIntro}</p>

      <button
        type="button"
        className={BUTTON}
        onClick={onStart}
        disabled={running}
        data-phone-check="start"
      >
        {strings.phoneCheckStart}
      </button>

      <p className="text-ink-muted text-[13px]" role="status">
        {status ?? (state.device ? strings.phoneCheckDone : "")}
      </p>

      <div className="border-edge flex flex-col gap-2 rounded-2xl border p-3">
        <h2 className="text-ink">{strings.phoneCheckMemoryTitle}</h2>
        <p
          className="text-warn-text text-[13px]"
          id="phone-check-memory-warning"
        >
          {strings.phoneCheckMemoryWarning}
        </p>
        <button
          type="button"
          className={BUTTON}
          onClick={onStartMemory}
          disabled={running}
          aria-describedby="phone-check-memory-warning"
          data-phone-check="memory"
        >
          {strings.phoneCheckMemoryStart}
        </button>
      </div>

      <label className="flex flex-col gap-2">
        <span>{strings.phoneCheckReportLabel}</span>
        <textarea
          ref={reportRef}
          readOnly
          value={report}
          rows={16}
          className="border-edge bg-surface text-ink w-full rounded-xl border p-2 font-mono text-[12px]"
          data-phone-check="report"
        />
      </label>
      <button
        type="button"
        className={BUTTON}
        onClick={onCopy}
        data-phone-check="copy"
      >
        {strings.phoneCheckCopy}
      </button>
      <p className="text-ink-muted text-[13px]" role="status">
        {copied === "copied"
          ? strings.phoneCheckCopied
          : copied === "selected"
            ? strings.phoneCheckSelected
            : ""}
      </p>
    </section>
  );
}
