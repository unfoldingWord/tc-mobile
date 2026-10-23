import "fake-indexeddb/auto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { mergeTake } from "@/lib/audio/edit";
import { encodeMp3 } from "@/lib/audio/mp3";
import { computePeaks } from "@/lib/audio/peaks";
import type { NewTake, PendingTake } from "@/lib/takes/pending-take";
import type { ClipMeta } from "@/types/audio";
import type {
  BookId,
  ClipId,
  SegmentId,
  TakeDisposition,
} from "@/types/domain";

/**
 * The interleaving harness for the pending-take lifecycle (#38,
 * docs/design/pending-take-lifecycle.md §8, "Interleaving harness").
 *
 * A named test pins the ordering a reviewer found; this looks for the next
 * one. Each scenario is a small script per copy of the app. The harness runs
 * EVERY order of those steps that keeps each copy's own order, from a fresh
 * seed, and checks one invariant after every step: no take's last copy is
 * freed or overwritten without a record saying why.
 *
 * - **Two copies** are two module instances (`vi.resetModules`), so two
 *   `getDb()` connections to one fake-indexeddb database. Each copy's slot
 *   and Discard flag live in this file's model, as the hook keeps them.
 * - **A step** is one store call, which is one transaction: the hold, an
 *   ordinary commit, a quota failure (the hook's give-up settle), a Discard
 *   tap (the flag, set in the tap's turn) and its settle, erase, segment and
 *   book delete, and the transcode commit. A tap can also land inside the
 *   hold, from a hook on its put request (the window hold step 7 closes).
 * - **A kill** after any step leaves the disk exactly as that step left it,
 *   because an aborted transaction writes nothing. So the kill check is the
 *   disk half of the invariant, at every prefix, with every slot and flag
 *   dropped: it is run after every step.
 *
 * The invariant, per take the scenario made:
 *   I1  a take that had a copy (a slot, a whole row, or the active take)
 *       still has one, unless it is recorded saved or discarded, or a Discard
 *       was requested for it;
 *   I2  a take that had a durable copy (a whole row, or the active take)
 *       still has one, unless a record says why it ended (a kill would
 *       otherwise lose it);
 *   I3  every pending row is a whole recipe: its `stored` base clip exists,
 *       as PCM, at the generation and frame count the row names;
 *   I4  a copy that requested a Discard never leaves a row for that take that
 *       was not there when it asked (the next launch would bring it back);
 *   C1  a take recorded discarded is never the active take;
 *   C2  a `saved` or `discarded` record never changes kind.
 *
 * And, per disk, after every step (rebuild PR 2, cell RP-D):
 *   D1  a deleted segment leaves no pending row behind;
 *   L1  every clip on disk is named by a take or by a pending row's `stored`
 *       base, so a delete that drops a row also lets its base clip go.
 *
 * The scenario list is a floor. Rebuild PR 3 added the replay as one more
 * step kind (`replay`, the conditional commit `saveReplayedTake`), and its
 * replay slice the relaunch through the hook layer, split at the slot install
 * (`launchRead`, `launchCommit`), with a check that it leaves its slot clear.
 */

type Copy = {
  readonly name: "A" | "B";
  readonly takes: typeof import("@/lib/storage/takes");
  readonly pending: typeof import("@/lib/storage/pending-takes");
  readonly books: typeof import("@/lib/storage/books");
  readonly transcode: typeof import("@/lib/storage/transcode");
  readonly db: typeof import("@/lib/storage/db");
  /** The hook layer's launch replay, wired as `useSaveTake` runs it. */
  readonly replay: typeof import("@/hooks/replay-pending-takes");
  readonly save: typeof import("@/hooks/use-save-take");
};

async function loadCopy(name: Copy["name"]): Promise<Copy> {
  vi.resetModules();
  return {
    name,
    takes: await import("@/lib/storage/takes"),
    pending: await import("@/lib/storage/pending-takes"),
    books: await import("@/lib/storage/books"),
    transcode: await import("@/lib/storage/transcode"),
    db: await import("@/lib/storage/db"),
    replay: await import("@/hooks/replay-pending-takes"),
    save: await import("@/hooks/use-save-take"),
  };
}

/** What the hook holds in memory, per copy. */
type Live = {
  readonly slot: Set<ClipId>;
  readonly flags: Set<ClipId>;
  /** Whether the take's row was on disk when this copy asked to discard it. */
  readonly rowAtTap: Map<ClipId, boolean>;
};

type World = {
  readonly copies: Record<Copy["name"], Copy>;
  readonly live: Record<Copy["name"], Live>;
  readonly segmentId: SegmentId;
  readonly bookId: BookId;
  readonly kept: ClipMeta;
  readonly pcm: Int16Array;
  readonly takes: Record<string, NewTake>;
  /**
   * A relaunched copy's replay, paused between its recipe read and its
   * commit (`launchRead` / `launchCommit`), and the hook slot it ends with.
   */
  readonly launches: Partial<
    Record<
      Copy["name"],
      { readonly release: () => void; readonly finished: Promise<void> }
    >
  >;
  readonly launchSlots: Partial<Record<Copy["name"], PendingTake | null>>;
};

type Step = {
  readonly copy: Copy["name"];
  readonly label: string;
  readonly run: (world: World) => Promise<void>;
};

const RATE = 48_000;
const FRAMES = 80;

/** Every take a scenario names, by letter, minted fresh per run. */
const takeOf = (world: World, letter: string): NewTake => world.takes[letter]!;

// ── Steps ───────────────────────────────────────────────────────────────

function hold(
  copy: Copy["name"],
  letter: string,
  opts: { stored?: boolean; tapDuringPut?: boolean } = {}
): Step {
  return {
    copy,
    label: `${copy}:hold ${letter}${opts.stored ? " (stored base)" : ""}${
      opts.tapDuringPut ? " + tap inside" : ""
    }`,
    run: async (world) => {
      const t = takeOf(world, letter);
      const live = world.live[copy];
      let armed = opts.tapDuringPut === true;
      const realPut = IDBObjectStore.prototype.put;
      const spy = vi
        .spyOn(IDBObjectStore.prototype, "put")
        .mockImplementation(function (this: IDBObjectStore, ...args) {
          const request = realPut.apply(this, args);
          if (armed && this.name === "pendingTakes") {
            armed = false;
            tapNow(world, copy, t.clipId, false);
          }
          return request;
        });
      try {
        await world.copies[copy].pending.writePendingTake(t, {
          source: opts.stored ? world.kept : null,
          isDiscardRequested: (id) => live.flags.has(id),
        });
      } finally {
        spy.mockRestore();
      }
      // A tap meant to land inside a hold that never reached its put lands
      // just after it.
      if (armed) tapNow(world, copy, t.clipId, await rowExists(world, t));
    },
  };
}

function tapNow(
  world: World,
  copy: Copy["name"],
  clipId: ClipId,
  rowThere: boolean
): void {
  const live = world.live[copy];
  live.flags.add(clipId);
  live.slot.delete(clipId);
  live.rowAtTap.set(clipId, rowThere);
}

function commit(copy: Copy["name"], letter: string): Step {
  return {
    copy,
    label: `${copy}:commit ${letter}`,
    run: async (world) => {
      const t = takeOf(world, letter);
      const live = world.live[copy];
      const merged = new Int16Array(t.existing.length + t.recorded.length);
      merged.set(t.existing);
      merged.set(t.recorded, t.existing.length);
      try {
        await world.copies[copy].takes.saveTake(
          t.segmentId,
          t.clipId,
          merged,
          RATE,
          { isDiscardRequested: (id) => live.flags.has(id) }
        );
        // saved, already-saved and discarded all free the slot.
        live.slot.delete(t.clipId);
      } catch {
        // A missing segment: the slot stays held, as the hook keeps it.
      }
    },
  };
}

/** The hook's answer to a quota failure of the commit: give the row up. */
function commitQuota(copy: Copy["name"], letter: string): Step {
  return {
    copy,
    label: `${copy}:commit ${letter} fails for quota`,
    run: async (world) => {
      const t = takeOf(world, letter);
      await world.copies[copy].takes.settlePendingTake(
        t.segmentId,
        t.clipId,
        "give-up"
      );
    },
  };
}

function tap(copy: Copy["name"], letter: string): Step {
  return {
    copy,
    label: `${copy}:tap Discard ${letter}`,
    run: async (world) => {
      const t = takeOf(world, letter);
      tapNow(world, copy, t.clipId, await rowExists(world, t));
    },
  };
}

function settleDiscard(copy: Copy["name"], letter: string): Step {
  return {
    copy,
    label: `${copy}:settle Discard ${letter}`,
    run: async (world) => {
      const t = takeOf(world, letter);
      const settled = await world.copies[copy].takes.settlePendingTake(
        t.segmentId,
        t.clipId,
        "discard"
      );
      if (settled.ok) world.live[copy].flags.delete(t.clipId);
    },
  };
}

function erase(copy: Copy["name"]): Step {
  return {
    copy,
    label: `${copy}:erase`,
    run: async (world) => {
      await world.copies[copy].takes.clearSegmentTake(world.segmentId);
    },
  };
}

function deleteSegment(copy: Copy["name"]): Step {
  return {
    copy,
    label: `${copy}:delete segment`,
    run: async (world) => {
      await world.copies[copy].books.deleteSegment(world.segmentId);
    },
  };
}

function deleteBook(copy: Copy["name"]): Step {
  return {
    copy,
    label: `${copy}:delete book`,
    run: async (world) => {
      await world.copies[copy].books.deleteBook(world.bookId);
    },
  };
}

/**
 * The launch replay's conditional commit of a take this copy holds (rebuild
 * PR 3). Every outcome but `held` lets the slot go, as the replay does: the
 * take is then saved, recorded as ended, on disk as a marked row, or its
 * segment is gone. A rejection keeps it held.
 */
function replay(copy: Copy["name"], letter: string): Step {
  return {
    copy,
    label: `${copy}:replay ${letter}`,
    run: async (world) => {
      const t = takeOf(world, letter);
      const live = world.live[copy];
      try {
        const result = await world.copies[copy].takes.saveReplayedTake(
          { ...t, baseRevision: t.baseRevision ?? 0 },
          mergeTake(t.existing, t.recorded, t.offset),
          RATE,
          { isDiscardRequested: (id) => live.flags.has(id) }
        );
        if (result.outcome !== "held") live.slot.delete(t.clipId);
      } catch {
        // The slot stays held, as the hook keeps it.
      }
    },
  };
}

/**
 * A relaunch of this copy, through the hook layer (the replay slice of PR 3):
 * `replayPendingTakes` lists, classifies and reads the recipe, then pauses
 * where it hands the take to `performResumeTake`, so the other copy's steps
 * can land between this read and the commit. The take is then in this
 * copy's memory. A launch that finds nothing to install just finishes.
 */
function launchRead(copy: Copy["name"]): Step {
  return {
    copy,
    label: `${copy}:launch, read`,
    run: async (world) => {
      const { replay, save } = world.copies[copy];
      const live = world.live[copy];
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let reached!: () => void;
      const atResume = new Promise<void>((r) => (reached = r));
      world.launchSlots[copy] = null;
      const finished = replay.replayPendingTakes(async (take) => {
        live.slot.add(take.clipId);
        reached();
        await gate;
        const freed = await save.performResumeTake(
          world.launchSlots[copy] ?? null,
          take,
          {
            update: (t) => {
              world.launchSlots[copy] = t(world.launchSlots[copy] ?? null);
              if (!world.launchSlots[copy]) live.slot.delete(take.clipId);
            },
            requestSweep: () => {},
          }
        );
        return freed === true;
      });
      world.launches[copy] = { release, finished };
      await Promise.race([atResume, finished]);
    },
  };
}

/** The paused launch's conditional commit, and the rest of its run. */
function launchCommit(copy: Copy["name"]): Step {
  return {
    copy,
    label: `${copy}:launch, commit`,
    run: async (world) => {
      const launch = world.launches[copy]!;
      launch.release();
      await launch.finished;
    },
  };
}

function transcodeKept(copy: Copy["name"]): Step {
  return {
    copy,
    label: `${copy}:transcode K`,
    run: async (world) => {
      await world.copies[copy].transcode.commitTranscode(
        world.segmentId,
        world.kept.id,
        encodeMp3(world.pcm),
        computePeaks(world.pcm, 4)
      );
    },
  };
}

// ── Reading the disk ────────────────────────────────────────────────────

async function rowExists(world: World, t: NewTake): Promise<boolean> {
  const db = await world.copies.A.db.getDb();
  return (await db.get("pendingTakes", t.segmentId))?.clipId === t.clipId;
}

type Disk = {
  readonly rows: Map<ClipId, boolean>; // clipId -> whole
  readonly active: ClipId | null;
  readonly records: Map<ClipId, TakeDisposition["kind"]>;
  /** A person deleted the segment (or its book): final, and it takes its
   * takes and their records with it (rule 5). */
  readonly segmentGone: boolean;
  /** Whether a pending row is keyed by the scenario's segment. */
  readonly segmentRow: boolean;
  /** Clips on disk that no take and no row's `stored` base names. */
  readonly unnamedClips: readonly ClipId[];
};

async function readDisk(world: World): Promise<Disk> {
  const db = await world.copies.A.db.getDb();
  const rows = new Map<ClipId, boolean>();
  for (const row of await db.getAll("pendingTakes")) {
    let whole = true;
    if (row.base.kind === "stored") {
      const meta = await db.get("clipMeta", row.base.sourceClipId);
      const data = await db.get("clipData", row.base.sourceClipId);
      whole =
        meta?.encoding === "pcm" &&
        meta.generation === row.base.generation &&
        meta.frameCount === row.base.frameCount &&
        data?.byteLength === row.base.frameCount * 2;
    }
    rows.set(row.clipId, whole);
  }
  const segment = await db.get("segments", world.segmentId);
  const take = segment?.activeTakeId
    ? await db.get("takes", segment.activeTakeId)
    : undefined;
  const records = new Map<ClipId, TakeDisposition["kind"]>();
  for (const r of await db.getAll("takeDispositions")) {
    records.set(r.clipId, r.kind);
  }
  const named = new Set<ClipId>(
    (await db.getAll("takes")).map((t) => t.clipId)
  );
  for (const row of await db.getAll("pendingTakes")) {
    if (row.base.kind === "stored") named.add(row.base.sourceClipId);
  }
  const unnamedClips = (await db.getAllKeys("clipMeta")).filter(
    (id) => !named.has(id)
  );
  return {
    rows,
    active: take?.clipId ?? null,
    records,
    segmentGone: segment === undefined,
    segmentRow: (await db.get("pendingTakes", world.segmentId)) !== undefined,
    unnamedClips,
  };
}

function violations(
  world: World,
  before: Disk,
  after: Disk,
  liveBefore: Record<Copy["name"], Set<ClipId>>,
  stepCopy: Copy["name"]
): string[] {
  const found: string[] = [];
  if (after.segmentGone && after.segmentRow) {
    found.push("D1: a deleted segment left its pending row");
  }
  if (after.unnamedClips.length > 0) {
    found.push(
      `L1: ${after.unnamedClips.length} clip(s) on disk named by nothing`
    );
  }
  const requested = (id: ClipId): boolean =>
    world.live.A.rowAtTap.has(id) || world.live.B.rowAtTap.has(id);
  for (const [letter, t] of Object.entries(world.takes)) {
    const id = t.clipId;
    const record = after.records.get(id);
    const durable = (d: Disk): boolean =>
      d.rows.get(id) === true || d.active === id;
    const inSlot = (slots: Record<Copy["name"], Set<ClipId>>): boolean =>
      slots.A.has(id) || slots.B.has(id);
    const hadCopy = inSlot(liveBefore) || durable(before);
    const hasCopy =
      world.live.A.slot.has(id) || world.live.B.slot.has(id) || durable(after);
    const ended =
      record === "saved" || record === "discarded" || after.segmentGone;
    if (hadCopy && !hasCopy && !ended && !requested(id)) {
      found.push(`I1: ${letter}'s last copy was freed with no record`);
    }
    if (
      durable(before) &&
      !durable(after) &&
      record === undefined &&
      !after.segmentGone
    ) {
      found.push(`I2: ${letter}'s durable copy went with no record`);
    }
    if (after.rows.get(id) === false) {
      found.push(
        `I3: ${letter}'s row names a base clip that is gone or changed`
      );
    }
    const tappedHere = world.live[stepCopy].rowAtTap.get(id);
    if (tappedHere === false && after.rows.has(id)) {
      found.push(
        `I4: ${letter}'s row appeared after ${stepCopy} asked to discard it`
      );
    }
    if (record === "discarded" && after.active === id) {
      found.push(`C1: ${letter} is active though recorded discarded`);
    }
    const was = before.records.get(id);
    if (
      (was === "saved" || was === "discarded") &&
      record !== was &&
      !after.segmentGone
    ) {
      found.push(`C2: ${letter}'s ${was} record became ${String(record)}`);
    }
  }
  return found;
}

// ── Orders and runs ─────────────────────────────────────────────────────

/** Every order of the two scripts that keeps each script's own order. */
function interleavings(a: Step[], b: Step[]): Step[][] {
  if (a.length === 0) return [b];
  if (b.length === 0) return [a];
  return [
    ...interleavings(a.slice(1), b).map((rest) => [a[0]!, ...rest]),
    ...interleavings(a, b.slice(1)).map((rest) => [b[0]!, ...rest]),
  ];
}

type Scenario = {
  readonly name: string;
  readonly finished?: boolean;
  /** Takes by letter; `stored` takes splice onto the kept clip's PCM. */
  readonly takes: Record<string, { stored: boolean }>;
  /** Which copy holds which take in its slot at the start. */
  readonly slots: Record<Copy["name"], string[]>;
  readonly A: Step[];
  readonly B: Step[];
  /** Checked once every step of an order has run. */
  readonly settled?: (world: World) => string[];
};

/** #1557's check, in the app: a relaunch leaves its hook slot clear. */
const slotLeftClear =
  (copy: Copy["name"]) =>
  (world: World): string[] =>
    world.launchSlots[copy]
      ? [`${copy}'s launch left its slot ${world.launchSlots[copy]!.state}`]
      : [];

let copies: Record<Copy["name"], Copy>;

async function seed(scenario: Scenario): Promise<World> {
  const a = copies.A;
  const db = await a.db.getDb();
  const names = Array.from(db.objectStoreNames);
  const tx = db.transaction(names, "readwrite");
  await Promise.all([...names.map((s) => tx.objectStore(s).clear()), tx.done]);

  const book = await a.books.createBook("b");
  const chapter = await a.books.addChapter(book.id);
  const segment = await a.books.addSegment(chapter.id);
  const pcm = new Int16Array(FRAMES).fill(1000);
  const keptId = crypto.randomUUID() as ClipId;
  await a.takes.saveTake(segment.id, keptId, pcm, RATE, {
    finished: scenario.finished ?? false,
  });
  const kept = (await db.get("clipMeta", keptId))!;
  // The revision every take's base was read at: the kept take's.
  const observed = (await db.get("segments", segment.id))!.audioRevision;

  const takes: Record<string, NewTake> = {};
  for (const [letter, { stored }] of Object.entries(scenario.takes)) {
    takes[letter] = {
      segmentId: segment.id,
      ordinal: 1,
      clipId: crypto.randomUUID() as ClipId,
      existing: stored ? pcm : new Int16Array(0),
      recorded: Int16Array.from({ length: 20 }, (_, i) => i + 1),
      offset: stored ? FRAMES : 0,
      finished: false,
      editOnly: false,
      baseRevision: observed,
    };
  }
  const live = (letters: string[]): Live => ({
    slot: new Set(letters.map((l) => takes[l]!.clipId)),
    flags: new Set(),
    rowAtTap: new Map(),
  });
  return {
    copies,
    live: { A: live(scenario.slots.A), B: live(scenario.slots.B) },
    segmentId: segment.id,
    bookId: book.id,
    kept,
    pcm,
    takes,
    launches: {},
    launchSlots: {},
  };
}

async function runScenario(scenario: Scenario): Promise<{
  orders: number;
  failures: string[];
}> {
  const orders = interleavings(scenario.A, scenario.B);
  const failures: string[] = [];
  for (const order of orders) {
    const world = await seed(scenario);
    const failedBefore = failures.length;
    let before = await readDisk(world);
    for (const [i, step] of order.entries()) {
      const liveBefore = {
        A: new Set(world.live.A.slot),
        B: new Set(world.live.B.slot),
      };
      await step.run(world);
      const after = await readDisk(world);
      const found = violations(world, before, after, liveBefore, step.copy);
      if (found.length > 0) {
        const path = order
          .slice(0, i + 1)
          .map((s) => s.label)
          .join(" → ");
        failures.push(`${path}: ${found.join("; ")}`);
        break;
      }
      before = after;
    }
    const unsettled = scenario.settled?.(world) ?? [];
    if (failures.length === failedBefore && unsettled.length > 0) {
      const path = order.map((s) => s.label).join(" → ");
      failures.push(`${path}: ${unsettled.join("; ")}`);
    }
  }
  return { orders: orders.length, failures };
}

// ── Scenarios ───────────────────────────────────────────────────────────

const SCENARIOS: readonly Scenario[] = [
  {
    // Frank r1 (a hold replaces another clip's row) and Frank r3 (a save
    // deletes a clip a row's base names) on the note.
    name: "A records C over K on a stored base; B records D on the same segment",
    takes: { C: { stored: true }, D: { stored: true } },
    slots: { A: ["C"], B: ["D"] },
    A: [hold("A", "C", { stored: true }), commit("A", "C")],
    B: [hold("B", "D", { stored: true }), commit("B", "D")],
  },
  {
    // George r3's High on the note: an ordinary Retry of a take another
    // copy discarded after a quota give-up.
    name: "A gives C up for quota and retries; B, also holding C, discards it",
    takes: { C: { stored: false } },
    slots: { A: ["C"], B: ["C"] },
    A: [hold("A", "C"), commitQuota("A", "C"), commit("A", "C")],
    B: [tap("B", "C"), settleDiscard("B", "C")],
  },
  {
    // George r1's High and r3's Medium on the note: a Discard tap inside the
    // hold, against another copy's save.
    name: "A's Discard lands inside its own hold of C; B records D",
    takes: { C: { stored: false }, D: { stored: false } },
    slots: { A: ["C"], B: ["D"] },
    A: [hold("A", "C", { tapDuringPut: true }), settleDiscard("A", "C")],
    B: [hold("B", "D"), commit("B", "D")],
  },
  {
    // Frank r4 on the note: a stored base made from stale source metadata.
    name: "A holds C on a stored base; B transcodes K",
    finished: true,
    takes: { C: { stored: true } },
    slots: { A: ["C"], B: [] },
    A: [hold("A", "C", { stored: true }), commitQuota("A", "C")],
    B: [transcodeKept("B")],
  },
  {
    name: "A holds C on a stored base; B erases and then deletes the segment",
    takes: { C: { stored: true } },
    slots: { A: ["C"], B: [] },
    A: [hold("A", "C", { stored: true }), commit("A", "C")],
    B: [erase("B"), deleteSegment("B")],
  },
  {
    name: "A holds C on a stored base and discards it; B deletes the book",
    takes: { C: { stored: true } },
    slots: { A: ["C"], B: [] },
    A: [
      hold("A", "C", { stored: true }),
      tap("A", "C"),
      settleDiscard("A", "C"),
    ],
    B: [deleteBook("B")],
  },
  // Rebuild PR 3: the replay as one more step kind. B's hold of C stands for
  // the row an earlier, killed life of B left; its replay then runs against
  // every order of A's writes.
  {
    // Frank r2 (a) on the note: a cross-copy quota give-up.
    name: "B replays C from its row; A, also holding C, gives it up for quota",
    takes: { C: { stored: true } },
    slots: { A: ["C"], B: ["C"] },
    A: [commitQuota("A", "C"), commit("A", "C")],
    B: [hold("B", "C", { stored: true }), replay("B", "C")],
  },
  {
    // Frank r2 (b) on the note: a cross-copy Discard.
    name: "B replays C from its row; A, also holding C, discards it",
    takes: { C: { stored: false } },
    slots: { A: ["C"], B: ["C"] },
    A: [tap("A", "C"), settleDiscard("A", "C")],
    B: [hold("B", "C"), replay("B", "C")],
  },
  {
    // RP-S and the mixed-build case: another take on the same segment.
    name: "B replays C from its row; A records D on the same segment",
    takes: { C: { stored: true }, D: { stored: true } },
    slots: { A: ["D"], B: ["C"] },
    A: [hold("A", "D", { stored: true }), commit("A", "D")],
    B: [hold("B", "C", { stored: true }), replay("B", "C")],
  },
  {
    // RP-E and RP-D: the segment erased, then deleted, around the replay.
    name: "B replays C from its row; A erases and then deletes the segment",
    takes: { C: { stored: true } },
    slots: { A: [], B: ["C"] },
    A: [erase("A"), deleteSegment("A")],
    B: [hold("B", "C", { stored: true }), replay("B", "C")],
  },
  // The replay slice of PR 3: the same cases through the hook layer. B's
  // hold of C is the row an earlier, killed life of B left, so B starts with
  // nothing in memory; B then relaunches, and A's steps land before B's
  // read, between B's read and its commit, and after.
  {
    // #1557: A finishes C's row; B's relaunch must leave its slot clear.
    name: "B relaunches and replays C; A, also holding C, saves it (#1557)",
    takes: { C: { stored: true } },
    slots: { A: ["C"], B: [] },
    A: [commit("A", "C")],
    B: [hold("B", "C", { stored: true }), launchRead("B"), launchCommit("B")],
    settled: slotLeftClear("B"),
  },
  {
    name: "B relaunches and replays C; A, also holding C, gives it up for quota and saves it",
    takes: { C: { stored: true } },
    slots: { A: ["C"], B: [] },
    A: [commitQuota("A", "C"), commit("A", "C")],
    B: [hold("B", "C", { stored: true }), launchRead("B"), launchCommit("B")],
    settled: slotLeftClear("B"),
  },
  {
    name: "B relaunches and replays C; A, also holding C, discards it",
    takes: { C: { stored: false } },
    slots: { A: ["C"], B: [] },
    A: [tap("A", "C"), settleDiscard("A", "C")],
    B: [hold("B", "C"), launchRead("B"), launchCommit("B")],
    settled: slotLeftClear("B"),
  },
  {
    name: "B relaunches and replays C; A records D on the same segment",
    takes: { C: { stored: true }, D: { stored: true } },
    slots: { A: ["D"], B: [] },
    A: [hold("A", "D", { stored: true }), commit("A", "D")],
    B: [hold("B", "C", { stored: true }), launchRead("B"), launchCommit("B")],
    settled: slotLeftClear("B"),
  },
  {
    name: "B relaunches and replays C; A erases and then deletes the segment",
    takes: { C: { stored: true } },
    slots: { A: [], B: [] },
    A: [erase("A"), deleteSegment("A")],
    B: [hold("B", "C", { stored: true }), launchRead("B"), launchCommit("B")],
    settled: slotLeftClear("B"),
  },
];

beforeAll(async () => {
  // The launch replay logs each refusal; the invariant, not the log, is
  // what these runs check.
  vi.spyOn(console, "error").mockImplementation(() => {});
  copies = { A: await loadCopy("A"), B: await loadCopy("B") };
});

afterAll(async () => {
  await copies.A.db.closeDb();
  await copies.B.db.closeDb();
});

describe("every interleaving of the pending-take writers keeps every take's last copy", () => {
  it("runs two connections to one database", async () => {
    const a = await copies.A.db.getDb();
    const b = await copies.B.db.getDb();
    // Two module instances, so two connections, both on the v13 database.
    expect(Object.is(copies.A.db, copies.B.db)).toBe(false);
    expect(Object.is(a, b)).toBe(false);
    expect([a.version, b.version]).toEqual([13, 13]);
  });

  it.each(SCENARIOS)("$name", async (scenario) => {
    const { orders, failures } = await runScenario(scenario);
    // Every order was run: (a + b)! / (a! b!) of them.
    const choose = (n: number, k: number): number =>
      k === 0 ? 1 : (choose(n - 1, k - 1) * n) / k;
    expect(orders).toBe(
      choose(scenario.A.length + scenario.B.length, scenario.A.length)
    );
    expect(failures).toEqual([]);
  });
});
