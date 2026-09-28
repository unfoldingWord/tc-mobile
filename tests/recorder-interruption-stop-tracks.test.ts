import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { bodyAfter, matchingBraceClose, stripComments } from "./support";

/**
 * `onInterrupted`'s inactive arm in `start()` (`src/hooks/use-recorder.ts`)
 * releases the mic when an interruption finds the native recorder already
 * `"inactive"` — the chunks are final, so stopping the tracks drops no audio.
 * Before this PR it did so with a bare
 * `stream?.getTracks().forEach((track) => track.stop());`: a throwing first
 * `stop()` skips the remaining tracks AND `closeTap()`, and the throw escapes
 * into the `onended`/`onerror` handler rather than reaching a caller — the
 * `"still-active arm"` this same handler already guards is untouched, but the
 * "chunks are final, release everything" arm was not (#779 item 1, carried
 * from #479/#780).
 *
 * `releaseStream` and `abandonStream` (`use-recorder.ts`) and the level tap's
 * `close()` (`audio-io.ts`) already route through the shared, guarded
 * `stopTracks(stream, context)` helper (#479/#780): each track's `stop()` runs
 * inside its own try, a throw is sent to `reportFailure` instead of escaping,
 * and the loop still stops every track. This PR routes the inactive arm's
 * loop through the same helper, reusing `"recorder-release-track"` — the
 * context `releaseStream`/`abandonStream` already report under for the exact
 * same action (stopping the shared capture stream's tracks once capture is
 * done) — rather than minting a fourth context for a fourth call site doing
 * the same thing.
 *
 * WHY A TEXT GATE AND NOT A BEHAVIOURAL TEST. `onInterrupted` is a closure
 * created inside `start()`, itself a `useCallback` inside `useRecorder()`.
 * `tests/recorder-failure-rows.test.ts` already established that this suite
 * cannot mount the hook or reach this handler at runtime: jsdom implements
 * neither `MediaRecorder` nor `AudioContext`. `stopTracks` itself already has
 * a behavioural, throwing-track test in `tests/stop-tracks.test.ts` (#780) —
 * what is new and unverifiable at runtime here is that THIS call site was
 * wired through it. So this is a source-text pin, in the same style
 * `tests/stop-tracks.test.ts` already uses for `releaseStream` and
 * `abandonStream`: the guarded helper call is present, and the unguarded
 * `.stop()` it replaces is gone, inside the exact brace-counted block.
 *
 * WHAT IT PROVES, EXACTLY: text shape only, at this one call site. It does
 * NOT prove `stopTracks` behaves correctly at runtime (that is
 * `tests/stop-tracks.test.ts`'s job) or that any phone has ever reached the
 * inactive arm with a throwing track. No engine has been seen to throw from
 * `MediaStreamTrack.stop()`, and this has not been run on a device.
 */

const sourceUrl = new URL("../src/hooks/use-recorder.ts", import.meta.url);
const code = stripComments(readFileSync(sourceUrl, "utf8"));

const startBody = bodyAfter(code, "const start = useCallback");
const handlerBody = bodyAfter(
  startBody,
  "const onInterrupted = (event: Event) => {"
);

/** The brace-counted body of `if (recorder.state === "inactive") { ... }`
 *  inside `onInterrupted`, isolated so an assertion below cannot be satisfied
 *  by a `stopTracks(...)` call that lives on the still-active (`else if`)
 *  arm instead — the two arms release the mic under very different
 *  conditions (#478), and only the inactive one is this item's scope. */
function inactiveArmBody(): string {
  const inactiveIf = 'if (recorder.state === "inactive") {';
  const start = handlerBody.indexOf(inactiveIf);
  expect(start, "inactive-arm `if` not found").toBeGreaterThan(-1);
  const open = handlerBody.indexOf("{", start);
  const close = matchingBraceClose(handlerBody, open);
  expect(close, "inactive-arm closing brace not found").toBeGreaterThan(open);
  return handlerBody.slice(open, close + 1);
}

describe("onInterrupted's inactive arm releases the stream through stopTracks (#779 item 1, carried from #479/#780)", () => {
  it('calls stopTracks(stream, "recorder-release-track"), reusing the release-track context releaseStream/abandonStream already use', () => {
    const body = inactiveArmBody();
    expect(body).toMatch(
      /if\s*\(\s*stream\s*\)\s*stopTracks\(\s*stream,\s*"recorder-release-track"\s*\)\s*;/
    );
  });

  it("holds no bare track.stop() loop any more", () => {
    const body = inactiveArmBody();
    expect(body).not.toMatch(/\.stop\s*\(\s*\)/);
    expect(body).not.toMatch(/getTracks\s*\(\s*\)\s*\.forEach/);
  });

  it("still calls closeTap() right after releasing the tracks, so the meter graph is torn down in the same arm", () => {
    const body = inactiveArmBody();
    expect(body).toMatch(
      /if\s*\(\s*stream\s*\)\s*stopTracks\(\s*stream,\s*"recorder-release-track"\s*\)\s*;\s*closeTap\s*\(\s*\)\s*;/
    );
  });

  it("calls stopTracks exactly once in this arm", () => {
    const body = inactiveArmBody();
    expect(body.match(/stopTracks\s*\(/g) ?? []).toHaveLength(1);
  });

  it("the still-active (else if) arm is untouched: it has no stopTracks call of its own", () => {
    // Scoped isolation check: a stopTracks call added to the OTHER arm (or
    // between the two) must not let the inactive-arm assertions above pass
    // by accident. The still-active arm releases nothing (#478) — that is
    // unchanged by this item.
    const inactiveIf = 'if (recorder.state === "inactive") {';
    const inactiveStart = handlerBody.indexOf(inactiveIf);
    const inactiveOpen = handlerBody.indexOf("{", inactiveStart);
    const inactiveClose = matchingBraceClose(handlerBody, inactiveOpen);
    const rest = handlerBody.slice(inactiveClose + 1);
    expect(rest).not.toMatch(/stopTracks\s*\(/);
  });
});
