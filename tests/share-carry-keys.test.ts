import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import {
  bookShareItems,
  chapterShareItems,
  shareO4View,
  type ShareChip,
} from "@/components/share-o4-view";
import { stepReporter } from "@/hooks/share-flow";
import {
  HIDDEN,
  carryFromPrepare,
  reduceShareProgress,
  type ShareCarry,
  type ShareProgress,
  type ShareProgressEvent,
} from "@/hooks/share-progress";
import { CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { exportBookZip } from "@/lib/export/book";
import { exportChapterMp3, withEncodeSteps } from "@/lib/export/chapter";
import {
  addChapter,
  addSegment,
  createBook,
  resolveBookChapters,
} from "@/lib/storage/books";
import { newClipId } from "@/lib/storage/clips";
import { getDb } from "@/lib/storage/db";
import { saveTake } from "@/lib/storage/takes";
import type { ChapterId, ClipId, SegmentId } from "@/types/domain";
import type { ChapterRow, SegmentRow } from "@/types/view";
import { clearAllStores, testCodec } from "./support";

/**
 * #1044: the export names the items it counted (`keys`), and that list rides
 * from the export's step reports through the progress machine and the carry
 * to the O4 chips. An export leaves some items out BEFORE it fixes its count
 * (a segment with no resolvable audio, a dangling chapter id), so the chips
 * cannot map count positions onto the screen's items by position; these
 * cases run the real export, the real reporter and the real reducer, and read
 * the chips the O4 view draws from the result.
 */

beforeEach(clearAllStores);

const samples = (n: number, value: number): Int16Array =>
  Int16Array.from({ length: n }, () => value);

/** A chip row: `-` stays, `o` waiting, `v` finished, `*` current. */
function row(chips: readonly ShareChip[]): string {
  const mark = { stays: "-", waiting: "o", finished: "v", current: "*" };
  return chips.map((c) => mark[c.state]).join("");
}

/** A reducer the reporter dispatches into, starting from a busy prepare. */
function machine() {
  let state = reduceShareProgress(HIDDEN, {
    type: "begin",
    work: "prepare",
    now: 0,
  });
  const dispatch = (event: ShareProgressEvent): void => {
    state = reduceShareProgress(state, event);
  };
  return { dispatch, state: () => state };
}

/** A busy send carrying the prepare's snapshot, as `useShareFlow` builds it. */
function sendCarrying(carried: ShareCarry): ShareProgress {
  const send = reduceShareProgress(HIDDEN, {
    type: "begin",
    work: "send",
    now: 0,
  });
  return reduceShareProgress(send, { type: "carry", carried });
}

function segmentRow(ordinal: number, clipId: ClipId): SegmentRow {
  return {
    segmentId: `s${ordinal}` as SegmentId,
    ordinal,
    label: null,
    hasClip: true,
    finished: false,
    clipId,
    peaks: null,
    durationMs: null,
  };
}

function chapterRow(chapterId: ChapterId, number: number): ChapterRow {
  return {
    chapterId,
    number,
    name: null,
    finishedCount: 0,
    totalCount: 1,
    recordedCount: 1,
  };
}

describe("Share Chapter: a segment left out before the count (#1044)", () => {
  it("is grey on the chips, through the prepare and the hand-off", async () => {
    const book = await createBook("b");
    const chapter = await addChapter(book.id);
    // The screen read three segments with playable audio; the middle one's
    // take was gone by the time the gather walked the chapter.
    const clipIds = [newClipId(), newClipId(), newClipId()];
    for (const [i, clipId] of clipIds.entries()) {
      const seg = await addSegment(chapter.id);
      if (i !== 1)
        await saveTake(
          seg.id,
          clipId,
          samples(100, i + 1),
          CANONICAL_SAMPLE_RATE
        );
    }
    const screen = chapterShareItems(
      clipIds.map((clipId, i) => segmentRow(i + 1, clipId))
    );
    const m = machine();
    const onStep = stepReporter(() => true, m.dispatch);

    const result = await withEncodeSteps(
      onStep,
      () => true,
      (codec, inner) => exportChapterMp3(chapter.id, codec, undefined, inner)
    )(testCodec());

    expect(result?.segments).toBe(2);
    const after = m.state();
    expect(after.phase === "busy" && after.steps?.keys).toEqual([
      clipIds[0],
      clipIds[2],
    ]);
    if (after.phase !== "busy") throw new Error("expected a busy prepare");
    expect(row(shareO4View(after, "chapter", screen).chips)).toBe("v-v");
    const carried = carryFromPrepare(after);
    expect(carried).toBeDefined();
    const send = sendCarrying(carried!);
    if (send.phase === "hidden") throw new Error("expected a busy send");
    expect(row(shareO4View(send, "chapter", screen).chips)).toBe("v-v");
  });
});

describe("Share Book: a dangling chapter left out before the count (#1044)", () => {
  it("is grey on the chips, through the prepare and the hand-off", async () => {
    const book = await createBook("b");
    for (let i = 0; i < 3; i++) {
      const chapter = await addChapter(book.id);
      const seg = await addSegment(chapter.id);
      await saveTake(
        seg.id,
        newClipId(),
        samples(100, i + 1),
        CANONICAL_SAMPLE_RATE
      );
    }
    const chapters = (await resolveBookChapters(book.id)).chapters;
    // The screen loaded all three chapters; the second's record went before
    // the export resolved the book.
    const screen = bookShareItems(
      chapters.map((c, i) => chapterRow(c.id, i + 1))
    );
    const db = await getDb();
    await db.delete("chapters", chapters[1]!.id);
    const m = machine();

    const result = await exportBookZip(
      book.id,
      (n) => `Chapter ${n}.mp3`,
      testCodec(),
      undefined,
      stepReporter(() => true, m.dispatch)
    );

    expect(result?.chapters).toBe(2);
    const after = m.state();
    if (after.phase !== "busy") throw new Error("expected a busy prepare");
    expect(after.steps?.keys).toEqual([chapters[0]!.id, chapters[2]!.id]);
    expect(row(shareO4View(after, "book", screen).chips)).toBe("v-v");
    const send = sendCarrying(carryFromPrepare(after)!);
    if (send.phase === "hidden") throw new Error("expected a busy send");
    expect(row(shareO4View(send, "book", screen).chips)).toBe("v-v");
  });
});

describe("reduceShareProgress — the counted items' keys (#1044)", () => {
  const prepare = (): ShareProgress =>
    reduceShareProgress(HIDDEN, { type: "begin", work: "prepare", now: 0 });
  const run = (events: ShareProgressEvent[]): ShareProgress =>
    events.reduce(reduceShareProgress, prepare());
  const keysOf = (s: ShareProgress) =>
    s.phase === "busy" ? s.steps?.keys : undefined;

  it("records the keys the first step names, and keeps them on a step without", () => {
    const s = run([
      { type: "step", done: 0, total: 2, keys: ["a", "b"] },
      { type: "step", done: 1, total: 2 },
    ]);
    expect(keysOf(s)).toEqual(["a", "b"]);
  });

  it("takes a later step that repeats the same keys", () => {
    const s = run([
      { type: "step", done: 0, total: 2, keys: ["a", "b"] },
      { type: "step", done: 1, total: 2, keys: ["a", "b"] },
    ]);
    expect(s.phase === "busy" && s.steps?.done).toBe(1);
  });

  it("rejects a step whose keys change, or arrive after a first step without them", () => {
    const keyed = run([{ type: "step", done: 0, total: 2, keys: ["a", "b"] }]);
    expect(
      reduceShareProgress(keyed, {
        type: "step",
        done: 1,
        total: 2,
        keys: ["a", "c"],
      })
    ).toBe(keyed);
    const bare = run([{ type: "step", done: 0, total: 2 }]);
    expect(
      reduceShareProgress(bare, {
        type: "step",
        done: 1,
        total: 2,
        keys: ["a", "b"],
      })
    ).toBe(bare);
  });

  it("rejects keys that do not name exactly one per item", () => {
    const p = prepare();
    for (const event of [
      { type: "step", done: 0, total: 2, keys: ["a"] },
      { type: "step", done: 0, total: 102, items: 2, keys: ["a", "b", "c"] },
    ] as const)
      expect(reduceShareProgress(p, event)).toBe(p);
    expect(
      keysOf(
        reduceShareProgress(p, {
          type: "step",
          done: 0,
          total: 102,
          items: 2,
          keys: ["a", "b"],
        })
      )
    ).toEqual(["a", "b"]);
  });

  it("carryFromPrepare takes the keys onto the snapshot", () => {
    const s = run([
      { type: "step", done: 0, total: 102, items: 2, keys: ["a", "b"] },
    ]);
    expect(carryFromPrepare(s)).toEqual({
      items: 2,
      hollow: [],
      keys: ["a", "b"],
    });
  });

  it("a carry is rejected when its keys disagree with its items or its hollow", () => {
    const send = reduceShareProgress(HIDDEN, {
      type: "begin",
      work: "send",
      now: 0,
    });
    for (const carried of [
      { items: 3, hollow: [], keys: ["a", "b"] },
      { hollow: [2], keys: ["a", "b"] },
    ])
      expect(reduceShareProgress(send, { type: "carry", carried })).toBe(send);
    const ok = reduceShareProgress(send, {
      type: "carry",
      carried: { items: 2, hollow: [1], keys: ["a", "b"] },
    });
    expect(ok.phase === "busy" && ok.carried?.keys).toEqual(["a", "b"]);
  });
});
