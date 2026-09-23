// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "@/app/App";
import type { ChapterId, SegmentId } from "@/types/domain";

/**
 * #710: the recovery screen must name the segment the HELD TAKE belongs to,
 * not the segment the recorder sheet was last opened on.
 *
 * App itself does not keep the two together. During a first save attempt,
 * `attempts: 0` keeps `SaveFailed` down, so App's ordinary tree is up and
 * would let a second segment open before the first save settles. The real
 * Recorder awaits `saveRecording` before it calls `onExit`, and no exit path
 * found so far reaches that overlap, so this is a defensive App-level
 * invariant, not a reproduced race. The test creates the overlap by calling
 * the Recorder's props directly. It mounts the real `App` and the real
 * `useSaveTake` over a store write the test controls, with every screen and
 * browser-boundary hook replaced at its module seam.
 */

const seam = vi.hoisted(() => {
  type Settle = { resolve: () => void; reject: (cause: unknown) => void };
  return {
    // The props App last rendered each child with.
    books: null as null | { onOpenChapter: (id: ChapterId) => void },
    segments: null as null | {
      onOpenRecorder: (segmentId: SegmentId, ordinal: number) => void;
    },
    recorder: null as null | {
      segmentId: SegmentId;
      saveRecording: (
        segmentId: SegmentId,
        existing: Int16Array,
        recorded: Int16Array,
        insertionOffset: number,
        finished: boolean
      ) => Promise<boolean>;
      saveEditedSegment: (
        segmentId: SegmentId,
        buffer: Int16Array,
        finished: boolean
      ) => Promise<boolean>;
      onExit: (dirty: boolean) => void;
    },
    // The in-flight `saveTake` writes, oldest first.
    writes: [] as Settle[],
  };
});

vi.mock("@/components/books-screen", () => ({
  BooksScreen: (props: NonNullable<typeof seam.books>) => {
    seam.books = props;
    return null;
  },
}));
vi.mock("@/components/segments-screen", () => ({
  SegmentsScreen: (props: NonNullable<typeof seam.segments>) => {
    seam.segments = props;
    return null;
  },
}));
vi.mock("@/components/recorder", () => ({
  Recorder: (props: NonNullable<typeof seam.recorder>) => {
    seam.recorder = props;
    return null;
  },
}));
vi.mock("@/components/build-stamp", () => ({ BuildStamp: () => null }));
vi.mock("@/components/send-log-control", () => ({
  SendLogControl: () => null,
}));
vi.mock("@/hooks/mp3-codec", () => ({ warmEncoder: () => {} }));
vi.mock("@/hooks/finish-transcode", () => ({
  requestTranscodeSweep: () => Promise.resolve(),
  pauseTranscodeSweep: () => {},
  resumeTranscodeSweep: () => {},
}));
vi.mock("@/hooks/report-failure", () => ({ reportFailure: () => {} }));
vi.mock("@/hooks/use-database-status", () => ({
  useDatabaseStatus: () => "ok",
}));
vi.mock("@/hooks/use-audio-session", () => ({
  useAudioSession: () => audioSession,
}));
// The adapter's history work is its own suite's subject; here only the state
// halves App hands it matter, so they are called straight through.
vi.mock("@/hooks/use-nav-stack", () => ({
  useNavStack: (params: {
    onOpenChapter: (id: ChapterId) => void;
    onOpenRecorder: (segmentId: SegmentId, ordinal: number) => void;
    onLeaveToBooks: () => void;
    onRecorderClosed: (dirty: boolean) => void;
  }) => ({
    pushLayer: () => {},
    popLayer: () => {},
    openChapter: params.onOpenChapter,
    openRecorder: params.onOpenRecorder,
    goBack: params.onLeaveToBooks,
    commitCloseRecorder: params.onRecorderClosed,
  }),
}));
vi.mock("@/lib/storage/books", () => ({
  saveTake: () =>
    new Promise<void>((resolve, reject) => {
      seam.writes.push({ resolve, reject });
    }),
  clearSegmentTake: () => Promise.resolve(),
}));
vi.mock("@/lib/storage/clips", () => {
  let n = 0;
  return {
    newClipId: () => `clip-${++n}`,
    deleteClip: () => Promise.resolve(),
  };
});

const audioSession = { leave: () => {}, primeAudioContext: () => {} };

const SEGMENT_2 = "segment-2" as SegmentId;
const SEGMENT_5 = "segment-5" as SegmentId;

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  seam.books = null;
  seam.segments = null;
  seam.recorder = null;
  seam.writes = [];
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

/**
 * Mount App, open a chapter, and save-and-close segment 2 with its save left in
 * flight — a fresh recording, or an edit-only close.
 */
async function segmentTwoSaveInFlight(kind: "record" | "edit" = "record") {
  await act(async () => root.render(createElement(App)));
  await act(async () => seam.books!.onOpenChapter("chapter" as ChapterId));
  await act(async () => seam.segments!.onOpenRecorder(SEGMENT_2, 2));
  expect(seam.recorder?.segmentId).toBe(SEGMENT_2);
  const sheet = seam.recorder!;
  await act(async () => {
    if (kind === "record") {
      void sheet.saveRecording(
        SEGMENT_2,
        new Int16Array(0),
        new Int16Array([1, 2, 3]),
        0,
        false
      );
    } else {
      void sheet.saveEditedSegment(SEGMENT_2, new Int16Array([1, 2]), false);
    }
    sheet.onExit(true);
  });
  expect(seam.writes).toHaveLength(1);
  // The first attempt is in flight: no recovery screen, the list is back.
  expect(container.querySelector('[role="alertdialog"]')).toBeNull();
}

async function failFirstWrite() {
  await act(async () => {
    seam.writes[0]!.reject(new Error("write failed"));
  });
  const dialog = container.querySelector('[role="alertdialog"]');
  expect(dialog, "SaveFailed did not take the screen").not.toBeNull();
  return dialog!.textContent ?? "";
}

describe("SaveFailed names the held take's segment (#710)", () => {
  it("a segment opened while the first save is in flight does not relabel the take", async () => {
    await segmentTwoSaveInFlight();
    // Before segment 2's save settles, the translator opens segment 5.
    await act(async () => seam.segments!.onOpenRecorder(SEGMENT_5, 5));
    expect(seam.recorder?.segmentId).toBe(SEGMENT_5);

    const text = await failFirstWrite();
    expect(text).toContain("Your recording of segment 2 is still here.");
    expect(text).not.toContain("segment 5");
  });

  it("an edit-only save is named by its own segment the same way", async () => {
    await segmentTwoSaveInFlight("edit");
    await act(async () => seam.segments!.onOpenRecorder(SEGMENT_5, 5));

    const text = await failFirstWrite();
    expect(text).toContain("Your edited recording of segment 2 is still here.");
    expect(text).not.toContain("segment 5");
  });

  it("with no second open, the take is still named by its own segment", async () => {
    await segmentTwoSaveInFlight();
    const text = await failFirstWrite();
    expect(text).toContain("Your recording of segment 2 is still here.");
  });
});
