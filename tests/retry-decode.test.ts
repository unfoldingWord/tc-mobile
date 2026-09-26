import { describe, expect, it } from "vitest";

import { decodeRetry } from "@/lib/audio/retry-decode";

/**
 * The retry's empty-vs-throw choice (#745), extracted from `use-recorder.ts`'s
 * `retryDecode` so it is tested here rather than grepped for.
 *
 * `retryDecode` keeps the held bytes on every failure, so neither code below
 * decides what is kept. What they decide is the sentence a translator reads.
 */
describe("decodeRetry", () => {
  it('reports a rejected decode as "undecodable", never "silence" (#700 round 6)', async () => {
    // The costly swap: the container failed to decode, the only copy is still
    // on the device, and "silence" would tell them nothing was heard.
    const result = await decodeRetry(() =>
      Promise.reject(new Error("EncodingError"))
    );
    expect(result).toEqual({ samples: null, error: "undecodable" });
  });

  it("reports a decode that throws synchronously the same way", async () => {
    // Never throws: a decode that fails before returning a promise is still a
    // result, so the caller's recovery panel always gets a code.
    const result = await decodeRetry(() => {
      throw new Error("sync");
    });
    expect(result).toEqual({ samples: null, error: "undecodable" });
  });

  it('reports a zero-sample decode as "silence", with no samples', async () => {
    const result = await decodeRetry(() => Promise.resolve(new Int16Array(0)));
    expect(result).toEqual({ samples: null, error: "silence" });
  });

  it("returns usable samples with no error", async () => {
    const samples = new Int16Array([1, 2, 3]);
    const result = await decodeRetry(() => Promise.resolve(samples));
    expect(result.samples).toBe(samples);
    expect(result.error).toBeNull();
  });

  it("calls the decode synchronously, before its first await", () => {
    // `retryDecode` resumes the AudioContext in the tap, then decodes. The
    // decode must start in the same synchronous turn, so the hook's ordering
    // is not undone by a deferred start here.
    let called = false;
    void decodeRetry(() => {
      called = true;
      return Promise.resolve(new Int16Array(1));
    });
    expect(called).toBe(true);
  });
});
