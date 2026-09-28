// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";

import {
  makeRecorderMock,
  mountContainer,
  renderHarness,
  unmountContainer,
} from "./use-audio-session-harness";

/**
 * #1005 residual (ii): `takeCap` reached `UseRecorder` in #1076, but
 * `use-audio-session.ts` — the object the recorder SCREEN actually reads
 * (`RecorderAudio`, `recorder.tsx`) — never forwarded it. This is red-first
 * against that gap: before the one-line forward this asserted `undefined`
 * where the recorder's own `takeCap` object was expected.
 *
 * `tests/audio-views.test.ts`'s `onlyPrimeIsUnclassified` type-level
 * assertion already fails `tsc` if `takeCap` is added to `UseAudioSession`
 * without also adding it to `RecorderAudio`'s `Pick` — that is the
 * compile-time half of this same guarantee. This file is the RUNTIME half:
 * that the forwarded value is the recorder's own, not a stale default.
 */
const recorderMock = makeRecorderMock();

vi.mock("@/hooks/audio-io", () => ({
  resumeAudioContext: vi.fn().mockResolvedValue(undefined),
  decodeMp3ToCanonical: vi.fn(),
  playSamples: vi.fn(),
}));
vi.mock("@/hooks/use-recorder", () => ({
  useRecorder: () => recorderMock,
}));
vi.mock("@/lib/storage/segment-audio", () => ({
  loadSegmentClip: vi.fn(),
  danglingReason: vi.fn().mockReturnValue(null),
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  ({ root, container } = mountContainer());
});

afterEach(async () => {
  await unmountContainer(root, container);
  vi.unstubAllGlobals();
});

it("forwards the recorder's takeCap onto the session it hands the screen", async () => {
  recorderMock.takeCap = {
    nearLimit: true,
    remainingMs: 42_000,
    reached: false,
  };

  const api = await renderHarness(root);

  expect(api().takeCap).toEqual({
    nearLimit: true,
    remainingMs: 42_000,
    reached: false,
  });
});

it("is not a fixed default: a different recorder status forwards too", async () => {
  // Guards against a forward that hard-codes a constant instead of reading
  // `recorder.takeCap` — the same recorder mock, a different status.
  recorderMock.takeCap = {
    nearLimit: false,
    remainingMs: 20 * 60_000,
    reached: false,
  };

  const api = await renderHarness(root);

  expect(api().takeCap.nearLimit).toBe(false);
  expect(api().takeCap.remainingMs).toBe(20 * 60_000);
});
