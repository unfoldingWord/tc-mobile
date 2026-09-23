// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  usePausedPreview,
  type UsePausedPreview,
} from "@/hooks/use-paused-preview";

/**
 * The paused-take preview's RACES (#101), which the pure rules in
 * `lib/takes/paused-preview.ts` cannot reach (#160, L-1/L-2; QA review on
 * #657 asked for exactly this).
 *
 * Three mechanisms live in the hook and were uncovered: the epoch that drops a
 * decode whose take has moved on, the synchronous guard that refuses a second
 * decode before `"decoding"` has committed, and the promise chain that keeps
 * two full-PCM decodes from allocating together. Each one exists because of a
 * defect someone found, and none of them is observable from the pure helpers.
 *
 * `previewCapture` is a DEFERRED promise here, because every one of these is
 * about what happens while a decode is still in flight — the window a real
 * phone spends seconds in and a resolved mock spends none.
 *
 * ── One guard here is NOT covered, and this file will not imply that it is ──
 *
 * The `finally` releases `decodingRef` only when this decode still owns the
 * epoch. That the release HAPPENS is covered (delete it and "replays a
 * prepared preview" dies); the epoch CONDITION on it is not, and no mutation
 * found here kills it. The reason looks structural rather than accidental:
 * the condition can only matter in the window between a superseded decode's
 * `finally` and the newer decode's own, and `previewState` is `"decoding"`
 * throughout that window, so `requestPreview`'s first clause already refuses
 * every tap the ref would have refused. That is an argument, not a proof over
 * all interleavings, so the line stays as defence in depth — but nobody should
 * read this file as evidence for it.
 */

type Deferred = {
  promise: Promise<Int16Array | null>;
  settle: (v: Int16Array | null) => void;
  fail: (cause: Error) => void;
};
function deferred(): Deferred {
  let settle!: (v: Int16Array | null) => void;
  let fail!: (cause: Error) => void;
  const promise = new Promise<Int16Array | null>((res, rej) => {
    settle = res;
    fail = rej;
  });
  return { promise, settle, fail };
}

/** Drive a settled or rejected capture through to the hook's state. */
async function drain(d: Deferred) {
  await act(async () => {
    await d.promise.catch(() => {});
  });
}

let root: Root;
let host: HTMLDivElement;
let api: UsePausedPreview;
let pending: Deferred[];
const audio = {
  previewCapture: vi.fn(),
  playBuffer: vi.fn(),
  audioNeedsGesture: vi.fn(() => false),
};

const working = Int16Array.of(1, 2, 3, 4);
const captured = Int16Array.of(9, 9);

function Harness({ onCommit }: { onCommit: (a: UsePausedPreview) => void }) {
  const preview = usePausedPreview(audio);
  useEffect(() => {
    onCommit(preview);
  });
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  pending = [];
  audio.previewCapture.mockReset().mockImplementation(() => {
    const d = deferred();
    pending.push(d);
    return d.promise;
  });
  audio.playBuffer.mockReset();
  audio.audioNeedsGesture.mockReset().mockReturnValue(false);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root.render(createElement(Harness, { onCommit: (a) => (api = a) }));
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("usePausedPreview — the epoch", () => {
  it("DROPS a decode whose take has moved on, and does not sound it", async () => {
    // Play → Resume → the first decode finally resolves. Writing that result
    // now would play audio from a take that has since grown, into a live
    // recording (Frank + George R1). The epoch is what refuses it.
    act(() => api.requestPreview(working, 4));
    expect(api.previewState).toBe("decoding");

    act(() => api.cancelPreview()); // a resume: the take grows
    await act(async () => {
      pending[0]!.settle(captured);
      await pending[0]!.promise;
    });

    expect(api.preview).toBeNull();
    expect(audio.playBuffer).not.toHaveBeenCalled();
  });

  it("drops it after an ABORT too, while keeping any prepared buffer", async () => {
    // The ≡ menu and Back use `abortPreview`, which invalidates the decode but
    // deliberately leaves a prepared object on stage so the waveform does not
    // blank mid-commit (George R3 #1). A decode in flight is still refused.
    act(() => api.requestPreview(working, 4));
    act(() => api.abortPreview());
    await act(async () => {
      pending[0]!.settle(captured);
      await pending[0]!.promise;
    });

    expect(api.preview).toBeNull();
    expect(api.previewState).toBe("none"); // "decoding" reset by the abort
    expect(audio.playBuffer).not.toHaveBeenCalled();
  });

  it("keeps a decode that was never superseded", async () => {
    // The control case — without it, "drops it" could pass on a hook that
    // drops everything.
    act(() => api.requestPreview(working, 4));
    await act(async () => {
      pending[0]!.settle(captured);
      await pending[0]!.promise;
    });

    expect(api.preview?.buffer).toEqual(Int16Array.of(1, 2, 3, 4, 9, 9));
    expect(api.previewState).toBe("none");
    expect(audio.playBuffer).toHaveBeenCalledTimes(1);
  });
});

describe("usePausedPreview — the in-flight guard", () => {
  it("refuses a second tap landing before the decoding state commits", async () => {
    // Two taps in one frame both read last render's `previewState`. The ref is
    // what answers for the current moment — without it, a long take decodes
    // twice and two full PCM buffers exist at once (George R2 #3).
    act(() => {
      api.requestPreview(working, 4);
      api.requestPreview(working, 4);
    });
    expect(audio.previewCapture).toHaveBeenCalledTimes(1);

    // The count alone does not prove the guard: the promise chain would PARK a
    // second decode rather than refuse it, and park and refuse look identical
    // until the first decode finishes. Drain it — a refused tap has nothing
    // left to run, a parked one starts here.
    await act(async () => {
      pending[0]!.settle(captured);
      await pending[0]!.promise;
    });
    expect(audio.previewCapture).toHaveBeenCalledTimes(1);
  });
});

describe("usePausedPreview — the epoch, where nothing else answers", () => {
  it("does not disable Play when a SUPERSEDED decode is the one that failed", async () => {
    // The `"failed"` write is the epoch check's own work: a decode abandoned by
    // a resume can still come back null, and marking the take undecodable then
    // would disable Play on audio that was never tried. The post-splice checks
    // are downstream of this branch and cannot cover it.
    act(() => api.requestPreview(working, 4));
    act(() => api.cancelPreview());
    await act(async () => {
      pending[0]!.settle(null);
      await pending[0]!.promise;
    });

    expect(api.previewState).toBe("none");
  });

  it("does not START a parked decode whose take has moved on", async () => {
    // The check after the promise chain, before any capture. A decode waiting
    // its turn can be superseded while it waits; without that check it wakes up
    // and runs a full capture whose result is then thrown away — the second
    // simultaneous PCM buffer the chain exists to prevent, just deferred.
    act(() => api.requestPreview(working, 4));
    act(() => api.cancelPreview());
    act(() => api.requestPreview(working, 4)); // parked behind the first
    expect(audio.previewCapture).toHaveBeenCalledTimes(1);

    act(() => api.cancelPreview()); // supersedes the parked one too
    await act(async () => {
      pending[0]!.settle(captured);
      await pending[0]!.promise;
    });

    expect(audio.previewCapture).toHaveBeenCalledTimes(1);
    expect(api.preview).toBeNull();
    expect(audio.playBuffer).not.toHaveBeenCalled();
  });
});

describe("usePausedPreview — the promise chain", () => {
  it("SERIALISES decodes: the second waits for the first to finish its work", async () => {
    // Play → Resume → Play leaves the first decode running (a resume does not
    // abort it). Replacing the promise instead of chaining would let two
    // `decodeToCanonical` passes allocate together (George R5 #1).
    act(() => api.requestPreview(working, 4));
    expect(audio.previewCapture).toHaveBeenCalledTimes(1);

    act(() => api.cancelPreview());
    act(() => api.requestPreview(working, 4));
    // Still ONE: the second decode is parked behind the first's promise.
    expect(audio.previewCapture).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending[0]!.settle(captured);
      await pending[0]!.promise;
    });
    // The first's work is done, so the second may start — and its own result
    // is the one that counts.
    expect(audio.previewCapture).toHaveBeenCalledTimes(2);
  });
});

describe("usePausedPreview — what a failed decode does", () => {
  it("reports a container this device cannot decode, rather than a false preview", async () => {
    // iOS writes the moov atom only on stop, so a paused container may simply
    // not be decodable here. Play degrades to disabled with a Notice.
    act(() => api.requestPreview(working, 4));
    await act(async () => {
      pending[0]!.settle(null);
      await pending[0]!.promise;
    });

    expect(api.previewState).toBe("failed");
    expect(api.preview).toBeNull();
    expect(audio.playBuffer).not.toHaveBeenCalled();
  });

  it("does NOT report a failure the take has already moved past", async () => {
    // The `catch` carries the same epoch condition the success path does, and
    // nothing else covers it: a decode that throws AFTER a resume would
    // otherwise disable Play on a take whose audio was never attempted — the
    // failure mode is permanent, because "failed" survives an abort (below).
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      act(() => api.requestPreview(working, 4));
      act(() => api.cancelPreview()); // a resume: the take grows
      pending[0]!.fail(new Error("out of memory"));
      await drain(pending[0]!);

      expect(api.previewState).toBe("none");
      // Still logged — a swallowed OOM is its own defect (George R1 P5).
      expect(errors).toHaveBeenCalledTimes(1);
    } finally {
      errors.mockRestore();
    }
  });

  it("keeps that failure across an abort, so Play is not re-enabled to fail again", async () => {
    act(() => api.requestPreview(working, 4));
    await act(async () => {
      pending[0]!.settle(null);
      await pending[0]!.promise;
    });
    act(() => api.abortPreview());
    expect(api.previewState).toBe("failed");
  });
});

describe("usePausedPreview — the gesture rule", () => {
  it("prepares but does NOT sound when the context needs a gesture", async () => {
    // The decode resolves outside the Play tap's activation, so an iOS context
    // left "interrupted" during it would sound a silent preview that looks
    // like it is playing (George R9). The prepared buffer stays on stage so
    // the next tap replays it in-gesture.
    audio.audioNeedsGesture.mockReturnValue(true);
    act(() => api.requestPreview(working, 4));
    await act(async () => {
      pending[0]!.settle(captured);
      await pending[0]!.promise;
    });

    expect(api.preview).not.toBeNull();
    expect(audio.playBuffer).not.toHaveBeenCalled();
  });

  it("replays a prepared preview without decoding again", async () => {
    act(() => api.requestPreview(working, 4));
    await act(async () => {
      pending[0]!.settle(captured);
      await pending[0]!.promise;
    });
    audio.playBuffer.mockClear();

    act(() => api.requestPreview(working, 4));
    expect(audio.previewCapture).toHaveBeenCalledTimes(1); // no second decode
    expect(audio.playBuffer).toHaveBeenCalledTimes(1);
  });
});
