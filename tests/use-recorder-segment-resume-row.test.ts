import "fake-indexeddb/auto";

import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { resumeAudioContext } from "@/hooks/audio-io";
import { reportFailure } from "@/hooks/report-failure";
import { useRecorderSegment } from "@/hooks/use-recorder-segment";
import { lightsFailureMarker } from "@/lib/failure-marker";
import { addChapter, addSegment, createBook } from "@/lib/storage/books";
import { closeDb, getDb } from "@/lib/storage/db";
import type { SegmentId } from "@/types/domain";

/**
 * The resume fired in the "Try again" tap, before a load retry, used to end at
 * `console.error`. It now also writes one failure-log row under
 * `"recorder-segment-resume-retry"`, and the retry still goes ahead: the
 * resume is fire-and-forget and never gates the re-read.
 */

vi.mock("@/hooks/report-failure", () => ({ reportFailure: vi.fn() }));
vi.mock("@/hooks/audio-io", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/audio-io")>();
  return { ...actual, resumeAudioContext: vi.fn(actual.resumeAudioContext) };
});

let dom: JSDOM;
let root: Root;
const probe: { current: ReturnType<typeof useRecorderSegment> | null } = {
  current: null,
};

function Probe({ segmentId }: { segmentId: SegmentId }) {
  const result = useRecorderSegment(segmentId);
  useLayoutEffect(() => {
    probe.current = result;
  });
  return null;
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  await closeDb();
  const db = await getDb();
  const stores = Array.from(db.objectStoreNames);
  const tx = db.transaction(stores, "readwrite");
  await Promise.all([...stores.map((s) => tx.objectStore(s).clear()), tx.done]);
  dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>"
  );
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(dom.window.document.getElementById("root")!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('a rejected resume before retry reports "recorder-segment-resume-retry" and the retry still runs', async () => {
  const book = await createBook("Ruth");
  const chapter = await addChapter(book.id);
  const segment = await addSegment(chapter.id);
  await act(async () => {
    root.render(createElement(Probe, { segmentId: segment.id }));
  });
  await vi.waitFor(() => expect(probe.current?.view).not.toBeNull());

  const cause = new Error("resume refused");
  vi.mocked(resumeAudioContext).mockRejectedValueOnce(cause);
  await act(async () => {
    probe.current!.retry();
  });

  await vi.waitFor(() =>
    expect(reportFailure).toHaveBeenCalledExactlyOnceWith(
      cause,
      "recorder-segment-resume-retry"
    )
  );
  await vi.waitFor(() => expect(probe.current?.retrying).toBe(false));
  expect(probe.current?.view).not.toBeNull();
});

it("a routine, recoverable resume refusal is logged without lighting the marker", () => {
  expect(lightsFailureMarker("recorder-segment-resume-retry")).toBe(false);
});
