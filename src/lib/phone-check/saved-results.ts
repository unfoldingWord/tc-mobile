/**
 * The phone check's steps 1-3 results, kept where a reload cannot lose them
 * (#1009).
 *
 * The memory ceiling runs last and, on a small phone, ends with the page
 * reloading. Without this, the report the tester copies afterwards holds only
 * the ceiling's breadcrumb and says "not run" for device, encode and storage.
 * So the hook saves these three results as each one lands, and reads them back
 * on the next open.
 *
 * Pure: the store is `hooks/phone-check-probes.ts`'s. Parsing never throws —
 * it runs on the screen's first render — and a section that is not the shape
 * this version writes is dropped on its own, not with the others.
 */
import type {
  DeviceInfo,
  EncodeResult,
  ProbeOutcome,
  StorageResult,
} from "./report";

export interface SavedChecks {
  readonly device: ProbeOutcome<DeviceInfo> | null;
  readonly encode: ProbeOutcome<EncodeResult> | null;
  readonly storage: ProbeOutcome<StorageResult> | null;
}

export function serializeSavedChecks(checks: SavedChecks): string {
  return JSON.stringify(checks);
}

type Fields = Record<string, unknown>;

function isFields(value: unknown): value is Fields {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function isNumberOrNull(n: unknown): n is number | null {
  return n === null || isFiniteNumber(n);
}

function isDeviceInfo(v: unknown): v is DeviceInfo {
  return (
    isFields(v) &&
    typeof v.userAgent === "string" &&
    isNumberOrNull(v.deviceMemoryGb) &&
    isNumberOrNull(v.cores) &&
    isNumberOrNull(v.quotaBytes) &&
    isNumberOrNull(v.usageBytes) &&
    (v.persisted === null || typeof v.persisted === "boolean")
  );
}

function isEncodeResult(v: unknown): v is EncodeResult {
  return (
    isFields(v) &&
    isFiniteNumber(v.audioSeconds) &&
    isFiniteNumber(v.wallMs) &&
    isFiniteNumber(v.mp3Bytes)
  );
}

function isStorageResult(v: unknown): v is StorageResult {
  return (
    isFields(v) &&
    isFiniteNumber(v.bytes) &&
    isFiniteNumber(v.writeMs) &&
    isFiniteNumber(v.readMs)
  );
}

function parseOutcome<T>(
  raw: unknown,
  isValue: (v: unknown) => v is T
): ProbeOutcome<T> | null {
  if (!isFields(raw)) return null;
  if (raw.status === "failed" && typeof raw.errorName === "string") {
    return { status: "failed", errorName: raw.errorName };
  }
  if (raw.status === "ok" && isValue(raw.value)) {
    return { status: "ok", value: raw.value };
  }
  return null;
}

/** Read saved results back; anything that is not an object is "nothing saved". */
export function parseSavedChecks(raw: string | null): SavedChecks | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    // Not JSON: treated as nothing saved, which is what the docblock says.
    return null;
  }
  if (!isFields(value)) return null;
  return {
    device: parseOutcome(value.device, isDeviceInfo),
    encode: parseOutcome(value.encode, isEncodeResult),
    storage: parseOutcome(value.storage, isStorageResult),
  };
}
