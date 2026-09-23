import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  classifyFailureLogOpenError,
  type LogShareCapabilities,
  selectLogShareShape,
} from "@/hooks/use-failure-log-share";

/** Source-shape reads, because there is no renderer here (#197). */
const read = (rel: string) =>
  readFileSync(path.resolve(import.meta.dirname, "..", rel), "utf8");

/**
 * #205 — which shape the durable failure log leaves the phone in.
 *
 * The two-gesture flow around this decision is React + browser glue this repo
 * has no renderer to exercise (the constraint `tests/share-flow.test.ts`
 * documents). The decision itself is pure, and it is the part with the history:
 * every review round so far has found a bug in it, each one the same mistake —
 * making a capability the log does not need a precondition for sending it.
 *
 *   - round 1 (George): the log rode the File-only share flow, so a platform
 *     that refuses a `text/plain` File refused the log permanently;
 *   - round 2 (Frank): an ABSENT `navigator.canShare` was read as "files work",
 *     arming the file branch on exactly the browsers that cannot take one;
 *   - takeover round 1 (Frank): the whole thing was gated on `navigator.share`,
 *     which the Android System WebView the training's APK runs in may not have
 *     (#336) — so the log was unsendable on the platform it was written for;
 *   - takeover rounds 2 and 5 (Frank): the web capabilities were read BEFORE the
 *     route was chosen, so a WebView that throws on those reads took the native
 *     route down with it, for answers that route never uses.
 *
 * Each of those is a case below. The last one is why every web-side field is a
 * thunk: "native asks the WebView nothing" is then a property this file can hold
 * the function to, rather than a claim about whoever calls it.
 */

/** A Web Share Level 2 browser answering `file` and `text` as given. */
const LEVEL_2 = (file: boolean, text: boolean): LogShareCapabilities => ({
  native: false,
  webShare: () => true,
  canShare: () => ({ file: () => file, text: () => text }),
});

/** Every web-side probe throws — a WebView of the class #336 exists for. */
const BROKEN_WEBVIEW = () => {
  throw new Error("this WebView's Web Share is broken");
};

describe("selectLogShareShape", () => {
  it("sends through the native plugin inside the shell, whatever the WebView can do", () => {
    // The training build IS this case: an APK and a TestFlight app. The plugin
    // needs no Web Share, so a WebView without it must not block the log.
    expect(
      selectLogShareShape({
        native: true,
        webShare: () => false,
        canShare: () => null,
      })
    ).toBe("native");
    // And native wins even where Web Share exists: a WebView's Web Share is the
    // thing that has already failed in the field (#336), so it is not consulted.
    expect(
      selectLogShareShape({
        native: true,
        webShare: () => true,
        canShare: () => ({ file: () => true, text: () => true }),
      })
    ).toBe("native");
  });

  it("asks the WebView NOTHING on the native route, not even whether it can share", () => {
    // The sharper half of "native wins" (Frank, takeover rounds 2 and 5). On a
    // WebView whose `share`/`canShare` access throws, a decision that reads the
    // web capabilities before choosing kills the native route for an answer it
    // never reads — inside the shell the October training runs on.
    const webShare = vi.fn(BROKEN_WEBVIEW);
    const canShare = vi.fn(BROKEN_WEBVIEW);

    expect(selectLogShareShape({ native: true, webShare, canShare })).toBe(
      "native"
    );
    expect(webShare).not.toHaveBeenCalled();
    expect(canShare).not.toHaveBeenCalled();
  });

  it("does not ask about text when the file was accepted", () => {
    // Not an optimisation — one fewer question put to a WebView that has already
    // answered the one that decides.
    const text = vi.fn(() => true);
    expect(
      selectLogShareShape({
        native: false,
        webShare: () => true,
        canShare: () => ({ file: () => true, text }),
      })
    ).toBe("file");
    expect(text).not.toHaveBeenCalled();
  });

  it("does not ask what can be shared when nothing can be shared at all", () => {
    // No `navigator.share`: the capability question is moot, and on a broken
    // WebView asking it anyway is how a knowable answer turns into a throw.
    const canShare = vi.fn(BROKEN_WEBVIEW);
    expect(
      selectLogShareShape({ native: false, webShare: () => false, canShare })
    ).toBe("unsupported");
    expect(canShare).not.toHaveBeenCalled();
  });

  it("prefers a File when canShare explicitly says files work", () => {
    expect(selectLogShareShape(LEVEL_2(true, true))).toBe("file");
    // A platform that takes the file but claims not to take text still gets the
    // file: the preference is for the attachment, not for the fallback.
    expect(selectLogShareShape(LEVEL_2(true, false))).toBe("file");
  });

  it("falls back to text when canShare refuses the file", () => {
    // iOS has historically not accepted every type in a file share. The log's
    // one exit must open anyway: text is worse than an attachment and
    // incomparably better than a button that cannot work.
    expect(selectLogShareShape(LEVEL_2(false, true))).toBe("text");
  });

  it("treats an ABSENT canShare as text, never as a file", () => {
    // Web Share LEVEL 1: `share` exists, `canShare` does not, and files are not
    // supported at all — `canShare` arrived with Level 2, which is also what
    // added file sharing. Reading absence as a yes armed the file branch on
    // precisely those browsers (Frank, round 2).
    expect(
      selectLogShareShape({
        native: false,
        webShare: () => true,
        canShare: () => null,
      })
    ).toBe("text");
  });

  it("is unsupported only when the browser can share nothing", () => {
    // No Web Share at all, and not in the shell: there is no exit, and saying so
    // is better than arming a gesture that cannot work. Decided BEFORE the
    // IndexedDB read, which is why the shape takes no File.
    expect(
      selectLogShareShape({
        native: false,
        webShare: () => false,
        canShare: () => null,
      })
    ).toBe("unsupported");
    // Web Share present but refusing both shapes is a standing refusal that no
    // retry clears, so it belongs on screen rather than in a loop.
    expect(selectLogShareShape(LEVEL_2(false, false))).toBe("unsupported");
  });
});

/**
 * George r2 P2-3 (#491): `send()`'s success branch reported EVERY resolve as
 * `"sent"`, including on the native route, with a comment arguing that is
 * "safe HERE for the reason it is safe for Share Chapter" — a reason Share
 * Chapter/Book's OWN `unproven` work (`resolveSendOutcome`,
 * `resolveProvesDelivery`, `ec2a148`) has since inverted: on native Android a
 * resolve does NOT prove the sheet was used, and both share menus now say so
 * with a distinct, non-closing outcome instead of the plain success tick.
 * This hook kept reporting the unconditional tick, and — because
 * `FailureLogPanel.onSend` closes the panel on `outcome === "sent"` — an
 * unconfirmed native resolve closed the panel exactly as confidently as a
 * proven one, the same defect the Share menus already fixed one layer up.
 *
 * The two-gesture flow itself is React + browser glue this repo has no
 * renderer to exercise (this file's own header). What IS pinned here, at the
 * source, is that the fix reuses the SAME policy function
 * (`resolveSendOutcome`) Share Chapter/Book already use, rather than a second,
 * hand-rolled comparison — and that the stale comment is gone.
 *
 * Red-first: reverting this hook's `send()` to the old `return "sent";` — no
 * `resolveProvesDelivery`/`resolveSendOutcome` call at all — makes every
 * assertion below fail; confirmed with `git stash` against the pre-fix
 * source.
 */
describe("use-failure-log-share.ts: an unconfirmed native resolve settles unproven, not sent (George r2 P2-3, #491)", () => {
  const hook = read("src/hooks/use-failure-log-share.ts");

  it("imports the same policy Share Chapter/Book use — resolveSendOutcome and resolveProvesDelivery — not a hand-rolled comparison", () => {
    expect(hook).toMatch(/resolveSendOutcome,?\s*\n?\s*type ShareError/);
    expect(hook).toMatch(/resolveProvesDelivery,/);
    expect(hook).toMatch(/readSharePlatform,/);
  });

  it("send()'s success branch decides proven from the route this send actually took (native vs. web) against the CURRENT platform, before deciding the outcome", () => {
    const sendAt = hook.indexOf("const send = useCallback(async ()");
    expect(sendAt).toBeGreaterThan(-1);
    const successAt = hook.indexOf(
      'if (!current()) return "superseded";',
      sendAt
    );
    expect(successAt).toBeGreaterThan(sendAt);
    const returnAt = hook.indexOf(
      'return settled === "unproven" ? "unproven" : "sent";',
      successAt
    );
    expect(returnAt).toBeGreaterThan(successAt);
    const body = hook.slice(successAt, returnAt);
    expect(body).toMatch(
      /const proven = resolveProvesDelivery\(\s*payload\.kind === "native" \? "native" : "web",\s*readSharePlatform\(\)\s*\);/
    );
    expect(body).toMatch(
      /const settled = resolveSendOutcome\(proven, undefined\);/
    );
  });

  it('never unconditionally returns "sent" from the success branch any more', () => {
    const sendAt = hook.indexOf("const send = useCallback(async ()");
    const catchAt = hook.indexOf("} catch (cause) {", sendAt);
    const successBody = hook.slice(sendAt, catchAt);
    expect(successBody).not.toMatch(/\n\s*return "sent";\s*\n/);
  });

  it("the stale comment claiming this is unconditionally safe 'for the reason it is safe for Share Chapter' is gone", () => {
    expect(hook).not.toMatch(/that is safe HERE for the reason it is safe/);
  });
});

/**
 * Frank at `238820a` P2 (#491, this round's own review): fixing `send()` to
 * RETURN `"unproven"` (the describe block above) closed George r2 P2-3's
 * hole in the return value, but neither `FailureLogPanel` nor
 * `SendLogControl` read that return value for anything but whether to close
 * — so an unproven send still redrew a plain idle "Send problem report"
 * control with nothing telling it apart from one never tried, the identical
 * defect George r2 P2-2 found (and this round fixed) for Share Chapter/Book.
 * Wired the same way: `sendUnconfirmed` on the hook, read by BOTH callers to
 * swap the idle control's icon (`share-closed`, not a new glyph) and label,
 * never `disabled`.
 *
 * Red-first: removing `setSendUnconfirmed(true)` from `send()`'s success
 * branch, or the `sendUnconfirmed` reads in either caller, makes the
 * corresponding assertion below fail; confirmed with `git stash`.
 */
describe("use-failure-log-share.ts: sendUnconfirmed reaches both idle Send controls (Frank 238820a P2, #491)", () => {
  const hook = read("src/hooks/use-failure-log-share.ts");

  it("UseFailureLogShare exposes sendUnconfirmed", () => {
    expect(hook).toMatch(/readonly sendUnconfirmed: boolean;/);
  });

  it("send()'s success branch sets it true ONLY on an unproven settle", () => {
    const settledAt = hook.indexOf("const settled = resolveSendOutcome(");
    expect(settledAt).toBeGreaterThan(-1);
    const setAt = hook.indexOf(
      'if (settled === "unproven") setSendUnconfirmed(true);',
      settledAt
    );
    const returnAt = hook.indexOf(
      'return settled === "unproven" ? "unproven" : "sent";',
      settledAt
    );
    expect(setAt).toBeGreaterThan(settledAt);
    expect(setAt).toBeLessThan(returnAt);
  });

  it("prepare() and reset() both clear it — a fresh attempt or a panel close is the acknowledgment", () => {
    const prepareAt = hook.indexOf("const prepare = useCallback(async ()");
    const prepareStatusAt = hook.indexOf('setStatus("preparing");', prepareAt);
    const prepareClearAt = hook.lastIndexOf(
      "setSendUnconfirmed(false);",
      prepareStatusAt
    );
    expect(prepareClearAt).toBeGreaterThan(prepareAt);
    expect(prepareClearAt).toBeLessThan(prepareStatusAt);

    const resetAt = hook.indexOf("const reset = useCallback(() => {");
    const resetEnd = hook.indexOf("}, []);", resetAt);
    expect(hook.slice(resetAt, resetEnd)).toMatch(
      /setSendUnconfirmed\(false\);/
    );
  });

  it("the returned object carries sendUnconfirmed through", () => {
    expect(hook).toMatch(
      /return \{ status, error, sendUnconfirmed, prepare, send, reset \};/
    );
  });
});

describe("use-failure-log-share.ts and failure-log-panel.tsx: terminal DB refusals ask for restart, not retry (#455)", () => {
  it("classifies DatabaseDowngradeError as the restart-only failure-log error", () => {
    expect(
      classifyFailureLogOpenError({ name: "DatabaseDowngradeError" })
    ).toBe("restart");
    expect(classifyFailureLogOpenError({ name: "DatabaseBlockedError" })).toBe(
      "failed"
    );
    expect(classifyFailureLogOpenError(new Error("ordinary failure"))).toBe(
      "failed"
    );
  });

  it("prepare() surfaces the restart-only error and does not route a terminal open refusal through the failure funnel", () => {
    const hook = read("src/hooks/use-failure-log-share.ts");
    const catchAt = hook.indexOf(
      "} catch (cause) {",
      hook.indexOf("const prepare = useCallback")
    );
    const finallyAt = hook.indexOf("} finally {", catchAt);
    const catchBody = hook.slice(catchAt, finallyAt);
    expect(catchBody).toMatch(
      /const classified = classifyFailureLogOpenError\(cause\);/
    );
    expect(catchBody).toMatch(/setError\(classified\);/);
    expect(catchBody).toMatch(/if \(classified !== "restart"\) \{/);
    expect(catchBody).toMatch(
      /reportFailure\(cause, "failure-log-share-prepare"\);/
    );
  });

  for (const file of [
    "src/components/failure-log-panel.tsx",
    "src/components/send-log-control.tsx",
  ] as const) {
    const name = file.split("/").pop();

    it(`${name}: maps the failure-log restart error to restart copy, not the Try again line`, () => {
      const source = read(file);
      const errorTextAt = source.indexOf("const errorText =");
      expect(errorTextAt).toBeGreaterThan(-1);
      const errorTextEnd = source.indexOf(";", errorTextAt);
      const errorText = source.slice(errorTextAt, errorTextEnd);
      expect(errorText).toMatch(/share\.error === "restart"/);
      expect(errorText).toMatch(/strings\.shareFailureLogRestart/);
    });
  }

  it("FailureLogPanel clear classifies a terminal clear rejection and renders the same restart copy", () => {
    const source = read("src/components/failure-log-panel.tsx");
    expect(source).toMatch(
      /import \{ isTerminalOpenRefusal \} from "@\/lib\/storage\/db";/
    );
    expect(source).toMatch(
      /const \[clearError, setClearError\] = useState<"restart" \| null>\(null\);/
    );
    expect(source).toMatch(/setClearError\(null\);/);
    expect(source).toMatch(
      /isTerminalOpenRefusal\([\s\S]*\(cause as \{ name\?: string \} \| null\)[\s\S]*\?\.name \?\? null[\s\S]*\)/
    );
    expect(source).toMatch(/setClearError\("restart"\);/);
    expect(source).toMatch(
      /clearError === "restart" && share\.error !== "restart" && \([\s\S]*?<Notice>\{strings\.shareFailureLogRestart\}<\/Notice>[\s\S]*?\)/
    );
  });
});

describe("failure-log-panel.tsx and send-log-control.tsx: the idle Send control shows sendUnconfirmed, never disabled (Frank 238820a P2, #491)", () => {
  for (const [file, glyphVar] of [
    ["src/components/failure-log-panel.tsx", "shareGlyph"],
    ["src/components/send-log-control.tsx", "glyph"],
  ] as const) {
    const name = file.split("/").pop();

    it(`${name}: overrides the idle glyph to share-closed when sendUnconfirmed is true`, () => {
      const source = read(file);
      const glyphAt = source.indexOf(
        `const ${glyphVar} = share.sendUnconfirmed`
      );
      expect(glyphAt).toBeGreaterThan(-1);
      const glyphEnd = source.indexOf(";", glyphAt);
      expect(source.slice(glyphAt, glyphEnd)).toMatch(/"share-closed"/);
    });

    it(`${name}: the idle control's label switches on sendUnconfirmed and the control is never disabled`, () => {
      const source = read(file);
      const labelAt = source.indexOf("shareFailureLogUnconfirmed");
      expect(labelAt).toBeGreaterThan(-1);
      const controlStart = source.lastIndexOf("<Control", labelAt);
      const controlEnd = source.indexOf("/>", labelAt);
      const control = source.slice(controlStart, controlEnd);
      expect(control).toMatch(/share\.sendUnconfirmed/);
      expect(control).not.toMatch(/disabled/);
    });
  }
});
