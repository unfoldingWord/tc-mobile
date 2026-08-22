/**
 * Parsers for the two timing formats worth supporting.
 *
 * Both are pure functions over text, so they are unit-tested without a network
 * or a provider. That is the point of keeping them separate from the registry:
 * when real data finally appears, the parsing is already known-good.
 */

import type { FrameTiming } from "@/types/timing";

/** `00:01:23.456` or `01:23.456` → milliseconds. */
export function parseTimecode(raw: string): number {
  const text = raw.trim().replace(",", ".");
  const parts = text.split(":");
  if (parts.length < 2 || parts.length > 3) {
    throw new Error(`Malformed timecode: "${raw}"`);
  }
  const seconds = Number(parts.at(-1));
  const minutes = Number(parts.at(-2));
  const hours = parts.length === 3 ? Number(parts[0]) : 0;
  if (![seconds, minutes, hours].every(Number.isFinite)) {
    throw new Error(`Malformed timecode: "${raw}"`);
  }
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
}

/**
 * Parse WebVTT where each cue's identifier is the frame number.
 *
 * This is the shape a hand-authored timing file would most likely take, and
 * the one a facilitator could produce with ordinary subtitle tooling.
 */
export function parseWebVtt(text: string): FrameTiming[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: FrameTiming[] = [];
  let pendingId: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed === "WEBVTT" || trimmed.startsWith("NOTE")) {
      pendingId = null;
      continue;
    }

    const arrow = trimmed.split("-->");
    if (arrow.length === 2) {
      // The frame number comes from the cue identifier on the previous line.
      // Cues without one are skipped rather than guessed at — a mis-numbered
      // frame points scripture audio at the wrong picture.
      const frame = Number(pendingId);
      pendingId = null;
      if (!Number.isInteger(frame) || frame < 1) continue;
      out.push({
        frame,
        startMs: parseTimecode(arrow[0]!),
        // trim() before splitting: "--> 00:00:11.566 align:start" leaves a
        // leading space, and splitting on whitespace first yields "".
        endMs: parseTimecode(arrow[1]!.trim().split(/\s+/)[0]!),
      });
      continue;
    }

    pendingId = trimmed;
  }

  return out.sort((a, b) => a.frame - b.frame);
}

/**
 * Parse a Scripture Burrito alignment document of `type: "audio-reference"`.
 *
 * Shape (docs/research/prior-art.md §4):
 *
 *   groups[].records[].references = [ ["00:00:00.000 --> 00:00:11.566"],
 *                                     ["OBS 1:3"] ]
 *
 * The reference side is `<BOOK> <chapter>:<frame>`; only the frame is taken,
 * because the caller already knows which chapter it asked for.
 */
export function parseBurritoAlignment(doc: unknown): FrameTiming[] {
  const root = doc as {
    type?: string;
    groups?: { records?: { references?: string[][] }[] }[];
  };
  if (root?.type !== "audio-reference") {
    throw new Error(
      `Not an audio-reference alignment document (type: ${String(root?.type)})`
    );
  }

  const out: FrameTiming[] = [];
  for (const group of root.groups ?? []) {
    for (const record of group.records ?? []) {
      const [timecodes, refs] = record.references ?? [];
      const span = timecodes?.[0];
      const ref = refs?.[0];
      if (!span || !ref) continue;

      const arrow = span.split("-->");
      if (arrow.length !== 2) continue;

      const verse = /:(\d+)\s*$/.exec(ref);
      if (!verse) continue;

      out.push({
        frame: Number(verse[1]),
        startMs: parseTimecode(arrow[0]!),
        endMs: parseTimecode(arrow[1]!),
      });
    }
  }
  return out.sort((a, b) => a.frame - b.frame);
}

/**
 * Reject timing that would point at the wrong audio.
 *
 * The contract a `ChapterTiming` must satisfy before anything downstream may
 * trust it: frame numbers are 1-based integers, strictly increasing (so also
 * unique), timestamps are finite and non-negative, every span runs forward, and
 * no span overlaps its predecessor.
 *
 * Overlapping or reversed spans are the failure mode that produces a
 * confidently-wrong playhead, which is worse than having no timing at all. ADR
 * 0007 makes that the rule at this boundary: reject, never coerce. Sorting,
 * filtering or clamping here would hide the fault in the provider that emitted
 * it — if a provider needs its frames sorted, it sorts them before returning.
 *
 * The checks run identity → frame ordering → finiteness → sign → span → overlap
 * because each stage may only use values an earlier stage has already proven
 * usable. Finiteness in particular must precede every relational test: NaN makes
 * `<` and `<=` false, so an unchecked NaN satisfies the ordering guards and
 * survives all the way to `frameAt`, which can then never match it.
 *
 * Fractional milliseconds are accepted deliberately. Sub-millisecond precision
 * cannot produce a wrong playhead, so rejecting it would only refuse legitimate
 * provider data. Only frame *numbers* must be integers.
 */
export function validateFrameTimings(frames: readonly FrameTiming[]): void {
  let previousFrame: number | null = null;
  let previousEnd = 0;

  for (const [index, f] of frames.entries()) {
    // Identity first: without a usable frame number, no later message can name
    // the frame it is complaining about.
    if (!Number.isInteger(f.frame) || f.frame < 1) {
      throw new Error(
        `Invalid frame number ${String(f.frame)} at index ${index}: frames are 1-based integers`
      );
    }
    // Strict monotonicity is what enforces uniqueness; the equality branch
    // exists only so an adjacent duplicate is named as a duplicate.
    if (previousFrame !== null && f.frame === previousFrame) {
      throw new Error(`Frame ${f.frame} appears more than once`);
    }
    if (previousFrame !== null && f.frame < previousFrame) {
      throw new Error(
        `Frame ${f.frame} is out of order after frame ${previousFrame}`
      );
    }
    // Before any timestamp comparison — see the note on NaN above.
    if (!Number.isFinite(f.startMs) || !Number.isFinite(f.endMs)) {
      throw new Error(
        `Frame ${f.frame} has a non-finite timestamp (startMs=${String(f.startMs)}, endMs=${String(f.endMs)})`
      );
    }
    if (f.startMs < 0 || f.endMs < 0) {
      throw new Error(
        `Frame ${f.frame} has a negative timestamp (startMs=${String(f.startMs)}, endMs=${String(f.endMs)})`
      );
    }
    if (f.endMs <= f.startMs) {
      throw new Error(`Frame ${f.frame} ends before it starts`);
    }
    // `previousEnd` starts at 0 rather than a negative sentinel: a negative
    // start can no longer reach this line, and a sentinel below zero made the
    // first frame report an overlap with a previous frame that does not exist.
    if (f.startMs < previousEnd) {
      throw new Error(`Frame ${f.frame} overlaps the previous frame`);
    }

    previousFrame = f.frame;
    previousEnd = f.endMs;
  }
}
