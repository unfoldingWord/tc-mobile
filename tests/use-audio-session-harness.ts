import {
  act,
  createElement,
  createRef,
  forwardRef,
  useImperativeHandle,
  type RefObject,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi, type Mock } from "vitest";

import {
  useAudioSession,
  type UseAudioSession,
} from "@/hooks/use-audio-session";
import type { SegmentId } from "@/types/domain";
import type { SegmentRow } from "@/types/view";

/**
 * Shared jsdom-mount harness for `useAudioSession` (#816, umbrella #533).
 *
 * Three files mounted the real hook the same way — `tests/use-audio-session
 * -supersession.test.ts` (#650/#735), `tests/use-audio-session-buffer
 * -supersession.test.ts` (#736), and `tests/use-audio-session-ran-out.test.ts`
 * (#361) — each carrying its own copy of the `Harness` component, the stable
 * `recorderMock` object, and the `./audio-io` / `./use-recorder` /
 * `@/lib/storage/segment-audio` mock shapes. This module is that one copy.
 *
 * ## Where this lives, and why not `tests/render.ts` or `tests/support.ts`
 *
 * `tests/render.ts` is the static-markup harness #197 built, and its own
 * docblock is explicit that its whole point is "no effects, no `act()`, no
 * events" — folding a live `createRoot` + `act()` + hook-graph mount in here
 * would contradict the contract that file exists to keep. `tests/support.ts`
 * is storage/codec plumbing (`clearAllStores`, `testCodec`, `samplesOf`,
 * `ramp`) with no React or jsdom surface at all. Neither fits, so this is a
 * new sibling module next to `render.ts`, kept just as single-purpose.
 *
 * ## `vi.mock` hoisting: what stays in each test file, and why
 *
 * Vitest's hoisting transform is static and per-file: a literal `vi.mock(...)`
 * (or `vi.hoisted(...)`) call written IN a test file is moved above that
 * file's own `import` statements in the generated code. This module (a value
 * import of the real `useAudioSession`, for `Harness`) is itself imported by
 * every converted test file, so loading it drags in the REAL
 * `@/hooks/use-audio-session` → `./audio-io` chain as a side effect of that
 * single `import {...} from "./use-audio-session-harness"` line — which is
 * exactly the import whose mocked target (`@/hooks/audio-io`) a hoisted
 * `vi.mock("@/hooks/audio-io", ...)` factory is registered against.
 *
 * A first attempt here tried to build that factory's return value by calling
 * an EXPORTED FUNCTION from this same module — `() => audioIoMock(mocks)` —
 * and it failed with `ReferenceError: Cannot access '__vi_import_1__' before
 * initialization`, observed by running the three converted suites (the PR
 * body has the output). The cause: the factory is invoked the moment
 * `@/hooks/audio-io` is first resolved, which happens WHILE this very module
 * is still mid-load (nested inside the `use-audio-session` import above) —
 * before the test file's own binding for this module's exports is live. A
 * plain top-level statement AFTER the import (`const recorderMock =
 * makeRecorderMock();`) does not hit this: it only runs once the whole
 * import has settled. Nor does a value merely CAPTURED in a closure and read
 * later (`() => ({ useRecorder: () => recorderMock })` — `recorderMock` is
 * not dereferenced until `useRecorder()` is actually called, at render time,
 * long after module load finishes). What breaks is calling an imported
 * function that lives on the same import chain the mock is standing in for,
 * DURING the factory's own synchronous execution.
 *
 * So: each converted file keeps its own `vi.hoisted(...)` mocks object and
 * its own three literal `vi.mock("@/hooks/audio-io", () => ({...}))` /
 * `vi.mock("@/hooks/use-recorder", () => ({...}))` /
 * `vi.mock("@/lib/storage/segment-audio", () => ({...}))` calls — each a few
 * lines, referencing only that file's own hoisted `mocks` and a plain
 * `recorderMock` constant built from `makeRecorderMock()` below. Everything
 * that does NOT need to be read from inside a `vi.mock` factory —
 * `makeRecorderMock`, `mountContainer`/`unmountContainer`, `renderHarness`
 * (which mounts the internal `Harness` component and builds its API
 * accessor), `row`, `resolvedClip`, `stubHandle`, `deferredHandle`, `flush`
 * — is shared from here without issue, because none of it is referenced from
 * inside a mock factory's immediate (synchronous) body.
 */

/** The shape `@/hooks/use-recorder`'s mock hands back. Kept structural rather
 * than importing `UseRecorder` — every field here is read by
 * `useAudioSession`, and importing the real type would let `lib/`-adjacent
 * hook changes silently widen what this harness has to fake. */
export interface RecorderMockShape {
  start: Mock;
  stop: Mock;
  retryDecode: Mock;
  cancel: Mock;
  state: string;
  error: null;
  elapsedMs: number;
  supported: boolean;
  readLevel: () => number;
  readMeterAvailable: () => boolean;
  readScope: () => null;
  peekScope: () => null;
  meterFailed: boolean;
}

/**
 * A fresh, STABLE recorder mock object — call this once per test file (a
 * plain top-level statement, not inside a `vi.mock` factory or a test body)
 * and reuse the result.
 *
 * `useAudioSession`'s `leave` effect depends on `recorder.cancel`'s identity
 * (among other recorder fields), and that effect's cleanup re-fires whenever
 * `leave` changes identity. A `useRecorder` mock that handed back a *new*
 * object — or fresh `vi.fn()`s — on every call would make every render's
 * commit look like a distinct recorder, rerunning that cleanup and resetting
 * `playingId` to `null` before a test ever reads it.
 */
export function makeRecorderMock(): RecorderMockShape {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    retryDecode: vi.fn(),
    cancel: vi.fn(),
    state: "idle",
    error: null,
    elapsedMs: 0,
    supported: true,
    readLevel: () => 0,
    readMeterAvailable: () => true,
    readScope: () => null,
    peekScope: () => null,
    meterFailed: false,
  };
}

/** A minimal `SegmentRow`, enough to drive `playTake`. */
export function row(id: string): SegmentRow {
  return {
    segmentId: id as SegmentId,
    ordinal: 1,
    label: null,
    hasClip: true,
    finished: false,
    clipId: null,
    peaks: null,
    durationMs: null,
  };
}

/** A resolved clip minimal enough to drive `playTake`'s pcm branch. */
export function resolvedClip(samples: Int16Array) {
  return {
    kind: "resolved",
    segment: {},
    take: {},
    clip: { encoding: "pcm", meta: {}, samples },
  };
}

/** A settled `playSamples`-style handle, for tests that resolve a deferred
 * call and then read what got adopted. */
export function stubHandle(elapsedSeconds: number) {
  return { stop: vi.fn(), elapsed: () => elapsedSeconds, duration: 10 };
}

/** A `playSamples` call this test settles from outside, on its own schedule. */
export function deferredHandle<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Drains the microtask queue enough for `playTake`/`playBuffer`'s async work
 * (the `loadSegmentClip` await, the `playSamples` call) to settle. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

/**
 * Mounts `useAudioSession` in jsdom via `createRoot`/`act`, exposing its
 * return value through an imperative handle. A ref, not a reassigned
 * module-level binding: `react-hooks/globals` bans writing an outer variable
 * during render as a side effect, and `useImperativeHandle` commits after
 * render, like the `RecorderHandle` pattern other jsdom-mounted tests here
 * already use (`tests/recorder-superseded-writes.test.ts`).
 */
const Harness = forwardRef<UseAudioSession>((_props, ref) => {
  const api = useAudioSession();
  useImperativeHandle(ref, () => api, [api]);
  return null;
});

/** A fresh container mounted with `createRoot`, ready for `renderHarness`. */
export function mountContainer(): { root: Root; container: HTMLDivElement } {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  return { root, container };
}

/** Unmounts and detaches a container built by `mountContainer`. */
export async function unmountContainer(
  root: Root,
  container: HTMLDivElement
): Promise<void> {
  await act(async () => root.unmount());
  container.remove();
}

/** Renders `Harness` into `root` and returns an accessor for the mounted
 * `useAudioSession` API that throws, naming the cause, rather than reading a
 * property through a null `ref.current`. */
export async function renderHarness(
  root: Root
): Promise<() => UseAudioSession> {
  const ref = createRef<UseAudioSession>();
  await act(async () => {
    root.render(createElement(Harness, { ref }));
  });
  return apiFrom(ref);
}

/** An accessor for a `Harness` ref that throws, naming the cause, rather than
 * reading a property through a null `ref.current`. */
function apiFrom(
  ref: RefObject<UseAudioSession | null>
): () => UseAudioSession {
  return () => {
    if (!ref.current) throw new Error("Harness did not mount useAudioSession");
    return ref.current;
  };
}
