import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The adapter asks the #435 latch before every history write a UI command
 * makes, and replays what it deferred at every landing.
 *
 * Like `nav-go-back-suppressed.test.ts`, this reads the hook's CODE rather
 * than driving `useNavStack`: the Node suite has no renderer that runs a
 * hook's effects. It strips comments and isolates each command's own body, so
 * a match elsewhere in the file cannot satisfy it. What it cannot see is the
 * order a browser delivers the calls in; `e2e/back-navigation.spec.ts` cases
 * (n) and (o) drive that.
 *
 * Mutations that must go red here: call `enterScreen()` straight from
 * `openChapter` or `openRecorder`; run a command's state half before its
 * refusal check; drop the `return` on refusal; arm the floor in `pushLayer`
 * with `pushHistoryEntry()` instead of `performWrite`; drop the replay from
 * the `popstate` listener, or run it before the landing is routed; replay
 * through `historyWriteDecision`, which can refuse.
 *
 * #802 adds one more replay-side mutation this file must catch: drop the
 * restore of `outcome.pending` when a write throws (the tail is lost again,
 * silently); or swallow the throw instead of rethrowing it (AGENTS.md —
 * "never swallow an error silently"). `tests/nav-history-latch.test.ts`'s
 * `replayQueue` block pins that the WALK itself stops at the throw and hands
 * back the right tail; this file pins that the adapter actually USES that
 * result rather than ignoring it.
 */
const sourceUrl = new URL("../src/hooks/use-nav-stack.ts", import.meta.url);

const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const code = stripComments(readFileSync(sourceUrl, "utf8"));

const matchingBraceClose = (body: string, openIndex: number): number => {
  let depth = 0;
  for (let i = openIndex; i < body.length; i++) {
    if (body[i] === "{") depth++;
    else if (body[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
};

/** The first `{ ... }` block after `marker`, braces included. */
const bodyAfter = (marker: string): string => {
  const start = code.indexOf(marker);
  if (start === -1) throw new Error(`${marker} not found — renamed or moved?`);
  const open = code.indexOf("{", start + marker.length);
  const close = matchingBraceClose(code, open);
  if (open === -1 || close <= open) {
    throw new Error(`${marker}: body braces not found`);
  }
  return code.slice(open, close + 1);
};

const index = (body: string, pattern: RegExp): number => {
  const at = body.search(pattern);
  expect(at, `${String(pattern)} not found`).toBeGreaterThanOrEqual(0);
  return at;
};

describe.each([
  ["openChapter", "onOpenChapterRef.current("],
  ["openRecorder", "onOpenRecorderRef.current("],
])("%s asks the latch before either half runs (#435)", (name, stateHalf) => {
  const body = bodyAfter(`const ${name} = useCallback(`);
  // Keyed by its own screen, so a repeat of this command coalesces in the
  // deferred queue and the other command's entry does not (`deferWrite`).
  const key = name === "openChapter" ? "enter-segments" : "enter-recorder";

  it("isolates a real body — non-empty, and it is the one that runs the state half", () => {
    expect(body.length).toBeGreaterThan(40);
    expect(body).toContain(stateHalf);
  });

  it("decides, returns on refusal, then runs the state half, then writes or defers", () => {
    const decide = index(body, /decideWrite\(\s*"enter-screen"\s*\)/);
    const refuse = index(
      body,
      /if\s*\(\s*decision\s*===\s*"refuse"\s*\)\s*return\s*;/
    );
    const state = body.indexOf(stateHalf);
    const write = index(
      body,
      new RegExp(`performWrite\\(\\s*"${key}"\\s*,\\s*decision\\s*\\)`)
    );
    expect(decide).toBeLessThan(refuse);
    expect(refuse).toBeLessThan(state);
    expect(state).toBeLessThan(write);
  });

  it("never writes history directly", () => {
    expect(body).not.toMatch(/enterScreen\s*\(/);
    expect(body).not.toMatch(/pushHistoryEntry\s*\(/);
    expect(body).not.toMatch(/window\.history\./);
  });
});

describe("pushLayer arms the floor through the latch (#435)", () => {
  const body = bodyAfter("const pushLayer = useCallback(");

  it("isolates a real body — the one that registers the layer", () => {
    expect(body).toMatch(/layerStack\.current\s*=/);
  });

  it("requests the arm rather than pushing it", () => {
    expect(body).toMatch(
      /performWrite\(\s*"arm-floor"\s*,\s*decideWrite\(\s*"arm-floor"\s*\)\s*\)/
    );
    expect(body).not.toMatch(/pushHistoryEntry\s*\(/);
    expect(body).not.toMatch(/window\.history\./);
    // Set at write time by armFloor, never at request time: flipped here, a
    // deferred arm would re-derive to a no-op and never push (George round 1).
    expect(body).not.toMatch(/floorArmed\.current\s*=/);
  });
});

describe("the latch's own plumbing", () => {
  it("performWrite queues a deferral through deferWrite, which coalesces repeats", () => {
    const performBody = bodyAfter("const performWrite = useCallback(");
    expect(performBody).toMatch(
      /deferredWrites\.current\s*=\s*deferWrite\(\s*deferredWrites\.current\s*,\s*write\s*\)/
    );
  });

  it("performWrite is the only caller of enterScreen() and armFloor()", () => {
    const performBody = bodyAfter("const performWrite = useCallback(");
    expect(code.match(/\benterScreen\(\)/g) ?? []).toHaveLength(1);
    expect(code.match(/\barmFloor\(\)/g) ?? []).toHaveLength(1);
    expect(performBody).toMatch(/\benterScreen\(\)/);
    expect(performBody).toMatch(/\barmFloor\(\)/);
  });

  it("the replay re-decides through replayDecision, which cannot refuse", () => {
    const replay = bodyAfter("const replayDeferredWrites = useCallback(");
    expect(replay).toMatch(/replayDecision\s*\(/);
    expect(replay).not.toMatch(/historyWriteDecision\s*\(/);
    expect(replay).toMatch(/deferredWrites\.current\s*=\s*\[\s*\]/);
  });

  it("the popstate listener routes the landing, THEN replays", () => {
    const listener = bodyAfter("const onPopState = (event: PopStateEvent) =>");
    const land = index(listener, /\bland\(\s*event\s*\)/);
    const replay = index(listener, /replayDeferredWrites\(\s*\)/);
    expect(land).toBeLessThan(replay);
    expect(code).toMatch(
      /addEventListener\(\s*"popstate"\s*,\s*onPopState\s*\)/
    );
  });
});

describe("replayDeferredWrites restores the unreplayed tail before it rethrows (#802)", () => {
  const replay = bodyAfter("const replayDeferredWrites = useCallback(");

  it("walks the queue through replayQueue rather than a bare loop", () => {
    expect(replay).toMatch(/replayQueue\(\s*queued\s*,/);
  });

  it("on a failed outcome, restores `pending` onto the ref before doing anything else with it", () => {
    const guard = index(replay, /if\s*\(\s*outcome\.ok\s*\)\s*return\s*;/);
    const restore = index(
      replay,
      /deferredWrites\.current\s*=\s*outcome\.pending\.reduce\(\s*deferWrite\s*,\s*deferredWrites\.current\s*\)/
    );
    const rethrow = index(replay, /throw\s+outcome\.cause\s*;/);
    expect(guard).toBeLessThan(restore);
    expect(restore).toBeLessThan(rethrow);
  });

  it("does not swallow the failure — no local catch, no reportFailure call in this body", () => {
    // AGENTS.md "never swallow an error silently": a throw from `perform` is
    // handled entirely inside `replayQueue` (`tests/nav-history-latch.test.ts`
    // pins that), so this body has no `try`/`catch` of its own and does not
    // report through the funnel — it rethrows, rejoining the same uncaught
    // path every other bare `window.history` call in this file already takes.
    expect(replay).not.toMatch(/\btry\s*\{/);
    expect(replay).not.toMatch(/reportFailure\(/);
  });
});

describe("the programmatic recorder close is arbitrated, not a raw back() (#763)", () => {
  const close = bodyAfter("const commitCloseRecorder = useCallback(");
  const consume = bodyAfter("const consumeRecorderEntry = useCallback(");
  const replay = bodyAfter("const replayDeferredWrites = useCallback(");

  it("isolates real bodies — the close runs the state half, the consume decides", () => {
    expect(close).toContain("onRecorderClosedRef.current(");
    expect(consume).toMatch(
      /recorderExitTraversal\(\s*suppressPop\.current\s*,\s*travelGuard\.current\s*,\s*deferredWrites\.current\s*\)/
    );
  });

  it("the close hands its history tail to consumeRecorderEntry and touches no history itself", () => {
    expect(close).toMatch(
      /if\s*\(\s*!transitionInFlight\.current\s*\)\s*consumeRecorderEntry\(\s*\)/
    );
    expect(close).not.toMatch(/window\.history\./);
    expect(close).not.toMatch(/suppressPop\.current\s*=/);
  });

  it(
    'the consume issues its one back() only when beginBack("commit-close") returns ok, ' +
      "and arms nothing on refusal (#838 item 2, Frank r1 on #854)",
    () => {
      // Exactly one window.history.back() in the whole consume body — the
      // "issue" row's ok branch — not one per row and not an unconditional
      // call outside the ok check.
      const backs = consume.match(/window\.history\.back\s*\(\s*\)/g) ?? [];
      expect(backs).toHaveLength(1);

      const beginIdx = index(
        consume,
        /const\s+begun\s*=\s*beginBack\(\s*travelGuard\.current\s*,\s*"commit-close"\s*\)/
      );
      const ifIdx = consume.indexOf("if", beginIdx);
      const ifBraceOpen = consume.indexOf("{", ifIdx);
      const ifBraceClose = matchingBraceClose(consume, ifBraceOpen);
      expect(ifBraceOpen).toBeGreaterThan(-1);
      expect(ifBraceClose).toBeGreaterThan(ifBraceOpen);
      const ifBody = consume.slice(ifBraceOpen, ifBraceClose + 1);

      // Everything after the ok branch up to the row's return: the refusal path.
      const rowReturn = consume.indexOf("return", ifBraceClose);
      expect(rowReturn).toBeGreaterThan(ifBraceClose);
      const refusalPath = consume.slice(ifBraceClose + 1, rowReturn);

      // The ok branch: sets the guard from begun.next, absorbs, THEN calls
      // the one back() — the same order the commit-close settle's ok branch
      // uses (`nav-commit-close-race-guards.test.ts` pins that arm).
      expect(ifBody).toMatch(/travelGuard\.current\s*=\s*begun\.next/);
      expect(ifBody).toMatch(/suppressPop\.current\s*=\s*true/);
      expect(
        ifBody.match(/window\.history\.back\s*\(\s*\)/g) ?? []
      ).toHaveLength(1);

      // The refusal path: no landing is in flight on this row, so it must
      // neither arm suppressPop (goBack would swallow the next Back — Frank
      // r1 on #854) nor issue a back().
      expect(refusalPath).not.toMatch(/suppressPop\.current\s*=/);
      expect(refusalPath).not.toMatch(/window\.history\.back\s*\(/);
    }
  );

  it("the replay hands a deferred consume back to consumeRecorderEntry, not to performWrite", () => {
    expect(replay).toMatch(
      /if\s*\(\s*write\s*===\s*"consume-recorder"\s*\)\s*\{\s*consumeRecorderEntry\(\s*\)\s*;\s*return\s*;\s*\}/
    );
  });
});
