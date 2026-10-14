// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "@/app/App";
import { claimPhoneCheckRun } from "@/hooks/use-phone-check";
import type { Layer } from "@/lib/nav/layer-stack";
import type { ChapterId, SegmentId } from "@/types/domain";

/**
 * #1014 items 1 and 4, both reached only by mounting the real `App`.
 *
 * Item 1: no test failed if `App`'s `canRevealPhoneCheck` gating were removed
 * — the BuildStamp reveal gesture is the phone check's one way in on a build
 * with no address bar, and offering it while a chapter, the recorder sheet or
 * an unsaved take is in hand would let it unmount work the check has no
 * recovery for (App.tsx's own comment above the gate). This mounts the real
 * `App` and asserts what `onReveal` the real `BuildStamp` receives in each
 * state, the same seam `tests/app-save-failed-ordinal.test.ts` uses for the
 * same component.
 *
 * Item 4: Close must drop `?check=phone` from the URL, or a later reload of
 * the same tab reopens the check the tester just left. `PhoneCheckScreen` is
 * mocked here (its own `usePhoneCheck` behaviour is `tests/use-phone-check-*`
 * and `tests/phone-check-*`'s subject) so this file tests only what `App`
 * does with the `onClose` it hands the screen.
 */

const seam = vi.hoisted(() => {
  type Settle = { resolve: () => void; reject: (cause: unknown) => void };
  return {
    books: null as null | {
      onOpenChapter: (id: ChapterId) => void;
    },
    segments: null as null | {
      onOpenRecorder: (segmentId: SegmentId, ordinal: number) => void;
      onBack: () => void;
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
      onExit: (dirty: boolean) => void;
    },
    buildStamp: null as null | { onReveal?: () => void },
    phoneCheck: null as null | { onClose: () => void },
    layers: [] as Layer[],
    popped: [] as string[],
    layerOpen: false,
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
vi.mock("@/components/build-stamp", () => ({
  BuildStamp: (props: NonNullable<typeof seam.buildStamp>) => {
    seam.buildStamp = props;
    return null;
  },
}));
vi.mock("@/components/phone-check-screen", () => ({
  PhoneCheckScreen: (props: NonNullable<typeof seam.phoneCheck>) => {
    seam.phoneCheck = props;
    return null;
  },
}));
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
vi.mock("@/hooks/use-nav-stack", async (importOriginal) => {
  // `useNavStack` itself is replaced with the same state-routing stub every
  // other App-mount test uses; `clearPhoneCheckQueryParam` is kept REAL
  // (`importOriginal`), since item 4's own fix lives there and this file's
  // "Close drops ?check=phone" tests assert what it actually does to
  // `window.location`.
  const actual = await importOriginal<typeof import("@/hooks/use-nav-stack")>();
  return {
    clearPhoneCheckQueryParam: actual.clearPhoneCheckQueryParam,
    useNavStack: (params: {
      onOpenChapter: (id: ChapterId) => void;
      onOpenRecorder: (segmentId: SegmentId, ordinal: number) => void;
      onLeaveToBooks: () => void;
      onRecorderClosed: (dirty: boolean) => void;
    }) => ({
      pushLayer: (layer: Layer) => {
        seam.layers.push(layer);
      },
      popLayer: (id: string) => {
        seam.popped.push(id);
      },
      hasOpenLayer: () => seam.layerOpen,
      openChapter: params.onOpenChapter,
      openRecorder: params.onOpenRecorder,
      goBack: params.onLeaveToBooks,
      commitCloseRecorder: params.onRecorderClosed,
    }),
  };
});
vi.mock("@/lib/storage/takes", () => ({
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

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  seam.books = null;
  seam.segments = null;
  seam.recorder = null;
  seam.buildStamp = null;
  seam.phoneCheck = null;
  seam.writes = [];
  seam.layers = [];
  seam.popped = [];
  seam.layerOpen = false;
  window.history.replaceState(null, "", "/");
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

describe("App offers the phone check reveal only with nothing in hand (#1014 item 1)", () => {
  it("offers it on a fresh Books screen", async () => {
    await act(async () => root.render(createElement(App)));
    expect(typeof seam.buildStamp?.onReveal).toBe("function");
  });

  it("withholds it once a chapter is open", async () => {
    await act(async () => root.render(createElement(App)));
    await act(async () => seam.books!.onOpenChapter("chapter" as ChapterId));
    expect(seam.buildStamp?.onReveal).toBeUndefined();
  });

  it("withholds it while the recorder sheet is open", async () => {
    await act(async () => root.render(createElement(App)));
    await act(async () => seam.books!.onOpenChapter("chapter" as ChapterId));
    await act(async () => seam.segments!.onOpenRecorder(SEGMENT_2, 2));
    expect(seam.recorder?.segmentId).toBe(SEGMENT_2);
    expect(seam.buildStamp?.onReveal).toBeUndefined();
  });

  it("withholds it back on Books while a save from a closed sheet is still in flight", async () => {
    await act(async () => root.render(createElement(App)));
    await act(async () => seam.books!.onOpenChapter("chapter" as ChapterId));
    await act(async () => seam.segments!.onOpenRecorder(SEGMENT_2, 2));
    const sheet = seam.recorder!;
    await act(async () => {
      void sheet.saveRecording(
        SEGMENT_2,
        new Int16Array(0),
        new Int16Array([1, 2, 3]),
        0,
        false
      );
      sheet.onExit(true);
    });
    expect(seam.writes).toHaveLength(1);
    // Back to Books: chapterId and recorder are both null again, but the
    // write above has not settled, so `pendingTake` is still held.
    await act(async () => seam.segments!.onBack());
    expect(seam.buildStamp?.onReveal).toBeUndefined();

    // Control: once the write lands, the gate opens again.
    await act(async () => seam.writes[0]!.resolve());
    expect(typeof seam.buildStamp?.onReveal).toBe("function");
  });
});

describe("Close drops ?check=phone from the URL (#1014 item 4)", () => {
  it("strips the param but keeps the rest of the URL and the history state", async () => {
    const navState = { tc: true, index: 0 };
    window.history.replaceState(navState, "", "/?check=phone&foo=bar#frag");

    await act(async () => root.render(createElement(App)));
    expect(seam.phoneCheck).not.toBeNull();

    await act(async () => seam.phoneCheck!.onClose());

    expect(window.location.search).not.toContain("check");
    expect(window.location.search).toContain("foo=bar");
    expect(window.location.hash).toBe("#frag");
    expect(window.history.state).toEqual(navState);
  });

  it("is a no-op on the URL when there was no ?check param to begin with", async () => {
    window.history.replaceState(null, "", "/?check=phone");
    await act(async () => root.render(createElement(App)));
    await act(async () => seam.phoneCheck!.onClose());
    const before = window.location.href;

    // Reopen via the reveal gesture (no ?check involved this time) and close
    // again — nothing left to strip, so the URL must not change at all.
    await act(async () => seam.buildStamp?.onReveal?.());
    await act(async () => seam.phoneCheck!.onClose());
    expect(window.location.href).toBe(before);
  });
});

describe("The phone check is a system-Back layer and honours Books overlays (#1014 items 3 and 5)", () => {
  it("refuses the reveal while a screen overlay is registered, and opens nothing", async () => {
    await act(async () => root.render(createElement(App)));
    seam.layerOpen = true;
    await act(async () => seam.buildStamp?.onReveal?.());
    expect(seam.phoneCheck).toBeNull();
    expect(seam.layers).toHaveLength(0);

    // Control: the same tap with no overlay open does reveal it.
    seam.layerOpen = false;
    await act(async () => seam.buildStamp?.onReveal?.());
    expect(seam.phoneCheck).not.toBeNull();
  });

  it("registers one layer on reveal whose dismiss closes the check and pops it", async () => {
    await act(async () => root.render(createElement(App)));
    await act(async () => seam.buildStamp?.onReveal?.());
    expect(seam.layers.map((l) => l.id)).toEqual(["phone-check"]);

    seam.phoneCheck = null;
    await act(async () => seam.layers[0]!.dismiss());
    expect(seam.popped).toContain("phone-check");
    expect(seam.phoneCheck).toBeNull();
    expect(typeof seam.buildStamp?.onReveal).toBe("function");
  });

  it("reports the layer busy exactly while a run holds the slot", async () => {
    await act(async () => root.render(createElement(App)));
    await act(async () => seam.buildStamp?.onReveal?.());
    const layer = seam.layers[0]!;
    expect(layer.busy()).toBe(false);
    const release = claimPhoneCheckRun();
    expect(release).not.toBeNull();
    try {
      expect(layer.busy()).toBe(true);
    } finally {
      release?.();
    }
    expect(layer.busy()).toBe(false);
  });

  it("pops the layer when Close is tapped", async () => {
    await act(async () => root.render(createElement(App)));
    await act(async () => seam.buildStamp?.onReveal?.());
    await act(async () => seam.phoneCheck!.onClose());
    expect(seam.popped).toContain("phone-check");
  });
});
