/**
 * The phone check's result shapes and the plain-text report built from them
 * (#1009, from #1002 §6).
 *
 * The report is pasted by a tester into the device-checks issue (#974), so it
 * is English engineering data addressed to whoever reads that issue, not copy
 * for the translator holding the phone. That is why its labels live here beside
 * the formatter and not in `lib/strings.ts`, the same line
 * `tests/strings-one-table.test.ts` draws for `lib/`'s own `Error` messages.
 *
 * A failed probe carries the error's `name` only (`RangeError`,
 * `QuotaExceededError`, `EncoderStalledError`), never its message: #172 keeps
 * raw browser exception text off the screen, and the full cause already goes
 * to the failure log through `reportFailure`, which the tester can send.
 *
 * Pure: no DOM, no clock. The browser-side probes that fill these shapes are in
 * `hooks/phone-check-probes.ts`.
 */

/** One mebibyte. Every "MB" this check prints is this unit. */
export const MB = 1024 * 1024;

/** A probe that ran: its value, or the name of what stopped it. */
export type ProbeOutcome<T> =
  | { readonly status: "ok"; readonly value: T }
  | { readonly status: "failed"; readonly errorName: string };

/** What the phone says about itself. `null` means the browser did not say. */
export interface DeviceInfo {
  readonly userAgent: string;
  /** `navigator.deviceMemory`, in GB (Chromium rounds it; Safari omits it). */
  readonly deviceMemoryGb: number | null;
  /** `navigator.hardwareConcurrency`. */
  readonly cores: number | null;
  /** `navigator.storage.estimate()` — bytes. */
  readonly quotaBytes: number | null;
  readonly usageBytes: number | null;
  /** `navigator.storage.persisted()`. */
  readonly persisted: boolean | null;
}

/** One encode of synthetic speech through the real MP3 worker. */
export interface EncodeResult {
  readonly audioSeconds: number;
  readonly wallMs: number;
  readonly mp3Bytes: number;
}

/** One write-then-read of PCM through a throwaway IndexedDB database. */
export interface StorageResult {
  readonly bytes: number;
  readonly writeMs: number;
  readonly readMs: number;
}

/**
 * How the allocation ceiling ended.
 *
 * `lastOkMb` is always the last TOTAL that was allocated and survived — the
 * number #1009 asks for. `reloaded` is the case where the page itself went
 * away mid-step, recovered from the `sessionStorage` breadcrumb on the next
 * visit (see `allocation.ts`).
 */
export type AllocationResult =
  | { readonly kind: "completed"; readonly lastOkMb: number }
  | {
      readonly kind: "failed";
      readonly lastOkMb: number;
      readonly failedAtMb: number;
      readonly errorName: string;
    }
  | {
      readonly kind: "reloaded";
      readonly lastOkMb: number;
      readonly attemptingMb: number;
    };

/** Everything the report needs. `null` for a probe means it was not run. */
export interface PhoneCheckReportInput {
  readonly version: string;
  readonly sha: string;
  readonly device: ProbeOutcome<DeviceInfo> | null;
  readonly encode: ProbeOutcome<EncodeResult> | null;
  readonly storage: ProbeOutcome<StorageResult> | null;
  readonly allocation: AllocationResult | null;
}

/** Bytes as MB with one decimal: `52428800` → `"50.0 MB"`. */
export function formatMb(bytes: number): string {
  return `${(bytes / MB).toFixed(1)} MB`;
}

/**
 * Bytes over milliseconds as MB/s with one decimal. A zero or negative
 * duration has no rate — a clock that did not move is not "infinitely fast".
 */
export function formatRate(bytes: number, ms: number): string {
  if (!(ms > 0)) return "n/a";
  return `${(bytes / MB / (ms / 1000)).toFixed(1)} MB/s`;
}

/** Seconds with one decimal: `12345` → `"12.3 s"`. */
function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

/**
 * How many seconds of audio the encoder gets through per second of wall time.
 * `null` when the wall time is not positive, for the same reason as
 * {@link formatRate}.
 */
export function realtimeFactor(
  audioSeconds: number,
  wallMs: number
): number | null {
  if (!(wallMs > 0)) return null;
  return audioSeconds / (wallMs / 1000);
}

const NOT_RUN = "not run";
const UNKNOWN = "not reported";

function orUnknown<T>(value: T | null, show: (v: T) => string): string {
  return value === null ? UNKNOWN : show(value);
}

function deviceLines(device: ProbeOutcome<DeviceInfo> | null): string[] {
  if (device === null) return [`- ${NOT_RUN}`];
  if (device.status === "failed") return [`- failed: ${device.errorName}`];
  const d = device.value;
  const storage =
    d.quotaBytes === null && d.usageBytes === null
      ? UNKNOWN
      : `${orUnknown(d.usageBytes, formatMb)} used of ${orUnknown(d.quotaBytes, formatMb)} quota`;
  return [
    `- User agent: ${d.userAgent || UNKNOWN}`,
    `- Device memory: ${orUnknown(d.deviceMemoryGb, (gb) => `${gb} GB`)}`,
    `- CPU cores: ${orUnknown(d.cores, String)}`,
    `- Storage: ${storage}`,
    `- Persisted: ${orUnknown(d.persisted, (p) => (p ? "yes" : "no"))}`,
  ];
}

function encodeLines(encode: ProbeOutcome<EncodeResult> | null): string[] {
  if (encode === null) return [`- ${NOT_RUN}`];
  if (encode.status === "failed") return [`- failed: ${encode.errorName}`];
  const e = encode.value;
  const factor = realtimeFactor(e.audioSeconds, e.wallMs);
  return [
    `- Audio: ${formatSeconds(e.audioSeconds * 1000)} of synthetic speech`,
    `- Wall time: ${formatSeconds(e.wallMs)}`,
    `- Speed: ${factor === null ? "n/a" : `${factor.toFixed(1)}x realtime`}`,
    `- MP3 size: ${formatMb(e.mp3Bytes)}`,
  ];
}

function storageLines(storage: ProbeOutcome<StorageResult> | null): string[] {
  if (storage === null) return [`- ${NOT_RUN}`];
  if (storage.status === "failed") return [`- failed: ${storage.errorName}`];
  const s = storage.value;
  return [
    `- Write: ${formatMb(s.bytes)} in ${formatSeconds(s.writeMs)} (${formatRate(s.bytes, s.writeMs)})`,
    `- Read: ${formatMb(s.bytes)} in ${formatSeconds(s.readMs)} (${formatRate(s.bytes, s.readMs)})`,
  ];
}

function allocationLines(allocation: AllocationResult | null): string[] {
  if (allocation === null) return [`- ${NOT_RUN}`];
  switch (allocation.kind) {
    case "completed":
      return [`- Reached ${allocation.lastOkMb} MB (every step succeeded)`];
    case "failed":
      return [
        `- Last succeeded: ${allocation.lastOkMb} MB`,
        `- Failed at ${allocation.failedAtMb} MB: ${allocation.errorName}`,
      ];
    case "reloaded":
      return [
        `- Last succeeded: ${allocation.lastOkMb} MB`,
        `- The page reloaded while trying ${allocation.attemptingMb} MB`,
      ];
    default: {
      const never: never = allocation;
      return never;
    }
  }
}

/**
 * The report a tester pastes into #974, as plain text.
 *
 * Opens with the two lines #974's "How to report" asks every comment to carry
 * and the check cannot know — who you are by role, and the device — left for
 * the tester to fill in, then the build, then one section per probe in the
 * order they run. A probe that was not run says so rather than being left out,
 * so a pasted report always has the same shape.
 */
export function formatPhoneCheckReport(input: PhoneCheckReportInput): string {
  const lines = [
    `**Phone check** (#1009) — build v${input.version} · ${input.sha}`,
    "Tester (role): ",
    "Device and OS version: ",
    "",
    "Device info",
    ...deviceLines(input.device),
    "",
    "Encode (real MP3 worker)",
    ...encodeLines(input.encode),
    "",
    "Storage (throwaway database, deleted afterwards)",
    ...storageLines(input.storage),
    "",
    "Memory ceiling",
    ...allocationLines(input.allocation),
  ];
  return lines.join("\n");
}
