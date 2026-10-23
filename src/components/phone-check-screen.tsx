import { useRef, useState } from "react";

import { strings } from "@/lib/strings";
import { copyText, type CopyOutcome } from "@/hooks/copy-text";
import {
  usePhoneCheck,
  type PhoneCheckActivity,
  type PhoneCheckState,
} from "@/hooks/use-phone-check";
import {
  DIGIT_SAMPLES,
  SCRIPT_SAMPLES,
  type FontSample,
} from "@/lib/phone-check/font-samples";
import { formatPhoneCheckReport } from "@/lib/phone-check/report";

/**
 * The phone check (#1009, from #1002 §6): a hidden tester screen that measures
 * encode speed, the DSP benchmark's cost (#1433), storage speed and the
 * memory ceiling, and hands back a plain-text report to paste into #974.
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
    case "stopping":
      return strings.phoneCheckRunStopping;
    case "device":
      return strings.phoneCheckRunDevice;
    case "encode":
      return strings.phoneCheckRunEncode;
    case "dsp":
      return strings.phoneCheckRunDsp;
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

function SampleList({ samples }: { samples: readonly FontSample[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {samples.map((s) => (
        <li key={s.id} className="flex flex-col">
          <span className="text-ink-muted text-[13px]">{s.label}</span>
          {/* `lang` and `dir` are the point: they are what makes the phone
              choose this script's own font (#1486). `translate="no"` keeps
              a browser's page translation from rewriting the sample, so the
              tester judges the phone's font, not a translation. */}
          <span
            lang={s.lang}
            dir={s.dir}
            translate="no"
            className="text-ink text-[20px]"
            data-phone-check-sample={s.id}
          >
            {s.text}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A copy's outcome, keyed to the report text that copy wrote. */
interface CopiedReport {
  readonly report: string;
  readonly outcome: CopyOutcome;
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
  const [copied, setCopied] = useState<CopiedReport | null>(null);
  const running = state.activity !== null;
  const report = formatPhoneCheckReport({
    version,
    sha,
    device: state.device,
    encode: state.encode,
    dsp: state.dsp,
    storage: state.storage,
    allocation: state.allocation,
  });
  const status = activityLine(state.activity);
  // "Done" means every ordered step landed, not merely that the first one
  // did (#1014 item 7). A reload mid-run restores whichever steps
  // `readSavedChecks` found and nothing marks the rest `null` again, so
  // checking `state.device` alone read a partial restore as complete.
  const allStepsLanded = Boolean(
    state.device && state.encode && state.dsp && state.storage
  );

  // The report changing under a "Copied." label is stale the moment it
  // happens (#1014 item 8): a tester who copies mid-run, then watches a later
  // step land, would otherwise paste a report the button never actually put
  // on the clipboard. So the outcome is stored WITH the text that copy wrote,
  // and shown only while that text is still the report on screen. That also
  // covers a write that settles after the report has already moved on: its
  // outcome arrives keyed to the old text and is never shown.
  const shownCopy = copied?.report === report ? copied.outcome : null;

  const onCopy = () => {
    const text = report;
    // No `await` before `copyText` reaches `writeText`: the tap's activation
    // is what the Clipboard API needs (see `hooks/copy-text.ts`).
    void copyText(text, navigator.clipboard, () => {
      reportRef.current?.focus();
      reportRef.current?.select();
    }).then((outcome) => setCopied({ report: text, outcome }));
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

      <p
        className="text-ink-muted text-[13px]"
        role="status"
        data-phone-check="status"
      >
        {status ?? (allStepsLanded ? strings.phoneCheckDone : "")}
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

      <div
        className="border-edge flex flex-col gap-2 rounded-2xl border p-3"
        data-phone-check="fonts"
      >
        <h2 className="text-ink">{strings.phoneCheckFontTitle}</h2>
        <p
          className="text-ink-muted text-[13px]"
          data-phone-check="fonts-intro"
        >
          {strings.phoneCheckFontIntro}
        </p>
        <SampleList samples={SCRIPT_SAMPLES} />
        <h3 className="text-ink">{strings.phoneCheckDigitsTitle}</h3>
        <p
          className="text-ink-muted text-[13px]"
          data-phone-check="digits-note"
        >
          {strings.phoneCheckDigitsNote}
        </p>
        <SampleList samples={DIGIT_SAMPLES} />
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
      <p
        className="text-ink-muted text-[13px]"
        role="status"
        data-phone-check="copy-status"
      >
        {shownCopy === "copied"
          ? strings.phoneCheckCopied
          : shownCopy === "selected"
            ? strings.phoneCheckSelected
            : ""}
      </p>
    </section>
  );
}
