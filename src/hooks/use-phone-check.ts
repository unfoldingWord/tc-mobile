import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  pauseTranscodeSweep,
  resumeTranscodeSweep,
  transcodeSweepSettled,
} from "./finish-transcode";
import {
  browserAllocationDeps,
  isAbortCause,
  PHONE_CHECK_CONTEXT,
  readAllocationBreadcrumb,
  readDeviceInfo,
  readSavedChecks,
  runDspProbe,
  runStorageProbe,
  runWorkerEncodeProbe,
  sessionBreadcrumbStore,
  settleProbe,
  writeAllocationBreadcrumb,
  writeSavedChecks,
  type BreadcrumbStore,
} from "./phone-check-probes";
import {
  claimPhoneCheckRun,
  isPhoneCheckRunning,
  subscribeToRunSlot,
} from "./phone-check-run-slot";
import { reportFailure } from "./report-failure";
import {
  reloadedResult,
  runAllocationSteps,
  type AllocationDeps,
} from "@/lib/phone-check/allocation";
import type {
  AllocationResult,
  DeviceInfo,
  DspResult,
  EncodeResult,
  ProbeOutcome,
  StorageResult,
} from "@/lib/phone-check/report";
import type { SavedChecks } from "@/lib/phone-check/saved-results";

/**
 * What the checks are doing right now. `null` is idle. `waiting` is a run
 * that holds the claim but is still waiting for a transcode turn already in
 * flight to finish: busy, so Close and both Starts stay disabled through it.
 * `stopping` is a run this screen did not start — one an earlier, closed
 * screen started and aborted — still holding the slot until its probe in
 * flight reaches an abort boundary. A Start then would return without doing
 * anything, so the screen reads busy instead of idle (#1379).
 */
export type PhoneCheckActivity =
  | { readonly kind: "waiting" }
  | { readonly kind: "stopping" }
  | { readonly kind: "device" }
  | { readonly kind: "encode" }
  | { readonly kind: "dsp" }
  | { readonly kind: "storage" }
  | { readonly kind: "memory"; readonly mb: number }
  | null;

export interface PhoneCheckState {
  readonly device: ProbeOutcome<DeviceInfo> | null;
  readonly encode: ProbeOutcome<EncodeResult> | null;
  readonly dsp: ProbeOutcome<DspResult> | null;
  readonly storage: ProbeOutcome<StorageResult> | null;
  readonly allocation: AllocationResult | null;
  readonly activity: PhoneCheckActivity;
}

/**
 * The state a newly opened phone check starts from: Start's saved results
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
    dsp: saved?.dsp ?? null,
    storage: saved?.storage ?? null,
    allocation: crumb ? reloadedResult(crumb) : null,
    activity: null,
  };
}

/** The four probes `runChecks` runs, in order; a test hands in its own. */
export interface CheckProbes {
  readonly device: () => Promise<ProbeOutcome<DeviceInfo>>;
  readonly encode: () => Promise<ProbeOutcome<EncodeResult>>;
  readonly dsp: () => Promise<ProbeOutcome<DspResult>>;
  readonly storage: () => Promise<ProbeOutcome<StorageResult>>;
}

/** The pause reason the phone check holds the transcode sweep under. */
const PHONE_CHECK_SWEEP_PAUSE = "phone-check";

const STOPPING: PhoneCheckActivity = { kind: "stopping" };

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
 *
 * `busyWith({ kind: "waiting" })` is called synchronously, before the first
 * `await`: the wait can last a whole transcode turn, and a screen that read as
 * idle through it would let Close unmount a run that then starts measuring
 * under Books (Frank R2 P1 / George R2 High on #1013).
 */
async function withTranscodeHeld<T>(
  busyWith: (activity: PhoneCheckActivity) => void,
  work: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  busyWith({ kind: "waiting" });
  pauseTranscodeSweep(PHONE_CHECK_SWEEP_PAUSE);
  try {
    await transcodeSweepSettled();
    signal?.throwIfAborted();
    return await work();
  } finally {
    resumeTranscodeSweep(PHONE_CHECK_SWEEP_PAUSE);
  }
}

/**
 * Start's steps: device info, then the encode, then the DSP benchmark (#1433),
 * then storage, with the transcode sweep held off all of them. The benchmark
 * follows the encode on the same worker and runs before the storage probe has
 * filled memory, for the reason the encode does. `land` receives each result
 * as it arrives and `busyWith` the step about to run.
 */
export function runPhoneChecks(
  probes: CheckProbes,
  land: (next: Partial<SavedChecks>) => void,
  busyWith: (activity: PhoneCheckActivity) => void,
  signal?: AbortSignal
): Promise<void> {
  return withTranscodeHeld(
    busyWith,
    async () => {
      // A new run replaces the last one whole, never a mix of the two.
      land({ device: null, encode: null, dsp: null, storage: null });
      busyWith({ kind: "device" });
      const device = await probes.device();
      signal?.throwIfAborted();
      land({ device });
      busyWith({ kind: "encode" });
      const encode = await probes.encode();
      signal?.throwIfAborted();
      land({ encode });
      busyWith({ kind: "dsp" });
      const dsp = await probes.dsp();
      signal?.throwIfAborted();
      land({ dsp });
      busyWith({ kind: "storage" });
      const storage = await probes.storage();
      signal?.throwIfAborted();
      land({ storage });
    },
    signal
  );
}

/**
 * Step 4, the memory ceiling, with the transcode sweep held off it. `busyWith`
 * marks the run busy while it waits on the sweep; the steps themselves report
 * through `deps`.
 */
export function runMemoryCheck(
  deps: AllocationDeps,
  busyWith: (activity: PhoneCheckActivity) => void
): Promise<AllocationResult> {
  return withTranscodeHeld(
    busyWith,
    () => runAllocationSteps(deps),
    deps.signal
  );
}

/**
 * Await a run's work, swallowing only the rejection an abort caused. Any
 * other rejection is a defect and goes on to the app-wide unhandled-rejection
 * listener, as before.
 */
export async function untilDoneOrAborted(
  signal: AbortSignal,
  work: () => Promise<void>
): Promise<void> {
  try {
    await work();
  } catch (cause) {
    // The screen unmounted mid-run (#1014 item 6): the run stopped on purpose.
    if (!isAbortCause(cause, signal)) throw cause;
  }
}

/**
 * The phone check's state and its two Start actions (#1009).
 *
 * Nothing runs on mount but reads: Start's saved results and the memory
 * ceiling's `sessionStorage` breadcrumb. Both are there because the ceiling is
 * meant to run last and can end with the page reloading; without the saved
 * results, the report copied after that reload would say "not run" for the
 * steps the tester already ran. The breadcrumb is cleared once read, so
 * the same crash is reported once; the saved results stay until the next
 * Start replaces them.
 *
 * `runChecks` is device info, then the encode, then the DSP benchmark, then
 * storage, in that order — the encode and the benchmark before storage so the
 * worker is measured before the storage probe has filled memory with 50 MB of
 * test chunks. `runMemory` is separate,
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
  // Read live, so a screen opened while a closed screen's run winds down goes
  // busy at once and idle the moment that run releases the slot. This screen's
  // own runs set `activity` themselves, synchronously in the tap.
  const slotHeld = useSyncExternalStore(
    subscribeToRunSlot,
    isPhoneCheckRunning,
    isPhoneCheckRunning
  );
  // The runs this screen started that have not finished (#1014 item 6), each
  // with what puts its earlier report back, or `null` when it has none.
  const liveRuns = useRef(new Map<AbortController, (() => void) | null>());
  // The last report this screen holds, read when a run starts so an aborted
  // run can put it back (#1379 item 4).
  const reportRef = useRef(state);
  // A layout effect, not a render-time write: the lint rule `react-hooks/refs`
  // bans the latter, and this runs before paint and before any tap can Start.
  useLayoutEffect(() => {
    reportRef.current = state;
  }, [state]);

  // The screen going away stops what it started: each probe ends at its next
  // boundary and the run slot is released, instead of measuring under Books.
  // The earlier report goes back into storage HERE, not only in the run's
  // `finally`: that runs when the probe in flight reaches its boundary, and a
  // screen opened before then would read the opening blanks (#1379).
  useEffect(() => {
    const runs = liveRuns.current;
    return () => {
      for (const [run, restore] of runs) {
        run.abort();
        // Guarded per run: a throwing restore must not leave a later run in
        // the map un-aborted. The failure goes to the funnel, not up into React.
        try {
          restore?.();
        } catch (cause) {
          reportFailure(cause, PHONE_CHECK_CONTEXT);
        }
      }
    };
  }, []);

  // The read above is the report; clearing is a side effect, so it waits for
  // the commit rather than running inside the initializer.
  useEffect(() => {
    writeAllocationBreadcrumb(crumbStore, null);
  }, [crumbStore]);

  const runChecks = useCallback(() => {
    const release = claimPhoneCheckRun();
    if (release === null) return;
    const run = new AbortController();
    const { signal } = run;
    const previous: SavedChecks = {
      device: reportRef.current.device,
      encode: reportRef.current.encode,
      dsp: reportRef.current.dsp,
      storage: reportRef.current.storage,
    };
    let finished = false;
    let saved: SavedChecks = {
      device: null,
      encode: null,
      dsp: null,
      storage: null,
    };
    // Safe to call twice, on purpose: the unmount and the run's `finally` both
    // call it. The second call is also the backstop for a `land` that arrives
    // after the abort and rewrites storage, so do not turn this into a
    // once-only latch.
    const restore = () => {
      if (!finished) writeSavedChecks(crumbStore, previous);
    };
    liveRuns.current.set(run, restore);
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
        await untilDoneOrAborted(signal, async () => {
          await runPhoneChecks(
            {
              device: () =>
                settleProbe(() => readDeviceInfo(navigator, signal), signal),
              encode: () =>
                settleProbe(() => runWorkerEncodeProbe(signal), signal),
              dsp: () => settleProbe(() => runDspProbe(signal), signal),
              storage: () =>
                settleProbe(() => runStorageProbe({ signal }), signal),
            },
            land,
            busyWith,
            signal
          );
          // Set only when the run reached its end: an abort is swallowed by
          // `untilDoneOrAborted`, so returning from it does not mean finished.
          finished = true;
        });
      } finally {
        // An aborted run leaves the earlier report in place (#1379 item 4,
        // DRI 2026-10-12). Only the abort path: a finished run replaced the
        // report whole, and a defect rethrown above keeps today's behaviour.
        try {
          if (!finished && signal.aborted) {
            restore();
            setState((prev) => ({ ...prev, ...previous }));
          }
        } finally {
          liveRuns.current.delete(run);
          release();
          busyWith(null);
        }
      }
    })();
  }, [crumbStore]);

  const runMemory = useCallback(() => {
    const release = claimPhoneCheckRun();
    if (release === null) return;
    const run = new AbortController();
    const { signal } = run;
    liveRuns.current.set(run, null);
    const busyWith = (activity: PhoneCheckActivity) =>
      setState((prev) => ({ ...prev, activity }));
    const deps = browserAllocationDeps(
      crumbStore,
      (mb) => busyWith({ kind: "memory", mb }),
      signal
    );
    // No catch: a failed ALLOCATION is a result, returned by the loop, and
    // anything else that rejects here is a defect for the app-wide
    // unhandled-rejection listener, which reports it to the funnel.
    void (async () => {
      try {
        await untilDoneOrAborted(signal, async () => {
          const allocation = await runMemoryCheck(deps, busyWith);
          setState((prev) => ({ ...prev, allocation }));
        });
      } finally {
        liveRuns.current.delete(run);
        deps.release();
        release();
        busyWith(null);
      }
    })();
  }, [crumbStore]);

  const shown =
    state.activity === null && slotHeld
      ? { ...state, activity: STOPPING }
      : state;
  return { state: shown, runChecks, runMemory };
}
