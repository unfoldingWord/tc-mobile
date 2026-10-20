import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PhoneCheckView } from "@/components/phone-check-screen";
import { withEncoder } from "@/hooks/mp3-codec";
import {
  PHONE_CHECK_CONTEXT,
  runDspProbe,
  settleProbe,
} from "@/hooks/phone-check-probes";
import {
  subscribeToFailures,
  type FailureReport,
} from "@/hooks/report-failure";
import { runPhoneChecks, type PhoneCheckState } from "@/hooks/use-phone-check";
import {
  formatPhoneCheckReport,
  type DspResult,
  type PhoneCheckReportInput,
  type ProbeOutcome,
} from "@/lib/phone-check/report";
import {
  parseSavedChecks,
  serializeSavedChecks,
  type SavedChecks,
} from "@/lib/phone-check/saved-results";
import { DSP_PROBE_SECONDS } from "@/lib/phone-check/speech";
import { strings } from "@/lib/strings";
import type { AudioCodec, DspBenchResult } from "@/types/audio";

import { one, render } from "./render";

/**
 * #1433 step 1, task T3: the DSP benchmark becomes a step of the phone check.
 * It runs after the encode and before storage, twice (cold, then warm), lands
 * in the report a tester pastes into #974, and is saved with the other steps
 * so a reload keeps it. These are the Node halves: the report text, the saved
 * payload, the step order, the probe's call into the codec, and the screen's
 * one static render. Nothing here measures a speed — only a phone can.
 */

vi.mock("@/hooks/mp3-codec");
vi.mock("@/hooks/finish-transcode", () => ({
  pauseTranscodeSweep: () => {},
  resumeTranscodeSweep: () => {},
  transcodeSweepSettled: () => Promise.resolve(),
}));

function bench(overrides: Partial<DspBenchResult> = {}): DspBenchResult {
  return {
    audioSeconds: 60,
    chunks: 60,
    measureMs: 900,
    applyMs: 1100,
    stageMs: {
      highPass: 400,
      kWeight: 300,
      truePeak: 600,
      gain: 0.4,
      limiter: 700,
    },
    slowestChunkMs: 45,
    workingSetBytes: 300 * 1024,
    checksum: 0x1234abcd,
    loudnessLufs: -24.25,
    truePeakDbtp: -3.5,
    gainDb: 5.25,
    limiterMaxReductionDb: 1.5,
    ...overrides,
  };
}

const DSP: DspResult = {
  cold: bench(),
  warm: bench({ measureMs: 400, applyMs: 600 }),
};

const BASE: PhoneCheckReportInput = {
  version: "1.1.0",
  sha: "abc1234",
  device: null,
  encode: null,
  dsp: null,
  storage: null,
  allocation: null,
};

const HEADING = "DSP chain (1 minute of synthetic speech, in the MP3 worker)";

/** The report's DSP section: its heading through the line before the next blank. */
function dspSection(input: PhoneCheckReportInput): string[] {
  const lines = formatPhoneCheckReport(input).split("\n");
  const start = lines.indexOf(HEADING);
  if (start < 0) throw new Error("no DSP section in the report");
  const end = lines.indexOf("", start);
  const section = lines.slice(start, end < 0 ? undefined : end);
  if (section.length < 2) throw new Error("the DSP section is empty");
  return section;
}

describe("the report's DSP section", () => {
  it("sits after the encode and before storage, in run order", () => {
    const lines = formatPhoneCheckReport(BASE).split("\n");
    const encode = lines.indexOf("Encode (real MP3 worker)");
    const dsp = lines.indexOf(HEADING);
    const storage = lines.indexOf(
      "Storage (throwaway database, deleted afterwards)"
    );
    expect(encode).toBeGreaterThan(-1);
    expect(dsp).toBeGreaterThan(encode);
    expect(storage).toBeGreaterThan(dsp);
  });

  it("says not run when the step has not run", () => {
    expect(dspSection(BASE)).toEqual([HEADING, "- not run"]);
  });

  it("names only the error when the step failed (#172)", () => {
    expect(
      dspSection({
        ...BASE,
        dsp: { status: "failed", errorName: "DspBenchFailedError" },
      })
    ).toEqual([HEADING, "- failed: DspBenchFailedError"]);
  });

  it("prints both runs: seconds per audio minute, realtime, the passes and the stages", () => {
    const section = dspSection({ ...BASE, dsp: { status: "ok", value: DSP } });
    expect(section).toEqual([
      HEADING,
      "- A load profile only: not a BS.1770 conformance test.",
      "- Working set is the kernel's own buffers, not a measured peak.",
      "- Cold run: 2.00 s per audio minute (30.0x realtime)",
      "  - Measure pass 900 ms, apply pass 1100 ms, slowest chunk 45 ms",
      "  - Stages: high-pass 400 ms, K-weight 300 ms, true peak 600 ms, gain under 1 ms, limiter 700 ms",
      "- Warm run: 1.00 s per audio minute (60.0x realtime)",
      "  - Measure pass 400 ms, apply pass 600 ms, slowest chunk 45 ms",
      "  - Stages: high-pass 400 ms, K-weight 300 ms, true peak 600 ms, gain under 1 ms, limiter 700 ms",
      "- Working set: 300.0 KB",
      "- Output checksum: cold 1234abcd, warm 1234abcd",
      "- Measured: -24.3 LUFS ungated, true peak -3.5 dBTP, gain +5.3 dB, limiter at most 1.5 dB",
    ]);
  });

  it("prints no speed for a clock that did not move, and a silent signal's loudness as not measured", () => {
    const still = bench({
      measureMs: 0,
      applyMs: 0,
      loudnessLufs: null,
      truePeakDbtp: null,
    });
    const section = dspSection({
      ...BASE,
      dsp: { status: "ok", value: { cold: still, warm: still } },
    });
    expect(section).toContain("- Cold run: 0.00 s per audio minute (n/a)");
    expect(section).toContain(
      "- Measured: no signal, true peak no signal, gain +5.3 dB, limiter at most 1.5 dB"
    );
  });
});

const SAVED: SavedChecks = {
  device: null,
  encode: { status: "failed", errorName: "EncoderStalledError" },
  dsp: { status: "ok", value: DSP },
  storage: null,
};

describe("the saved DSP result", () => {
  it("round-trips with the other steps", () => {
    expect(parseSavedChecks(serializeSavedChecks(SAVED))).toEqual(SAVED);
    const failed: SavedChecks = {
      ...SAVED,
      dsp: { status: "failed", errorName: "AbortError" },
    };
    expect(parseSavedChecks(serializeSavedChecks(failed))).toEqual(failed);
  });

  it("reads a payload saved before the step existed as dsp: null", () => {
    const older = JSON.stringify({
      device: null,
      encode: SAVED.encode,
      storage: { status: "ok", value: { bytes: 1, writeMs: 1, readMs: 1 } },
    });
    expect(parseSavedChecks(older)).toEqual({
      device: null,
      encode: SAVED.encode,
      dsp: null,
      storage: { status: "ok", value: { bytes: 1, writeMs: 1, readMs: 1 } },
    });
  });

  it("drops a malformed dsp alone and keeps the other steps", () => {
    for (const dsp of [
      { status: "ok", value: { cold: DSP.cold } },
      {
        status: "ok",
        value: { cold: DSP.cold, warm: { ...DSP.warm, checksum: "x" } },
      },
      {
        status: "ok",
        value: {
          cold: {
            ...DSP.cold,
            stageMs: { ...DSP.cold.stageMs, limiter: null },
          },
          warm: DSP.warm,
        },
      },
      {
        status: "ok",
        value: { cold: { ...DSP.cold, loudnessLufs: "loud" }, warm: DSP.warm },
      },
      { status: "failed" },
    ]) {
      const raw = JSON.stringify({ ...SAVED, dsp });
      expect(parseSavedChecks(raw)).toEqual({ ...SAVED, dsp: null });
    }
  });
});

const ok = <T>(value: T): ProbeOutcome<T> => ({ status: "ok", value });

describe("runPhoneChecks with the DSP step", () => {
  it("runs device, encode, dsp, storage in that order, each busy before it starts", async () => {
    const log: string[] = [];
    const step =
      <T>(name: string, value: T) =>
      async () => {
        log.push(name);
        return ok(value);
      };
    await runPhoneChecks(
      {
        device: step("device", {} as never),
        encode: step("encode", {} as never),
        dsp: step("dsp", DSP),
        storage: step("storage", {} as never),
      },
      (next) => log.push(`land:${Object.keys(next).join(",")}`),
      (activity) => log.push(`busy:${activity?.kind ?? "idle"}`)
    );
    expect(log).toEqual([
      "busy:waiting",
      "land:device,encode,dsp,storage",
      "busy:device",
      "device",
      "land:device",
      "busy:encode",
      "encode",
      "land:encode",
      "busy:dsp",
      "dsp",
      "land:dsp",
      "busy:storage",
      "storage",
      "land:storage",
    ]);
  });

  it("starts no storage probe and lands no dsp result when aborted during the dsp step", async () => {
    const run = new AbortController();
    const storage = vi.fn();
    const land = vi.fn();
    await expect(
      runPhoneChecks(
        {
          device: async () => ({ status: "failed", errorName: "x" }),
          encode: async () => ({ status: "failed", errorName: "x" }),
          dsp: async () => {
            run.abort();
            return ok(DSP);
          },
          storage,
        },
        land,
        () => {},
        run.signal
      )
    ).rejects.toBeDefined();
    expect(storage).not.toHaveBeenCalled();
    expect(land).not.toHaveBeenCalledWith({ dsp: expect.anything() });
  });
});

describe("runDspProbe", () => {
  const benchDsp = vi.fn<(seconds: number) => Promise<DspBenchResult>>();
  const codec = (withBench: boolean): AudioCodec => ({
    encodeMp3: () => Promise.reject(new Error("no encode expected")),
    decodeMp3: () => Promise.reject(new Error("no decode expected")),
    ...(withBench ? { benchDsp } : {}),
  });
  let failures: FailureReport[];
  let off: () => void;

  beforeEach(() => {
    vi.mocked(withEncoder).mockReset();
    benchDsp.mockReset();
    failures = [];
    off = subscribeToFailures((r) => void failures.push(r));
  });
  afterEach(() => off());

  it("runs one minute twice on the encoder lane with the run's signal, cold then warm", async () => {
    vi.mocked(withEncoder).mockImplementation(async (_signal, work) =>
      work(codec(true))
    );
    benchDsp.mockResolvedValueOnce(DSP.cold).mockResolvedValueOnce(DSP.warm);
    const run = new AbortController();
    await expect(runDspProbe(run.signal)).resolves.toEqual(DSP);
    expect(DSP_PROBE_SECONDS).toBe(60);
    expect(benchDsp.mock.calls).toEqual([[60], [60]]);
    expect(vi.mocked(withEncoder).mock.calls.map(([s]) => s)).toEqual([
      run.signal,
    ]);
  });

  it("does not start the warm run once the run is aborted", async () => {
    const run = new AbortController();
    vi.mocked(withEncoder).mockImplementation(async (_signal, work) =>
      work(codec(true))
    );
    benchDsp.mockImplementationOnce(async () => {
      run.abort();
      return DSP.cold;
    });
    await expect(runDspProbe(run.signal)).rejects.toBe(run.signal.reason);
    expect(benchDsp).toHaveBeenCalledTimes(1);
  });

  it("fails, and reaches the funnel through settleProbe, on a codec without the benchmark", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.mocked(withEncoder).mockImplementation(async (_signal, work) =>
        work(codec(false))
      );
      const outcome = await settleProbe(() => runDspProbe());
      expect(outcome).toEqual({
        status: "failed",
        errorName: "DspBenchUnavailableError",
      });
      expect(failures.map((r) => r.context)).toEqual([PHONE_CHECK_CONTEXT]);
    } finally {
      error.mockRestore();
    }
  });

  it("reports a benchmark that throws as a failed step, by error name", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.mocked(withEncoder).mockImplementation(async (_signal, work) =>
        work(codec(true))
      );
      const thrown = new Error("worker said no");
      thrown.name = "DspBenchFailedError";
      benchDsp.mockRejectedValueOnce(thrown);
      expect(await settleProbe(() => runDspProbe())).toEqual({
        status: "failed",
        errorName: "DspBenchFailedError",
      });
      expect(failures.map((r) => r.context)).toEqual([PHONE_CHECK_CONTEXT]);
    } finally {
      error.mockRestore();
    }
  });
});

const IDLE: PhoneCheckState = {
  device: null,
  encode: null,
  dsp: null,
  storage: null,
  allocation: null,
  activity: null,
};

function view(state: PhoneCheckState): Element {
  const noop = () => {};
  return render(
    createElement(PhoneCheckView, {
      state,
      version: "1.1.0",
      sha: "abc1234",
      onStart: noop,
      onStartMemory: noop,
      onClose: noop,
    })
  );
}

describe("PhoneCheckView with the DSP step", () => {
  it("names the step while it runs and holds Close and both Starts", () => {
    const root = view({ ...IDLE, activity: { kind: "dsp" } });
    expect(one(root, '[data-phone-check="status"]').textContent).toBe(
      strings.phoneCheckRunDsp
    );
    for (const control of ["close", "start", "memory"]) {
      expect(
        one(root, `[data-phone-check="${control}"]`).hasAttribute("disabled")
      ).toBe(true);
    }
  });

  it("does not say Done until the DSP step has landed too", () => {
    const failed = { status: "failed", errorName: "X" } as const;
    const three = { ...IDLE, device: failed, encode: failed, storage: failed };
    const status = (state: PhoneCheckState) =>
      one(view(state), '[data-phone-check="status"]').textContent;
    expect(status(three)).toBe("");
    expect(status({ ...three, dsp: failed })).toBe(strings.phoneCheckDone);
  });

  it("puts the landed result in the report", () => {
    const report = one(
      view({ ...IDLE, dsp: { status: "ok", value: DSP } }),
      '[data-phone-check="report"]'
    ).textContent;
    expect(report).toContain(
      `${HEADING}\n- A load profile only: not a BS.1770 conformance test.`
    );
  });
});
