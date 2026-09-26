import { useCallback, useEffect, useRef, useState } from "react";

import {
  browserAllocationDeps,
  readAllocationBreadcrumb,
  readDeviceInfo,
  runStorageProbe,
  runWorkerEncodeProbe,
  sessionBreadcrumbStore,
  settleProbe,
  writeAllocationBreadcrumb,
} from "./phone-check-probes";
import {
  reloadedResult,
  runAllocationSteps,
} from "@/lib/phone-check/allocation";
import type {
  AllocationResult,
  DeviceInfo,
  EncodeResult,
  ProbeOutcome,
  StorageResult,
} from "@/lib/phone-check/report";

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

/**
 * The phone check's state and its two Start actions (#1009).
 *
 * Nothing runs on mount but ONE read: the memory ceiling's `sessionStorage`
 * breadcrumb, which is how a page the ceiling crashed reports how far it got.
 * The breadcrumb is cleared once read, so the same crash is reported once.
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
  const [state, setState] = useState<PhoneCheckState>(() => {
    const crumb = readAllocationBreadcrumb(crumbStore);
    return {
      device: null,
      encode: null,
      storage: null,
      allocation: crumb ? reloadedResult(crumb) : null,
      activity: null,
    };
  });
  const busy = useRef(false);

  // The read above is the report; clearing is a side effect, so it waits for
  // the commit rather than running inside the initializer.
  useEffect(() => {
    writeAllocationBreadcrumb(crumbStore, null);
  }, [crumbStore]);

  const runChecks = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    const patch = (next: Partial<PhoneCheckState>) =>
      setState((prev) => ({ ...prev, ...next }));
    void (async () => {
      try {
        patch({ activity: { kind: "device" } });
        patch({ device: await settleProbe(() => readDeviceInfo(navigator)) });
        patch({ activity: { kind: "encode" } });
        patch({ encode: await settleProbe(runWorkerEncodeProbe) });
        patch({ activity: { kind: "storage" } });
        patch({ storage: await settleProbe(() => runStorageProbe()) });
      } finally {
        busy.current = false;
        patch({ activity: null });
      }
    })();
  }, []);

  const runMemory = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    const deps = browserAllocationDeps(crumbStore, (mb) =>
      setState((prev) => ({ ...prev, activity: { kind: "memory", mb } }))
    );
    // No catch: a failed ALLOCATION is a result, returned by the loop, and
    // anything else that rejects here is a defect for the app-wide
    // unhandled-rejection listener, which reports it to the funnel.
    void (async () => {
      try {
        const allocation = await runAllocationSteps(deps);
        setState((prev) => ({ ...prev, allocation }));
      } finally {
        deps.release();
        busy.current = false;
        setState((prev) => ({ ...prev, activity: null }));
      }
    })();
  }, [crumbStore]);

  return { state, runChecks, runMemory };
}
