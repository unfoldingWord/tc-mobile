import { describe, expect, it } from "vitest";

import {
  MB,
  formatMb,
  formatPhoneCheckReport,
  formatRate,
  realtimeFactor,
  type PhoneCheckReportInput,
} from "@/lib/phone-check/report";

/**
 * #1009 — the plain-text report a tester pastes into #974. These pin the
 * arithmetic and the shape: every section present whether or not its probe
 * ran, and a failed probe reported by error name only (#172).
 */

const ALL_RUN: PhoneCheckReportInput = {
  version: "0.2.12",
  sha: "abc1234",
  device: {
    status: "ok",
    value: {
      userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/129",
      deviceMemoryGb: 4,
      cores: 8,
      quotaBytes: 2048 * MB,
      usageBytes: 12.5 * MB,
      persisted: true,
    },
  },
  encode: {
    status: "ok",
    value: { audioSeconds: 300, wallMs: 12_000, mp3Bytes: 2.4 * MB },
  },
  storage: {
    status: "ok",
    value: { bytes: 50 * MB, writeMs: 2000, readMs: 500 },
  },
  allocation: {
    kind: "failed",
    lastOkMb: 200,
    failedAtMb: 225,
    errorName: "RangeError",
  },
};

describe("phone check report arithmetic", () => {
  it("formats bytes as MB and a rate as MB/s", () => {
    expect(formatMb(50 * MB)).toBe("50.0 MB");
    expect(formatRate(50 * MB, 2000)).toBe("25.0 MB/s");
  });

  it("gives no rate and no realtime factor for a clock that did not move", () => {
    expect(formatRate(50 * MB, 0)).toBe("n/a");
    expect(realtimeFactor(300, 0)).toBeNull();
  });

  it("derives the realtime factor from audio length over wall time", () => {
    expect(realtimeFactor(300, 12_000)).toBe(25);
    expect(realtimeFactor(300, 600_000)).toBe(0.5);
  });
});

describe("formatPhoneCheckReport", () => {
  it("renders every probe's numbers when all ran", () => {
    expect(formatPhoneCheckReport(ALL_RUN)).toBe(
      [
        "**Phone check** (#1009) — build v0.2.12 · abc1234",
        "Tester (role): ",
        "Device and OS version: ",
        "",
        "Device info",
        "- User agent: Mozilla/5.0 (Linux; Android 14) Chrome/129",
        "- Device memory: 4 GB",
        "- CPU cores: 8",
        "- Storage: 12.5 MB used of 2048.0 MB quota",
        "- Persisted: yes",
        "",
        "Encode (real MP3 worker)",
        "- Audio: 300.0 s of synthetic speech",
        "- Wall time: 12.0 s",
        "- Speed: 25.0x realtime",
        "- MP3 size: 2.4 MB",
        "",
        "Storage (throwaway database, deleted afterwards)",
        "- Write: 50.0 MB in 2.0 s (25.0 MB/s)",
        "- Read: 50.0 MB in 0.5 s (100.0 MB/s)",
        "",
        "Memory ceiling",
        "- Last succeeded: 200 MB",
        "- Failed at 225 MB: RangeError",
      ].join("\n")
    );
  });

  it("keeps every section, marked not run, before anything has run", () => {
    const report = formatPhoneCheckReport({
      version: "0.2.12",
      sha: "abc1234",
      device: null,
      encode: null,
      storage: null,
      allocation: null,
    });
    for (const heading of [
      "Device info",
      "Encode (real MP3 worker)",
      "Storage (throwaway database, deleted afterwards)",
      "Memory ceiling",
    ]) {
      expect(report).toContain(`${heading}\n- not run`);
    }
  });

  it("reports a failed probe by its error name, never its message", () => {
    const report = formatPhoneCheckReport({
      ...ALL_RUN,
      encode: { status: "failed", errorName: "EncoderStalledError" },
      storage: { status: "failed", errorName: "QuotaExceededError" },
    });
    expect(report).toContain(
      "Encode (real MP3 worker)\n- failed: EncoderStalledError"
    );
    expect(report).toContain(
      "Storage (throwaway database, deleted afterwards)\n- failed: QuotaExceededError"
    );
  });

  it("says what a browser did not report instead of printing null", () => {
    const report = formatPhoneCheckReport({
      ...ALL_RUN,
      device: {
        status: "ok",
        value: {
          userAgent: "",
          deviceMemoryGb: null,
          cores: null,
          quotaBytes: null,
          usageBytes: null,
          persisted: null,
        },
      },
    });
    expect(report).not.toContain("null");
    expect(report).toContain("- Device memory: not reported");
    expect(report).toContain("- Storage: not reported");
    expect(report).toContain("- Persisted: not reported");
  });

  it("reports the two other ends of the memory ceiling", () => {
    expect(
      formatPhoneCheckReport({
        ...ALL_RUN,
        allocation: { kind: "completed", lastOkMb: 400 },
      })
    ).toContain("Memory ceiling\n- Reached 400 MB (every step succeeded)");
    expect(
      formatPhoneCheckReport({
        ...ALL_RUN,
        allocation: { kind: "reloaded", lastOkMb: 150, attemptingMb: 175 },
      })
    ).toContain(
      "Memory ceiling\n- Last succeeded: 150 MB\n- The page reloaded while trying 175 MB"
    );
  });
});
