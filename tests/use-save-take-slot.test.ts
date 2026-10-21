// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NewTake } from "@/lib/takes/pending-take";
import type { ClipId, SegmentId, TakeId } from "@/types/domain";

/**
 * The launch replay reads the hook's LIVE slot, not the last render's (George,
 * PR #1546 round 1). A take that fails its save sits in the slot with no
 * write in flight; a replay that runs before React has rendered that state
 * must still see it and stand back with `"busy"`.
 *
 * Mounts the real `useSaveTake`. The replay itself is captured at its module
 * seam so the test decides when it runs, and the store writes are stubs: what
 * is under test is which slot the hook hands the replay.
 */

type Resume = (
  take: NewTake,
  against: TakeId | null
) => Promise<boolean | "busy" | "stale">;

const seam = vi.hoisted(() => ({ resume: null as null | Resume }));

vi.mock("@/hooks/recover-pending-takes", () => ({
  recoverPendingTakes: (resume: Resume) => {
    seam.resume = resume;
    return Promise.resolve();
  },
}));
vi.mock("@/lib/storage/takes", () => ({
  saveTake: vi.fn(() => Promise.reject(new Error("disk said no"))),
  saveReplayedTake: vi.fn(() => Promise.resolve({ kind: "stale" })),
  clearSegmentTake: () => Promise.resolve(),
}));
vi.mock("@/lib/storage/pending-takes", () => ({
  writePendingTake: () => Promise.resolve({ ok: true, outcome: "written" }),
  deletePendingTake: () => Promise.resolve({ ok: true, outcome: "deleted" }),
}));
vi.mock("@/hooks/finish-transcode", () => ({
  requestTranscodeSweep: () => Promise.resolve(),
}));
vi.mock("@/hooks/report-failure", () => ({ reportFailure: () => {} }));

import { useSaveTake } from "@/hooks/use-save-take";
import { saveReplayedTake } from "@/lib/storage/takes";

const probe = { api: null as ReturnType<typeof useSaveTake> | null };
const keepApi = (api: ReturnType<typeof useSaveTake>) => {
  probe.api = api;
};
type Api = ReturnType<typeof useSaveTake>;
function Probe({ onApi }: { onApi: (api: Api) => void }) {
  onApi(useSaveTake());
  return null;
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  seam.resume = null;
  probe.api = null;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const SEGMENT = "segment-1" as SegmentId;

describe("useSaveTake — the replay reads the live slot", () => {
  it("stands back from a failed take React has not rendered yet", async () => {
    await act(async () =>
      root.render(createElement(Probe, { onApi: keepApi }))
    );
    expect(seam.resume).not.toBeNull();

    let saved: boolean | null = null;
    let resumed: boolean | "busy" | "stale" | null = null;
    // One act scope: React renders the failed state only when it ends, so the
    // replay below runs between the slot write and its render.
    await act(async () => {
      saved = await probe.api!.saveRecording(
        SEGMENT,
        1,
        new Int16Array(0),
        new Int16Array([1, 2, 3]),
        0,
        false
      );
      resumed = await seam.resume!(
        {
          segmentId: SEGMENT,
          ordinal: 1,
          clipId: "replayed" as ClipId,
          existing: new Int16Array(0),
          recorded: new Int16Array([4, 5]),
          offset: 0,
          finished: false,
          editOnly: false,
        },
        null
      );
    });

    expect(saved).toBe(false);
    expect(resumed).toBe("busy");
    expect(saveReplayedTake).not.toHaveBeenCalled();
    // The failed take is still the one held: the recovery screen's take.
    expect(probe.api!.pendingTake?.state).toBe("failed");
    expect(probe.api!.pendingTake?.clipId).not.toBe("replayed");
  });
});
