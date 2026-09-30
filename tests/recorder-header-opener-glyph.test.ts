import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Icon, type IconName } from "@/components/icon";
import { Recorder } from "@/components/recorder";
import type { Design } from "@/lib/design";
import { strings } from "@/lib/strings";
import type { UseAudioSession } from "@/hooks/use-audio-session";
import type { SegmentId } from "@/types/domain";

import { one, render } from "./render";
import { restingErase } from "./support";

/**
 * #1225 (DRI pick on the issue, verbatim: "Switch to ⋮ in rc.2
 * (Recommended)"): the recorder's record-mode header opener wears the `more`
 * glyph (⋮), not `menu` (≡), in BOTH looks. The recorder's menu acts on the
 * segment being edited, so it is an object menu under #608's rule; ≡ is the
 * Books screen's global menu alone.
 *
 * Rendered through `tests/render.ts`: the header's first paint carries the
 * opener, so no effect or event is needed to read it. The opener is found by
 * accessible name AND its drawn shapes are compared with what `Icon` itself
 * draws for each name, so a redraw of either icon cannot orphan a hand-copied
 * shape, and the header is scanned on its own.
 *
 * What this cannot see: the drawer's own dismiss (a portal, opened by a
 * click) is pinned in `tests/recorder-menu-header.test.ts`, and the same
 * opener in edit mode (#1243) in `tests/recorder-edit-mode-header.test.ts`.
 */

const design = vi.hoisted(() => ({ current: "current" as string }));
vi.mock("@/hooks/use-design", () => ({
  useDesign: () => ({ design: design.current, toggle: () => {} }),
}));
vi.mock("@/hooks/use-recorder-segment", () => {
  const samples = new Int16Array(100).fill(3);
  const view = {
    bookName: "Book",
    chapterNumber: 1,
    ordinal: 1,
    segmentLabel: null,
    finished: false,
    hasClip: true,
    peaks: null,
    lengthSamples: samples.length,
    samples,
  };
  return {
    useRecorderSegment: () => ({
      view,
      error: null,
      retrying: false,
      retry: () => {},
      reload: async () => view,
      setFinished: async () => {},
    }),
  };
});
vi.mock("@/components/waveform", () => ({ Waveform: () => null }));
vi.mock("@/components/live-scope", () => ({ LiveScope: () => null }));
vi.mock("@/components/vu-meter", () => ({ VuMeter: () => null }));

const noop = () => {};

const audio = {
  playingId: null,
  playingBuffer: false,
  playbackElapsedMs: 0,
  playbackRanOut: false,
  recorderState: "idle",
  elapsedMs: 0,
  supported: true,
  error: null,
  recorderError: null,
  meterFailed: false,
  takeCap: { nearLimit: false, remainingMs: 20 * 60_000, reached: false },
  playTake: noop,
  playBuffer: noop,
  stopBuffer: noop,
  readPlaybackPosition: () => null,
  startRecording: noop,
  stopRecording: async () => ({ samples: null, blob: null, error: null }),
  retryDecode: async () => ({ samples: null, error: null }),
  leave: noop,
  primeAudioContext: noop,
  readLevel: () => 0,
  readMeterAvailable: () => true,
  readScope: () => null,
  peekScope: () => null,
} as unknown as UseAudioSession;

/** The drawn shapes of an `Icon` of this name, as markup. */
function glyph(name: IconName): string {
  return one(render(createElement(Icon, { name })), "svg").innerHTML;
}

function headerOpenerGlyph(look: Design): string {
  design.current = look;
  const container = render(
    createElement(Recorder, {
      segmentId: "segment" as SegmentId,
      audio,
      erase: restingErase(),
      saveRecording: async () => true,
      saveEditedSegment: async () => true,
      clipboard: null,
      onClipboardChange: noop,
      databaseUnreachable: false,
      onExit: noop,
      onRequestBack: noop,
    })
  );
  const header = one(container, "header");
  const openers = [...header.querySelectorAll("button")].filter(
    (button) => button.getAttribute("aria-label") === strings.recorderMenuOpen
  );
  expect(
    openers,
    `one "More actions" opener in the ${look} header`
  ).toHaveLength(1);
  return one(openers[0]!, "svg").innerHTML;
}

describe("the recorder's record-mode header opener wears ⋮, not ≡ (#1225)", () => {
  beforeEach(() => {
    design.current = "current";
  });

  it.each(["current", "o4"] as const)(
    "draws the `more` glyph in the %s look",
    (look) => {
      const drawn = headerOpenerGlyph(look);
      expect(drawn).toBe(glyph("more"));
    }
  );
});
