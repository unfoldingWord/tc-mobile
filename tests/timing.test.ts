import { afterEach, describe, expect, it } from "vitest";

import {
  burritoTimingProvider,
  clearTimingProviders,
  frameAt,
  frameStart,
  listTimingProviders,
  loadChapterTiming,
  parseBurritoAlignment,
  parseTimecode,
  parseWebVtt,
  registerTimingProvider,
  staticTimingProvider,
  validateFrameTimings,
  webVttProvider,
} from "@/lib/timing";
import type { ChapterTiming, TimingProvider } from "@/types/timing";

afterEach(() => clearTimingProviders());

const OBS1 = { book: "OBS", chapter: 1 };

describe("parseTimecode", () => {
  it("reads hh:mm:ss.mmm and mm:ss.mmm", () => {
    expect(parseTimecode("00:00:11.566")).toBe(11566);
    expect(parseTimecode("01:23.456")).toBe(83456);
    expect(parseTimecode("00:01:00.000")).toBe(60000);
  });

  it("carries the hours field into the result", () => {
    // Every other case here has `hh` = 00, so dropping the hours term from the
    // arithmetic entirely leaves them all passing. An hour is not hypothetical
    // in a chapter-length narration, and the failure is silent: the playhead
    // lands an hour early on a real timestamp.
    expect(parseTimecode("01:00:00.000")).toBe(3_600_000);
    expect(parseTimecode("02:03:04.500")).toBe(7_384_500);
  });

  it("accepts the comma decimal separator SRT uses", () => {
    expect(parseTimecode("00:00:11,500")).toBe(11500);
  });

  it("throws rather than returning a plausible wrong time", () => {
    for (const bad of ["nope", "1", "", "a:b:c", "1:2:3:4"]) {
      expect(() => parseTimecode(bad), bad).toThrow(/Malformed timecode/);
    }
  });
});

describe("parseWebVtt", () => {
  const vtt = `WEBVTT

NOTE this file is a fixture

1
00:00:00.000 --> 00:00:11.566
The creation

3
00:00:28.425 --> 00:00:40.000
Third frame

2
00:00:11.566 --> 00:00:28.425
Second frame
`;

  it("uses the cue identifier as the frame number and sorts by it", () => {
    expect(parseWebVtt(vtt)).toEqual([
      { frame: 1, startMs: 0, endMs: 11566 },
      { frame: 2, startMs: 11566, endMs: 28425 },
      { frame: 3, startMs: 28425, endMs: 40000 },
    ]);
  });

  it("skips cues with no usable frame identifier rather than guessing", () => {
    // A mis-numbered frame points scripture audio at the wrong picture.
    const out = parseWebVtt(`WEBVTT

00:00:00.000 --> 00:00:05.000
no identifier

banana
00:00:05.000 --> 00:00:09.000
non-numeric identifier
`);
    expect(out).toEqual([]);
  });

  it("ignores the cue settings WebVTT allows after the end timestamp", () => {
    // `align:start` and friends are legal WebVTT and are what ordinary
    // subtitle tooling emits — the shape parse.ts:57 says it strips. Without
    // the strip the whole cue is not merely skipped: `parseTimecode` sees
    // "00:00:11.566 align:start", splits it into four parts and throws, so one
    // stray setting takes down the entire file.
    const out = parseWebVtt(`WEBVTT

1
00:00:00.000 --> 00:00:11.566 align:start position:0%
The creation
`);
    expect(out).toEqual([{ frame: 1, startMs: 0, endMs: 11566 }]);
  });

  it("handles CRLF line endings", () => {
    const out = parseWebVtt(
      "WEBVTT\r\n\r\n1\r\n00:00:00.000 --> 00:00:02.000\r\nx\r\n"
    );
    expect(out).toHaveLength(1);
  });
});

describe("parseBurritoAlignment", () => {
  // Shaped after the real APM-emitted document in docs/research/prior-art.md §4.
  const doc = {
    format: "alignment",
    version: "0.4",
    type: "audio-reference",
    roles: ["timecode", "text-reference"],
    groups: [
      {
        documents: [
          { scheme: "vtt-timecode" },
          { scheme: "usfm-scripture-reference" },
        ],
        records: [
          { references: [["000:00:00.000 --> 000:00:11.566"], ["OBS 1:1"]] },
          { references: [["000:00:11.566 --> 000:00:28.425"], ["OBS 1:2"]] },
        ],
      },
    ],
  };

  it("extracts frame spans from records", () => {
    expect(parseBurritoAlignment(doc)).toEqual([
      { frame: 1, startMs: 0, endMs: 11566 },
      { frame: 2, startMs: 11566, endMs: 28425 },
    ]);
  });

  it("rejects a document that is not an audio-reference alignment", () => {
    expect(() => parseBurritoAlignment({ type: "translation" })).toThrow(
      /audio-reference/
    );
  });
});

describe("validateFrameTimings", () => {
  it("accepts ordered, non-overlapping spans", () => {
    expect(() =>
      validateFrameTimings([
        { frame: 1, startMs: 0, endMs: 100 },
        { frame: 2, startMs: 100, endMs: 200 },
      ])
    ).not.toThrow();
  });

  it("rejects a reversed span", () => {
    expect(() =>
      validateFrameTimings([{ frame: 1, startMs: 500, endMs: 100 }])
    ).toThrow(/ends before it starts/);
  });

  it("rejects a zero-length span", () => {
    // `frameAt` matches on `positionMs >= startMs && positionMs < endMs`
    // (registry.ts:76), so a frame whose span is empty can never be the frame
    // sounding at any position — the same "frame that can never be matched"
    // failure the non-finite guard exists to prevent, reached by a different
    // route. This is what the `<=` in the span check is carrying: with `<` the
    // whole rest of this file still passes.
    expect(() =>
      validateFrameTimings([{ frame: 1, startMs: 100, endMs: 100 }])
    ).toThrow(/ends before it starts/);
  });

  it("rejects overlapping spans", () => {
    expect(() =>
      validateFrameTimings([
        { frame: 1, startMs: 0, endMs: 200 },
        { frame: 2, startMs: 100, endMs: 300 },
      ])
    ).toThrow(/overlaps/);
  });

  // What follows guards issue #7. The claim, scoped to what was actually
  // checked: `git show develop:src/lib/timing/parse.ts` was executed against
  // every input below, and it ACCEPTED all of them except two, which it
  // rejected with the wrong reason — those two are marked inline. NaN is why
  // most of them got through: it makes every relational operator false, so an
  // unchecked non-finite timestamp satisfies both the span and the overlap
  // guard and reaches `frameAt`, which can then never match it.
  //
  // The last two cases in this block assert acceptance, not rejection. They
  // are over-strictness guards on the new rule and hold identically under the
  // old one; they are not evidence of anything the old rule let through.
  it("rejects a NaN startMs", () => {
    expect(() =>
      validateFrameTimings([{ frame: 1, startMs: NaN, endMs: 5000 }])
    ).toThrow(/non-finite timestamp/);
  });

  it("rejects a NaN endMs", () => {
    expect(() =>
      validateFrameTimings([{ frame: 1, startMs: 0, endMs: NaN }])
    ).toThrow(/non-finite timestamp/);
  });

  it("stops a NaN endMs from disabling the overlap check for later frames", () => {
    // The old loop carried NaN forward as `previousEnd`, so every subsequent
    // `startMs < previousEnd` was false and this whole list was accepted.
    expect(() =>
      validateFrameTimings([
        { frame: 1, startMs: 0, endMs: NaN },
        { frame: 2, startMs: 50, endMs: 100 },
      ])
    ).toThrow(/Frame 1 has a non-finite/);
  });

  it("rejects an infinite endMs", () => {
    expect(() =>
      validateFrameTimings([{ frame: 1, startMs: 0, endMs: Infinity }])
    ).toThrow(/non-finite timestamp/);
  });

  it("names -Infinity as non-finite rather than as an overlap", () => {
    // One of the two the old rule did reject, and it rejected it for the wrong
    // reason: the `previousEnd = -1` sentinel made the *first* frame report an
    // overlap with a previous frame that does not exist. Verified by running
    // develop's `validateFrameTimings` on this input — it threw
    // "Frame 1 overlaps the previous frame".
    expect(() =>
      validateFrameTimings([{ frame: 1, startMs: -Infinity, endMs: 100 }])
    ).toThrow(
      "Frame 1 has a non-finite timestamp (startMs=-Infinity, endMs=100)"
    );
  });

  it("rejects a negative startMs", () => {
    expect(() =>
      validateFrameTimings([{ frame: 1, startMs: -1, endMs: 100 }])
    ).toThrow(/negative timestamp/);
  });

  it("rejects a negative endMs as a sign fault, not a reversed span", () => {
    // The other one the old rule rejected with the wrong reason: verified by
    // running develop's `validateFrameTimings` on this input — it threw
    // "Frame 1 ends before it starts", blaming the ordering rather than the
    // sign, so the message pointed a reader at the wrong field.
    expect(() =>
      validateFrameTimings([{ frame: 1, startMs: 0, endMs: -5 }])
    ).toThrow(/negative timestamp/);
  });

  it("rejects frame 0 — frames are 1-based", () => {
    expect(() =>
      validateFrameTimings([{ frame: 0, startMs: 0, endMs: 100 }])
    ).toThrow(/Invalid frame number 0 at index 0/);
  });

  it("rejects a negative frame number", () => {
    expect(() =>
      validateFrameTimings([{ frame: -3, startMs: 0, endMs: 100 }])
    ).toThrow(/Invalid frame number -3/);
  });

  it("rejects a fractional frame number", () => {
    expect(() =>
      validateFrameTimings([{ frame: 1.5, startMs: 0, endMs: 100 }])
    ).toThrow(/1-based integers/);
  });

  it("rejects a NaN frame number", () => {
    expect(() =>
      validateFrameTimings([{ frame: NaN, startMs: 0, endMs: 100 }])
    ).toThrow(/Invalid frame number NaN/);
  });

  it("rejects a repeated frame number", () => {
    // Duplicates make `frameStart`'s `.find` silently pick the first match.
    expect(() =>
      validateFrameTimings([
        { frame: 1, startMs: 0, endMs: 100 },
        { frame: 1, startMs: 100, endMs: 200 },
      ])
    ).toThrow(/appears more than once/);
  });

  it("rejects frames that are not in ascending order", () => {
    // Both shipped parsers sort, so unsorted frames can only come from a
    // provider — which is exactly the untrusted boundary this guards.
    expect(() =>
      validateFrameTimings([
        { frame: 2, startMs: 0, endMs: 100 },
        { frame: 1, startMs: 100, endMs: 200 },
      ])
    ).toThrow(/is out of order after frame 2/);
  });

  it("reports a non-adjacent repeat as out of order", () => {
    // Uniqueness falls out of strict monotonicity rather than a Set, so a
    // repeat that is not adjacent is named by the ordering rule. Pinned here
    // so the wording reads as a decision rather than a bug.
    expect(() =>
      validateFrameTimings([
        { frame: 1, startMs: 0, endMs: 100 },
        { frame: 2, startMs: 100, endMs: 200 },
        { frame: 1, startMs: 200, endMs: 300 },
      ])
    ).toThrow(/out of order/);
  });

  it("accepts fractional milliseconds", () => {
    // Only frame numbers must be integers: sub-millisecond precision cannot
    // produce a wrong playhead, so refusing it would refuse good data.
    expect(() =>
      validateFrameTimings([{ frame: 1, startMs: 0.5, endMs: 100.25 }])
    ).not.toThrow();
  });

  it("accepts an empty list", () => {
    // Zero frames is "nothing here", decided by the provider before this runs.
    expect(() => validateFrameTimings([])).not.toThrow();
  });
});

describe("registry", () => {
  const timing: ChapterTiming = {
    ref: OBS1,
    audioUrl: "https://example.test/obs-01.mp3",
    providerId: "fixture",
    frames: [
      { frame: 1, startMs: 0, endMs: 1000 },
      { frame: 2, startMs: 1000, endMs: 2500 },
    ],
  };

  it("returns null when nothing is registered — today's honest state", () => {
    expect(listTimingProviders()).toHaveLength(0);
    return expect(loadChapterTiming(OBS1)).resolves.toEqual({
      timing: null,
      errors: [],
    });
  });

  it("returns the first provider that has an answer", async () => {
    registerTimingProvider(staticTimingProvider("empty", []));
    registerTimingProvider(staticTimingProvider("fixture", [timing]));
    const { timing: got } = await loadChapterTiming(OBS1);
    expect(got?.providerId).toBe("fixture");
  });

  it("steps past a throwing provider but reports it", async () => {
    const broken: TimingProvider = {
      id: "broken",
      describe: "always fails",
      load: () => Promise.reject(new Error("disk on fire")),
    };
    registerTimingProvider(broken);
    registerTimingProvider(staticTimingProvider("fixture", [timing]));

    const result = await loadChapterTiming(OBS1);
    expect(result.timing?.providerId).toBe("fixture");
    expect(result.errors).toEqual([
      { providerId: "broken", message: "disk on fire" },
    ]);
  });

  it("rejects timing that would produce a wrong playhead", async () => {
    registerTimingProvider(
      staticTimingProvider("overlapping", [
        {
          ...timing,
          frames: [
            { frame: 1, startMs: 0, endMs: 2000 },
            { frame: 2, startMs: 1000, endMs: 3000 },
          ],
        },
      ])
    );
    const result = await loadChapterTiming(OBS1);
    expect(result.timing).toBeNull();
    expect(result.errors[0]?.message).toMatch(/overlaps/);
  });

  it("rejects timing whose frames can never be matched", async () => {
    // A non-finite startMs used to pass validation and then fail every
    // `frameAt` comparison, which is the silent version of no timing at all.
    registerTimingProvider(
      staticTimingProvider("non-finite", [
        { ...timing, frames: [{ frame: 1, startMs: NaN, endMs: 5000 }] },
      ])
    );
    const result = await loadChapterTiming(OBS1);
    expect(result.timing).toBeNull();
    expect(result.errors[0]?.message).toMatch(/non-finite timestamp/);
  });

  it("refuses to register the same id twice", () => {
    registerTimingProvider(staticTimingProvider("dup", []));
    expect(() =>
      registerTimingProvider(staticTimingProvider("dup", []))
    ).toThrow(/already registered/);
  });

  it("locates the frame sounding at a position", () => {
    expect(frameAt(timing, 0)).toBe(1);
    expect(frameAt(timing, 999)).toBe(1);
    expect(frameAt(timing, 1000)).toBe(2);
    expect(frameAt(timing, 9999)).toBeNull();
  });

  it("locates a frame's span", () => {
    expect(frameStart(timing, 2)).toEqual({ startMs: 1000, endMs: 2500 });
    expect(frameStart(timing, 99)).toBeNull();
  });
});

describe("remote providers", () => {
  const vtt = "WEBVTT\n\n1\n00:00:00.000 --> 00:00:05.000\nx\n";

  const fakeFetch = (status: number, body: string) =>
    (() =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        statusText: String(status),
        text: () => Promise.resolve(body),
        json: () => Promise.resolve(JSON.parse(body)),
      })) as unknown as typeof fetch;

  it("treats 404 as 'nothing here', not a fault", async () => {
    const p = webVttProvider({
      id: "vtt",
      url: () => "https://example.test/a.vtt",
      audioUrl: () => "https://example.test/a.mp3",
      fetchImpl: fakeFetch(404, ""),
    });
    await expect(p.load(OBS1)).resolves.toBeNull();
  });

  it("throws on a real transport failure", async () => {
    const p = webVttProvider({
      id: "vtt",
      url: () => "https://example.test/a.vtt",
      audioUrl: () => "https://example.test/a.mp3",
      fetchImpl: fakeFetch(500, ""),
    });
    await expect(p.load(OBS1)).rejects.toThrow(/500/);
  });

  it("returns null when the provider does not cover the reference", async () => {
    const p = webVttProvider({
      id: "vtt",
      url: (ref) => (ref.book === "GEN" ? "https://example.test/a.vtt" : null),
      audioUrl: () => "https://example.test/a.mp3",
      fetchImpl: fakeFetch(200, vtt),
    });
    await expect(p.load(OBS1)).resolves.toBeNull();
  });

  it("parses a served VTT into chapter timing", async () => {
    const p = webVttProvider({
      id: "vtt",
      url: () => "https://example.test/a.vtt",
      audioUrl: () => "https://example.test/a.mp3",
      fetchImpl: fakeFetch(200, vtt),
    });
    const got = await p.load(OBS1);
    expect(got?.frames).toEqual([{ frame: 1, startMs: 0, endMs: 5000 }]);
    expect(got?.audioUrl).toBe("https://example.test/a.mp3");
  });

  it("parses a served burrito alignment", async () => {
    const doc = JSON.stringify({
      type: "audio-reference",
      groups: [
        {
          records: [
            { references: [["00:00:00.000 --> 00:00:04.000"], ["OBS 1:1"]] },
          ],
        },
      ],
    });
    const p = burritoTimingProvider({
      id: "sb",
      url: () => "https://example.test/a.json",
      audioUrl: () => "https://example.test/a.mp3",
      fetchImpl: fakeFetch(200, doc),
    });
    const got = await p.load(OBS1);
    expect(got?.frames).toEqual([{ frame: 1, startMs: 0, endMs: 4000 }]);
  });
});
