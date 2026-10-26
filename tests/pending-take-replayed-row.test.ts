import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearFailureLog,
  flushFailureLog,
  installFailureLog,
  readFailureLog,
} from "@/hooks/failure-log";
import {
  replayPendingTakes,
  type ReplayTake,
} from "@/hooks/replay-pending-takes";
import { performResumeTake } from "@/hooks/use-save-take";
import { lightsFailureMarker } from "@/lib/failure-marker";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { addChapter, addSegment, createBook } from "@/lib/storage/books";
import { newClipId } from "@/lib/storage/clips";
import { getDb } from "@/lib/storage/db";
import { countMarkedFailures } from "@/lib/storage/failures";
import { writePendingTake } from "@/lib/storage/pending-takes";
import { saveTake } from "@/lib/storage/takes";
import type { PendingTake } from "@/lib/takes/pending-take";
import type { SegmentId } from "@/types/domain";
import { clearAllStores, ramp } from "./support";

/**
 * The informational row a launch replay writes when it saves a waiting take
 * (#38; the DRI's pick on PR #1706, verbatim: "A: one text round + log row
 * (Recommended)"). The replay itself stays quiet on screen; this row is how a
 * tester confirms through Send log that a waiting take existed and was saved.
 *
 * Driven through the real path: a row held by the real hold, the real
 * `replayPendingTakes`, the real `performResumeTake` and conditional commit,
 * and the durable log the app installs, all on `fake-indexeddb`.
 *
 * The failure log is not telemetry: a launch with nothing waiting, and a
 * replay that finds the take already saved, write nothing.
 */

const freshSegment = async (): Promise<SegmentId> => {
  const book = await createBook(`b-${crypto.randomUUID()}`);
  const chapter = await addChapter(book.id);
  return (await addSegment(chapter.id)).id;
};

const firstTake = (segmentId: SegmentId): ReplayTake => ({
  segmentId,
  ordinal: 3,
  clipId: newClipId(),
  existing: new Int16Array(0),
  recorded: ramp(40),
  offset: 0,
  finished: false,
  editOnly: false,
  baseRevision: 0,
  baseGeneration: null,
});

/** The launch replay as `useSaveTake`'s effect runs it, over a modelled slot. */
const launch = (
  before?: (take: ReplayTake) => Promise<void>
): Promise<void> => {
  let held: PendingTake | null = null;
  const effects = {
    update: (t: (h: PendingTake | null) => PendingTake | null) => {
      held = t(held);
    },
    requestSweep: () => {},
  };
  return replayPendingTakes(async (take) => {
    await before?.(take);
    return (await performResumeTake(held, take, effects)) === true;
  });
};

const loggedContexts = async (): Promise<string[]> => {
  await flushFailureLog();
  return (await readFailureLog()).entries.map((e) => e.context);
};

let uninstall: (() => void) | null = null;

beforeEach(async () => {
  await clearAllStores();
  await clearFailureLog();
  uninstall = installFailureLog();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  uninstall?.();
  uninstall = null;
  vi.restoreAllMocks();
});

describe("a launch replay that saves a waiting take writes one informational row", () => {
  it("a replayed take writes exactly one pending-take-replayed row, and it does not light ≡", async () => {
    const segmentId = await freshSegment();
    const t = firstTake(segmentId);
    expect(await writePendingTake(t)).toEqual({ ok: true, outcome: "written" });

    await launch();

    expect(await loggedContexts()).toEqual(["pending-take-replayed"]);
    expect(await countMarkedFailures()).toBe(0);
  });

  it("a second launch after the save writes nothing more (one row per saved take, not per launch)", async () => {
    const segmentId = await freshSegment();
    expect(await writePendingTake(firstTake(segmentId))).toMatchObject({
      ok: true,
    });

    await launch();
    await launch();

    expect(await loggedContexts()).toEqual(["pending-take-replayed"]);
  });

  it("a launch with nothing waiting writes no row", async () => {
    await launch();

    expect(await loggedContexts()).toEqual([]);
  });

  it("a replay that finds the take already saved by another copy writes no row", async () => {
    const segmentId = await freshSegment();
    const t = firstTake(segmentId);
    expect(await writePendingTake(t)).toMatchObject({ ok: true });

    await launch(async (take) => {
      // Another copy finishes this very take after the replay read its row.
      await saveTake(
        segmentId,
        take.clipId,
        take.recorded,
        CANONICAL_SAMPLE_RATE
      );
    });

    expect(await (await getDb()).count("takes")).toBe(1);
    expect(await loggedContexts()).toEqual([]);
  });
});

describe("the marker", () => {
  it("pending-take-replayed is informational: logged, never lights ≡", () => {
    expect(lightsFailureMarker("pending-take-replayed")).toBe(false);
  });
});
