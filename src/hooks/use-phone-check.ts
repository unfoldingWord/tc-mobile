import { useCallback, useEffect, useState } from "react";

import {
  pauseTranscodeSweep,
  resumeTranscodeSweep,
  transcodeSweepSettled,
} from "./finish-transcode";
import {
  browserAllocationDeps,
  readAllocationBreadcrumb,
  readDeviceInfo,
  readSavedChecks,
  runStorageProbe,
  runWorkerEncodeProbe,
  sessionBreadcrumbStore,
  settleProbe,
  writeAllocationBreadcrumb,
  writeSavedChecks,
  type BreadcrumbStore,
} from "./phone-check-probes";
import {
  reloadedResult,
  runAllocationSteps,
  type AllocationDeps,
} from "@/lib/phone-check/allocation";
import type {
  AllocationResult,
  DeviceInfo,
  EncodeResult,
  ProbeOutcome,
  StorageResult,
} from "@/lib/phone-check/report";
import type { SavedChecks } from "@/lib/phone-check/saved-results";

/** What the checks are doing right now. `null` is idle. */
export type PhoneCheckActivity =
  | { readonly kind: "device" }
  | { readonly kind: "encode" }
  | { readonly kind: "storage" }
  | { readonly kind: "memory"; readonly mb: number }
  | null;

export interface PhoneCheckState {
  readonly device: ProbeOutcome<DeviceInfo> | null;
  readonly encode: ProbeOutcome<EncodeResult> | null;
  readonly storage: ProbeOutcome<StorageResult> | null;
  readonly allocation: AllocationResult | null;
  readonly activity: PhoneCheckActivity;
}

let runInFlight = false;

/**
 * Claim the one phone-check run slot, or `null` while a run holds it.
 *
 * Module-wide rather than per screen: a run is not tied to the screen that
 * started it, and two storage probes on the one throwaway database would race
 * each other's leading and trailing deletes. The screen keeps Close disabled
 * while a run is in flight, so this is the backstop, not the usual guard.
 * The returned release works once; a second call is ignored, so a stale
 * release cannot free a later run's claim.
 */
export function claimPhoneCheckRun(): (() => void) | null {
  if (runInFlight) return null;
  runInFlight = true;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    runInFlight = false;
  };
}

/**
 * The state a newly opened phone check starts from: steps 1-3's saved results
 * and, if the memory ceiling's page died mid-step, what its breadcrumb says.
 * Reads only; clearing the breadcrumb is the hook's post-commit effect.
 */
export function initialPhoneCheckState(
  store: BreadcrumbStore | null
): PhoneCheckState {
  const saved = readSavedChecks(store);
  const crumb = readAllocationBreadcrumb(store);
  return {
    device: saved?.device ?? null,
    encode: saved?.encode ?? null,
    storage: saved?.storage ?? null,
    allocation: crumb ? reloadedResult(crumb) : null,
    activity: null,
  };
}

/** The three probes `runChecks` runs, in order; a test hands in its own. */
export interface CheckProbes {
  readonly device: () => Promise<ProbeOutcome<DeviceInfo>>;
  readonly encode: () => Promise<ProbeOutcome<EncodeResult>>;
  readonly storage: () => Promise<ProbeOutcome<StorageResult>>;
}

/** The pause reason the phone check holds the transcode sweep under. */
const PHONE_CHECK_SWEEP_PAUSE = "phone-check";

/**
 * Run `work` with the background transcode sweep held off it (Frank R1 P2 on
 * #1013). The sweep loads a segment's PCM, encodes it and commits it to the
 * app's database, so a turn overlapping the storage probe or the memory
 * ceiling skews both numbers.
 *
 * The pause stops the sweep starting another turn; awaiting the sweep then
 * lets a turn already in flight finish before anything is measured. A request
 * made meanwhile is held by the pause, not dropped, and the resume in the
 * `finally` carries it out when the run ends — the same reversible pause
 * `SaveFailed` holds (#514).
 */
async function withTranscodeHeld<T>(work: () => Promise<T>): Promise<T> {
  pauseTranscodeSweep(PHONE_CHECK_SWEEP_PAUSE);
  try {
    await transcodeSweepSettled();
    return await work();
  } finally {
    resumeTranscodeSweep(PHONE_CHECK_SWEEP_PAUSE);
  }
}

/**
 * Steps 1-3: device info, then the encode, then storage, with the transcode
 * sweep held off all three. `land` receives each result as it arrives and
 * `busyWith` the step about to run.
 */
export function runPhoneChecks(
  probes: CheckProbes,
  land: (next: Partial<SavedChecks>) => void,
  busyWith: (activity: PhoneCheckActivity) => void
): Promise<void> {
  return withTranscodeHeld(async () => {
    // A new run replaces the last one whole, never a mix of the two.
    land({ device: null, encode: null, storage: null });
    busyWith({ kind: "device" });
    land({ device: await probes.device() });
    busyWith({ kind: "encode" });
    land({ encode: await probes.encode() });
    busyWith({ kind: "storage" });
    land({ storage: await probes.storage() });
  });
}

/** Step 4, the memory ceiling, with the transcode sweep held off it. */
export function runMemoryCheck(
  deps: AllocationDeps
): Promise<AllocationResult> {
  return withTranscodeHeld(() => runAllocationSteps(deps));
}

/**
 * The phone check's state and its two Start actions (#1009).
 *
 * Nothing runs on mount but reads: steps 1-3's saved results and the memory
 * ceiling's `sessionStorage` breadcrumb. Both are there because the ceiling is
 * meant to run last and can end with the page reloading; without the saved
 * results, the report copied after that reload would say "not run" for the
 * three steps the tester already ran. The breadcrumb is cleared once read, so
 * the same crash is reported once; the saved results stay until the next
 * Start replaces them.
 *
 * `runChecks` is device info, then the encode, then storage, in that order —
 * the encode before storage so the encoder is measured before the storage
 * probe has filled memory with 50 MB of test chunks. `runMemory` is separate,
 * opt-in and meant to be last; the screen says so.
 */
export function usePhoneCheck(): {
  state: PhoneCheckState;
  runChecks: () => void;
  runMemory: () => void;
} {
  const [crumbStore] = useState(sessionBreadcrumbStore);
  const [state, setState] = useState<PhoneCheckState>(() =>
    initialPhoneCheckState(crumbStore)
  );

  // The read above is the report; clearing is a side effect, so it waits for
  // the commit rather than running inside the initializer.
  useEffect(() => {
    writeAllocationBreadcrumb(crumbStore, null);
  }, [crumbStore]);

  const runChecks = useCallback(() => {
    const release = claimPhoneCheckRun();
    if (release === null) return;
    let saved: SavedChecks = { device: null, encode: null, storage: null };
    // Each result is saved the moment it lands, so a reload later — in this
    // run or in the memory ceiling after it — keeps what finished.
    const land = (next: Partial<SavedChecks>) => {
      saved = { ...saved, ...next };
      writeSavedChecks(crumbStore, saved);
      setState((prev) => ({ ...prev, ...next }));
    };
    const busyWith = (activity: PhoneCheckActivity) =>
      setState((prev) => ({ ...prev, activity }));
    void (async () => {
      try {
        await runPhoneChecks(
          {
            device: () => settleProbe(() => readDeviceInfo(navigator)),
            encode: () => settleProbe(runWorkerEncodeProbe),
            storage: () => settleProbe(() => runStorageProbe()),
          },
          land,
          busyWith
        );
      } finally {
        release();
        busyWith(null);
      }
    })();
  }, [crumbStore]);

  const runMemory = useCallback(() => {
    const release = claimPhoneCheckRun();
    if (release === null) return;
    const deps = browserAllocationDeps(crumbStore, (mb) =>
      setState((prev) => ({ ...prev, activity: { kind: "memory", mb } }))
    );
    // No catch: a failed ALLOCATION is a result, returned by the loop, and
    // anything else that rejects here is a defect for the app-wide
    // unhandled-rejection listener, which reports it to the funnel.
    void (async () => {
      try {
        const allocation = await runMemoryCheck(deps);
        setState((prev) => ({ ...prev, allocation }));
      } finally {
        deps.release();
        release();
        setState((prev) => ({ ...prev, activity: null }));
      }
    })();
  }, [crumbStore]);

  return { state, runChecks, runMemory };
}
