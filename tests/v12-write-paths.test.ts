import "fake-indexeddb/auto";

import { unwrap } from "idb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encodeMp3 } from "@/lib/audio/mp3";
import { computePeaks } from "@/lib/audio/peaks";
import {
  addChapter,
  addSegment,
  createBook,
  deleteBook,
  deleteSegment,
  moveBook,
  moveChapter,
  moveSegment,
  renameBook,
  renameChapter,
  renameSegment,
  setBookCoverColour,
} from "@/lib/storage/books";
import { getDb } from "@/lib/storage/db";
import { clearSegmentTake, setSegmentFinished } from "@/lib/storage/takes";
import { commitTranscode } from "@/lib/storage/transcode";
import type {
  BookId,
  ChapterId,
  ClipId,
  SegmentId,
  Tombstone,
} from "@/types/domain";
import { clearAllStores, recordTake, throwWhenStoreRequested } from "./support";
import { NO_STAGES_RUN } from "@/lib/audio/loudness";

/**
 * The v12 write paths (#1463, `docs/design/v12-schema.md` J6 and "A tombstone
 * is written only when the row was there and is removed").
 *
 * `modifiedAt` means "this row was last written": every put of a book, chapter
 * or segment row stamps it with the write's time, in that same put, and a
 * write that puts nothing leaves it alone. A delete of a book or segment that
 * was there adds one tombstone, in the delete's own transaction.
 *
 * Every write runs over the same shelf, built under clock T0, and runs itself
 * under clock T1, so a row whose `modifiedAt` changed is exactly a row the
 * write put. The table names those rows; any other row that moved, or a named
 * row that did not, fails the case by name.
 */

const T0 = 1_000;
const T1 = 2_000;
let clock = T0;

/** Samples the fixture's one recording holds; long enough to encode. */
const FRAMES = 2_000;

beforeEach(async () => {
  await clearAllStores();
  clock = T0;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
});
afterEach(() => vi.restoreAllMocks());

interface Ids {
  readonly A: BookId;
  readonly B: BookId;
  readonly c1: ChapterId;
  readonly c2: ChapterId;
  readonly c3: ChapterId;
  readonly s1: SegmentId;
  readonly s2: SegmentId;
  readonly s3: SegmentId;
  readonly s4: SegmentId;
  readonly s5: SegmentId;
}
type Name = keyof Ids;

interface Shelf {
  readonly ids: Ids;
  /** The clip behind s1, the one recorded segment. */
  readonly clipId: ClipId;
}

/**
 * Book A: c1 [s1 (recorded), s2, s3], c2 [s4]. Book B: c3 [s5]. B was made
 * last, so the shelf reads B, A.
 */
async function shelf(): Promise<Shelf> {
  const a = await createBook("A");
  const c1 = await addChapter(a.id);
  const s1 = await addSegment(c1.id);
  const s2 = await addSegment(c1.id);
  const s3 = await addSegment(c1.id);
  const c2 = await addChapter(a.id);
  const s4 = await addSegment(c2.id);
  const b = await createBook("B");
  const c3 = await addChapter(b.id);
  const s5 = await addSegment(c3.id);
  const take = await recordTake(s1.id, { frames: FRAMES });
  return {
    ids: {
      A: a.id,
      B: b.id,
      c1: c1.id,
      c2: c2.id,
      c3: c3.id,
      s1: s1.id,
      s2: s2.id,
      s3: s3.id,
      s4: s4.id,
      s5: s5.id,
    },
    clipId: take.clipId,
  };
}

/** `modifiedAt` of every book, chapter and segment row, by id. */
async function modifiedAts(): Promise<Map<string, number | null>> {
  const db = await getDb();
  const rows = [
    ...(await db.getAll("books")),
    ...(await db.getAll("chapters")),
    ...(await db.getAll("segments")),
  ];
  return new Map(rows.map((row) => [row.id, row.modifiedAt]));
}

async function tombstones(): Promise<Tombstone[]> {
  return (await getDb()).getAll("tombstones");
}

interface Case {
  readonly write: string;
  /** Extra setup, still under T0. */
  readonly arrange?: (s: Shelf) => Promise<unknown>;
  readonly act: (s: Shelf) => Promise<unknown>;
  /** The rows the write puts; `"new"` once for each row it creates. */
  readonly stamped: readonly (Name | "new")[];
  readonly tombstones?: (s: Shelf) => Tombstone[];
}

const CASES: readonly Case[] = [
  {
    write: "createBook (the new row, and each shelf row it renumbers)",
    act: () => createBook("C"),
    stamped: ["A", "B", "new"],
  },
  {
    write: "renameBook",
    act: (s) => renameBook(s.ids.A, "Mark"),
    stamped: ["A"],
  },
  {
    write: "renameBook to the same name (no put)",
    act: (s) => renameBook(s.ids.A, "A"),
    stamped: [],
  },
  {
    write: "setBookCoverColour",
    act: (s) => setBookCoverColour(s.ids.A, "forest"),
    stamped: ["A"],
  },
  {
    write: "setBookCoverColour to the same key (no put)",
    act: (s) => setBookCoverColour(s.ids.A, null),
    stamped: [],
  },
  {
    write: "moveBook",
    act: (s) => moveBook(s.ids.A, 0),
    stamped: ["A", "B"],
  },
  {
    write: "moveBook to where it is (no put)",
    act: (s) => moveBook(s.ids.B, 0),
    stamped: [],
  },
  {
    write: "addChapter (the new row and its book)",
    act: (s) => addChapter(s.ids.A),
    stamped: ["A", "new"],
  },
  {
    write: "renameChapter (the chapter and its book)",
    act: (s) => renameChapter(s.ids.c1, "Mark 1"),
    stamped: ["A", "c1"],
  },
  {
    write: "renameChapter to the same name (no put)",
    act: (s) => renameChapter(s.ids.c1, ""),
    stamped: [],
  },
  {
    write: "moveChapter (the book's order only; no chapter row is put)",
    act: (s) => moveChapter(s.ids.c2, 0),
    stamped: ["A"],
  },
  {
    write: "moveChapter to where it is (no put)",
    act: (s) => moveChapter(s.ids.c1, 0),
    stamped: [],
  },
  {
    write: "addSegment (the new row and its chapter)",
    act: (s) => addSegment(s.ids.c1),
    stamped: ["c1", "new"],
  },
  {
    write: "renameSegment",
    act: (s) => renameSegment(s.ids.s2, "verses 3-4"),
    stamped: ["s2"],
  },
  {
    write: "renameSegment to the same label (no put)",
    act: (s) => renameSegment(s.ids.s2, ""),
    stamped: [],
  },
  {
    write: "moveSegment (the chapter's order and every renumbered segment)",
    act: (s) => moveSegment(s.ids.s3, 0),
    stamped: ["c1", "s1", "s2", "s3"],
  },
  {
    write: "moveSegment to where it is (no put)",
    act: (s) => moveSegment(s.ids.s1, 0),
    stamped: [],
  },
  {
    write: "deleteSegment (its chapter, the renumbered rest, its book)",
    act: (s) => deleteSegment(s.ids.s2),
    stamped: ["A", "c1", "s3"],
    tombstones: (s) => [
      {
        entity: "segment",
        entityId: s.ids.s2,
        parentId: s.ids.c1,
        deletedAt: T1,
      },
    ],
  },
  {
    write: "deleteSegment of an id that is not there (no put, no tombstone)",
    act: () => deleteSegment(crypto.randomUUID() as SegmentId),
    stamped: [],
  },
  {
    write: "deleteBook (one tombstone for the book; no surviving row put)",
    act: (s) => deleteBook(s.ids.B),
    stamped: [],
    tombstones: (s) => [
      { entity: "book", entityId: s.ids.B, parentId: null, deletedAt: T1 },
    ],
  },
  {
    write: "deleteBook of an id that is not there (no tombstone)",
    act: () => deleteBook(crypto.randomUUID() as BookId),
    stamped: [],
  },
  {
    write: "saveTake / writeTakeInTx (the segment and its book)",
    act: (s) => recordTake(s.ids.s2),
    stamped: ["A", "s2"],
  },
  {
    write: "clearSegmentTake (the segment and its book)",
    act: (s) => clearSegmentTake(s.ids.s1),
    stamped: ["A", "s1"],
  },
  {
    write: "setSegmentFinished",
    act: (s) => setSegmentFinished(s.ids.s1, true),
    stamped: ["s1"],
  },
  {
    write: "setSegmentFinished(false) on a never-recorded segment (it puts)",
    act: (s) => setSegmentFinished(s.ids.s4, false),
    stamped: ["s4"],
  },
  {
    write: "commitTranscode (clip stores only)",
    arrange: (s) => setSegmentFinished(s.ids.s1, true),
    act: async (s) => {
      const pcm = new Int16Array(FRAMES).fill(1000);
      const outcome = await commitTranscode(
        s.ids.s1,
        s.clipId,
        encodeMp3(pcm),
        computePeaks(pcm, 4),
        NO_STAGES_RUN
      );
      expect(outcome).toBe("committed");
    },
    stamped: [],
  },
];

describe("every write stamps modifiedAt on exactly the rows it puts", () => {
  it.each(CASES)("$write", async (c) => {
    const s = await shelf();
    await c.arrange?.(s);
    const before = await modifiedAts();
    const nameOf = new Map(
      Object.entries(s.ids).map(([name, id]) => [id, name as Name])
    );

    clock = T1;
    await c.act(s);

    const after = await modifiedAts();
    const changed: string[] = [];
    for (const [id, modifiedAt] of after) {
      if (before.has(id) && before.get(id) === modifiedAt) continue;
      changed.push(before.has(id) ? (nameOf.get(id) ?? id) : "new");
      expect(modifiedAt, `${nameOf.get(id) ?? "new"} stamped`).toBe(T1);
    }
    expect(changed.sort()).toEqual([...c.stamped].sort());
    expect(await tombstones()).toEqual(c.tombstones?.(s) ?? []);
  });
});

/** Every row of every store the deletes touch, for an exact before/after. */
async function everything(): Promise<Record<string, unknown[]>> {
  const db = await getDb();
  const out: Record<string, unknown[]> = {};
  for (const store of [
    "books",
    "chapters",
    "segments",
    "takes",
    "clipMeta",
    "clipData",
    "tombstones",
  ] as const) {
    out[store] = await db.getAll(store);
  }
  return out;
}

/**
 * Make the `put` of `storeName` throw on every transaction opened from now on,
 * while `get` and every other request still work, so the fault lands after the
 * write has already deleted rows and added its tombstone.
 */
function throwOnPut(raw: IDBDatabase, storeName: string, error: Error) {
  const open = raw.transaction.bind(raw);
  return vi
    .spyOn(raw, "transaction")
    .mockImplementation((...args: Parameters<IDBDatabase["transaction"]>) => {
      const tx = open(...args);
      const objectStore = tx.objectStore.bind(tx);
      Object.defineProperty(tx, "objectStore", {
        configurable: true,
        value: (name: string) => {
          const store = objectStore(name);
          if (name === storeName) {
            Object.defineProperty(store, "put", {
              configurable: true,
              value: () => {
                throw error;
              },
            });
          }
          return store;
        },
      });
      return tx;
    });
}

describe("a delete that fails part-way leaves neither the tombstone nor the deletion", () => {
  it("deleteSegment: a failed tombstone write leaves the segment, its take, its clip and segmentIds", async () => {
    const s = await shelf();
    const before = await everything();
    const injected = new Error("injected tombstone failure");
    throwWhenStoreRequested(
      unwrap(await getDb()) as IDBDatabase,
      "tombstones",
      injected
    );

    await expect(deleteSegment(s.ids.s1)).rejects.toThrow(injected);

    vi.restoreAllMocks();
    expect(await everything()).toEqual(before);
  });

  it("deleteSegment: a failed chapters put after the tombstone leaves no tombstone and no deletion", async () => {
    const s = await shelf();
    const before = await everything();
    const injected = new Error("injected chapters put failure");
    throwOnPut(unwrap(await getDb()) as IDBDatabase, "chapters", injected);

    await expect(deleteSegment(s.ids.s1)).rejects.toThrow(injected);

    vi.restoreAllMocks();
    expect(await everything()).toEqual(before);
  });

  it("deleteBook: a failed tombstone write leaves the whole book", async () => {
    const s = await shelf();
    const before = await everything();
    const injected = new Error("injected tombstone failure");
    throwWhenStoreRequested(
      unwrap(await getDb()) as IDBDatabase,
      "tombstones",
      injected
    );

    await expect(deleteBook(s.ids.A)).rejects.toThrow(injected);

    vi.restoreAllMocks();
    expect(await everything()).toEqual(before);
  });
});

describe("a repeated delete writes no second tombstone", () => {
  it("deleteSegment twice: one tombstone", async () => {
    const s = await shelf();
    await deleteSegment(s.ids.s2);
    await expect(deleteSegment(s.ids.s2)).resolves.toBeNull();
    expect((await tombstones()).map((t) => t.entityId)).toEqual([s.ids.s2]);
  });

  it("deleteBook twice: one tombstone", async () => {
    const s = await shelf();
    await deleteBook(s.ids.B);
    await deleteBook(s.ids.B);
    expect((await tombstones()).map((t) => t.entityId)).toEqual([s.ids.B]);
  });

  it("deleteBook over a tree whose book row is already gone collects it and writes no tombstone", async () => {
    const s = await shelf();
    await (await getDb()).delete("books", s.ids.B);

    await deleteBook(s.ids.B);

    const db = await getDb();
    expect(await db.get("chapters", s.ids.c3)).toBeUndefined();
    expect(await db.get("segments", s.ids.s5)).toBeUndefined();
    expect(await tombstones()).toEqual([]);
  });
});
