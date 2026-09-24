import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  describeCause,
  errorMessage,
  formatFailureLog,
} from "@/lib/failure-text";
import type { StoredFailure } from "@/types/failure";

/**
 * The pure half of the durable failure log (#205).
 *
 * Everything here runs at the moment the app is already failing, so the
 * property under test throughout is "terminates, and never throws" — not
 * "produces pretty text". The pathological causes below are the reason the
 * conversions are guarded at all: an object whose `toString` throws, a `Symbol`
 * (which throws on implicit string conversion), and a value that is an `Error`
 * by message but whose `stack` getter throws.
 */
describe("describeCause", () => {
  it("names an Error by name and message, and keeps its stack", () => {
    const cause = new TypeError("bad input");
    const { message, stack } = describeCause(cause);
    expect(message).toBe("TypeError: bad input");
    expect(stack).toContain("TypeError: bad input");
  });

  it("keeps a thrown string as itself, with no stack", () => {
    expect(describeCause("quota exceeded")).toEqual({
      message: "quota exceeded",
    });
  });

  it("describes the primitives a throw can carry", () => {
    expect(describeCause(undefined).message).toBe("undefined");
    expect(describeCause(null).message).toBe("null");
    expect(describeCause(0).message).toBe("0");
    expect(describeCause(false).message).toBe("false");
  });

  it("survives a cause whose toString throws", () => {
    const cause = {
      toString() {
        throw new Error("nope");
      },
    };
    expect(describeCause(cause).message).toBe("[unstringifiable object]");
  });

  it("survives a Symbol, which throws on implicit conversion", () => {
    expect(describeCause(Symbol("boom")).message).toBe("Symbol(boom)");
  });

  it("keeps the message when the stack getter throws", () => {
    const cause = new Error("write failed");
    Object.defineProperty(cause, "stack", {
      get() {
        throw new Error("no stack for you");
      },
    });
    const described = describeCause(cause);
    expect(described.message).toBe("Error: write failed");
    expect(described.stack).toBeUndefined();
  });

  it("ignores a non-string stack rather than storing it", () => {
    const cause = { message: "x", stack: { frames: [] } };
    expect(describeCause(cause).stack).toBeUndefined();
  });

  it("ignores an empty stack rather than storing an empty field", () => {
    const cause = new Error("empty");
    cause.stack = "";
    expect(describeCause(cause).stack).toBeUndefined();
  });

  it("bounds both the message and the stack, marking the cut", () => {
    // The log is a ring of short rows in the same database the recordings live
    // in. An unbounded field is a way to spend a translator's storage on text,
    // and a stringified buffer is how it happens.
    const cause = new Error("m".repeat(5000));
    cause.stack = "s".repeat(5000);
    const { message, stack } = describeCause(cause);
    expect(message.length).toBeLessThan(2100);
    expect(message.endsWith("…[cut]")).toBe(true);
    expect(stack?.length).toBeLessThan(2100);
    expect(stack?.endsWith("…[cut]")).toBe(true);
  });

  it("leaves a message at the limit whole, with no cut marker", () => {
    // The boundary itself: 2000 characters is kept, 2001 is cut. Without this
    // case an off-by-one that truncated every real stack would pass.
    const cause = new Error("m".repeat(2000 - "Error: ".length));
    const { message } = describeCause(cause);
    expect(message.length).toBe(2000);
    expect(message).not.toContain("[cut]");
  });
});

/**
 * The other renderer (#160, L-15). What these pin is not "it formats nicely"
 * but the two boundaries that make it a SEPARATE function from `describeCause`
 * rather than a duplicate of it: the Error branch is real (a message, not
 * `String(err)`), and everything else falls through to `String`.
 *
 * Both halves matter, but not for the reasons an earlier draft of this comment
 * gave — George was right on `25c336fd5`, and the corrected version is what the
 * two mutations actually print:
 *
 *   - Drop the ERROR branch and the name comes back: `setError` renders
 *     "TypeError: bad input" rather than "bad input", and an `Error` thrown
 *     with no message renders "Error" rather than "". Four cases here die.
 *   - Drop the `String` FALLBACK and a thrown string is unaffected — it is
 *     already a string, so `errorMessage("quota exceeded")` still returns it
 *     and the first assertion below still passes. What breaks is every other
 *     non-Error: `undefined` reaches the caller as the VALUE `undefined`
 *     rather than the text, and that is the assertion that fails first, then
 *     `null`, `42` and `{ code: 22 }`.
 *
 * The old sentence also said `lib/storage` throws bare strings. It does not —
 * every throw there is `throw new …` or a re-throw of a caught `cause`.
 */
describe("errorMessage", () => {
  it("gives an Error's message WITHOUT its name", () => {
    // The whole difference from `describeCause`, which prefixes the name.
    expect(errorMessage(new TypeError("bad input"))).toBe("bad input");
    expect(describeCause(new TypeError("bad input")).message).toBe(
      "TypeError: bad input"
    );
  });

  it("gives a subclass's message, not its class name", () => {
    class QuotaError extends Error {}
    expect(errorMessage(new QuotaError("no space left"))).toBe("no space left");
  });

  it("carries the store's own thrown messages through unchanged", () => {
    // The shape every call site is actually rendering: `lib/storage` throws
    // `No such segment: …`, and that string is what a recovery panel shows.
    expect(errorMessage(new Error("No such segment: seg-1"))).toBe(
      "No such segment: seg-1"
    );
  });

  it("falls back to String for what is not an Error", () => {
    expect(errorMessage("quota exceeded")).toBe("quota exceeded");
    expect(errorMessage(undefined)).toBe("undefined");
    expect(errorMessage(null)).toBe("null");
    expect(errorMessage(42)).toBe("42");
    expect(errorMessage({ code: 22 })).toBe("[object Object]");
  });

  it("is empty, not undefined, for an Error thrown with no message", () => {
    // `new Error()` has `message: ""`. A caller storing this as state renders
    // nothing — which is right — but must not render the string "undefined".
    expect(errorMessage(new Error())).toBe("");
  });

  /**
   * #721: every caller of `errorMessage` is a `catch` block, so if the
   * conversion itself throws, a handled failure becomes an unhandled one —
   * inside the code meant to report it. This table is the hazards George's
   * note named, as the issue body corrected them: a hostile `toString`, a
   * null-prototype object, an `Error` whose own
   * `message` getter throws, and a revoked `Proxy` (where even `instanceof`
   * throws) all must be survived with a stable fallback string. `Symbol` and
   * `BigInt` are deliberately included as the NON-hazard cases — `String()`
   * does not throw on either, so a guard aimed at "exotic values" rather than
   * the actual throwing operations would be guarding the wrong thing.
   */
  describe("never throws, even on a hostile cause (#721)", () => {
    it("survives a toString that throws", () => {
      const cause = {
        toString() {
          throw new Error("nope");
        },
      };
      expect(() => errorMessage(cause)).not.toThrow();
      expect(errorMessage(cause)).toBe("[unstringifiable object]");
    });

    it("survives a null-prototype object, which String() cannot convert", () => {
      const cause = Object.create(null) as unknown;
      expect(() => errorMessage(cause)).not.toThrow();
      expect(errorMessage(cause)).toBe("[unstringifiable object]");
    });

    it("survives an Error whose own message getter throws", () => {
      const cause = new Error("original");
      Object.defineProperty(cause, "message", {
        get() {
          throw new Error("getter boom");
        },
      });
      expect(() => errorMessage(cause)).not.toThrow();
      expect(errorMessage(cause)).toBe("[unstringifiable object]");
    });

    it("survives a revoked Proxy, where even `instanceof` throws", () => {
      const { proxy, revoke } = Proxy.revocable({}, {});
      revoke();
      expect(() => errorMessage(proxy)).not.toThrow();
      expect(errorMessage(proxy)).toBe("[unstringifiable object]");
    });

    it("returns a string even when an Error's message is not one", () => {
      const as = (m: unknown) =>
        Object.defineProperty(new Error("o"), "message", { value: m });
      expect(errorMessage(as(Symbol("m")))).toBe("Symbol(m)");
      expect(errorMessage(as(Object.create(null)))).toBe(
        "[unstringifiable object]"
      );
    });

    it("survives a Symbol.toPrimitive that throws", () => {
      const cause = {
        [Symbol.toPrimitive]() {
          throw new Error("nope");
        },
      };
      expect(errorMessage(cause)).toBe("[unstringifiable object]");
    });

    it("renders a Symbol's own text rather than a fallback — not a hazard", () => {
      // `String(Symbol(...))` does not throw; only implicit conversion does.
      // A guard that mistook this for a hazard would guard the safe case and
      // still miss the real ones.
      expect(errorMessage(Symbol("boom"))).toBe("Symbol(boom)");
    });

    it("renders a BigInt's own text rather than a fallback — not a hazard", () => {
      expect(errorMessage(10n)).toBe("10");
    });

    it("does not throw on a cyclic object — String() does not recurse", () => {
      const cause: { self?: unknown } = {};
      cause.self = cause;
      expect(() => errorMessage(cause)).not.toThrow();
      expect(errorMessage(cause)).toBe("[object Object]");
    });
  });
});

/**
 * The `cause` chain (George R4 P2-2).
 *
 * `finish-transcode.ts` wraps every sweep and segment failure as
 * `new Error("Transcoding finished segment <id> failed; its PCM is kept",
 * { cause })` so `context` can stay a short, stable site key. It is the only
 * high-volume production reporter this log receives, and before this the row
 * that named the segment was the row that had lost the reason — browsers do not
 * fold the chain into `error.stack`, that concatenation is Node's.
 */
describe("describeCause and the cause chain", () => {
  it("keeps the reason a wrapper was built to carry", () => {
    class EncoderStalledError extends Error {
      override name = "EncoderStalledError";
    }
    const wrapped = new Error("Transcoding finished segment s1 failed", {
      cause: new EncoderStalledError("no progress for 15000 ms"),
    });

    const { message } = describeCause(wrapped);

    // The wrapper still leads: it is what names the segment.
    expect(message).toContain("Transcoding finished segment s1 failed");
    // And the line that makes the row diagnosable at all.
    expect(message).toContain(
      "Caused by: EncoderStalledError: no progress for 15000 ms"
    );
  });

  it("keeps the OUTERMOST stack, not the cause's", () => {
    const inner = new Error("inner");
    inner.stack = "INNER STACK";
    const outer = new Error("outer", { cause: inner });
    outer.stack = "OUTER STACK";

    const { stack } = describeCause(outer);

    // The outer stack names the site. The inner frames are from the same tick
    // and would spend the shared character budget on repetition.
    expect(stack).toBe("OUTER STACK");
    expect(stack).not.toContain("INNER STACK");
  });

  it("walks more than one link", () => {
    const deep = new Error("a", {
      cause: new Error("b", { cause: new Error("c") }),
    });

    const { message } = describeCause(deep);

    expect(message).toContain("Caused by: Error: b");
    expect(message).toContain("Caused by: Error: c");
  });

  it("stops at the depth cap and says that it did", () => {
    const deep = new Error("1", {
      cause: new Error("2", {
        cause: new Error("3", {
          cause: new Error("4", { cause: new Error("5") }),
        }),
      }),
    });

    const { message } = describeCause(deep);

    expect(message).toContain("Caused by: Error: 2");
    expect(message).toContain("Caused by: Error: 4");
    // The fifth is past the cap, and the reader is told rather than left to
    // believe the chain ended — the same honesty `boundText`'s marker carries.
    expect(message).not.toContain("Error: 5");
    expect(message).toContain("[cause chain cut]");
  });

  it("terminates on a cycle instead of hanging the sink", () => {
    // Legal JavaScript, and the sink runs at the moment the app is already
    // failing — an unbounded walk here would be a hang, not a bad log line.
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    (a as { cause?: unknown }).cause = b;

    const { message } = describeCause(a);

    expect(message).toContain("Caused by: Error: b");
    expect(message).toContain("[cause chain cut]");
  });

  it("survives a cause getter that throws", () => {
    const hostile = new Error("outer");
    Object.defineProperty(hostile, "cause", {
      get() {
        throw new Error("no");
      },
    });

    // The outer message still stands; losing the chain must not lose the entry.
    expect(describeCause(hostile).message).toContain("Error: outer");
  });

  it("writes no line for an absent or null cause", () => {
    expect(describeCause(new Error("plain")).message).not.toContain(
      "Caused by"
    );
    expect(
      describeCause(new Error("nulled", { cause: null })).message
    ).not.toContain("Caused by");
  });

  it("bounds the whole chain, not just the first link", () => {
    const long = "x".repeat(1500);
    const chained = new Error(long, { cause: new Error(long) });

    const { message } = describeCause(chained);

    // Both links together exceed the limit, so the field is still cut — the
    // chain must not be a way around the bound on a ring in the same database
    // the recordings live in.
    expect(message.endsWith("…[cut]")).toBe(true);
    expect(message.length).toBeLessThanOrEqual(2000 + "…[cut]".length);
  });
});

describe("formatFailureLog", () => {
  const entry = (over: Partial<StoredFailure> = {}): StoredFailure => ({
    at: Date.UTC(2026, 8, 10, 7, 30, 0),
    context: "unhandled-rejection",
    message: "Error: write failed",
    ...over,
  });

  it("carries the app version and the entry count in the header", () => {
    const text = formatFailureLog([entry(), entry()], "0.1.13");
    expect(text).toContain("app version: 0.1.13");
    expect(text).toContain("entries: 2");
  });

  it("stamps each entry in UTC, not the phone's local time", () => {
    // The file is read by someone in another timezone than the phone that wrote
    // it, and the line's whole value is correlating it with a build.
    expect(formatFailureLog([entry()], "0.1.13")).toContain(
      "2026-09-10T07:30:00.000Z"
    );
  });

  it("writes the context, message, stack and component tree of an entry", () => {
    const text = formatFailureLog(
      [entry({ stack: "at save (books.ts:1)", componentStack: "\n  in App" })],
      "0.1.13"
    );
    expect(text).toContain("[unhandled-rejection]");
    expect(text).toContain("Error: write failed");
    expect(text).toContain("at save (books.ts:1)");
    expect(text).toContain("component tree:\n  in App");
  });

  it("omits the optional fields entirely when an entry has none", () => {
    const text = formatFailureLog([entry()], "0.1.13");
    expect(text).not.toContain("component tree");
    expect(text).not.toContain("undefined");
  });

  it("keeps the given order, so the caller's newest-first read survives", () => {
    const text = formatFailureLog(
      [entry({ message: "newest" }), entry({ message: "oldest" })],
      "0.1.13"
    );
    expect(text.indexOf("newest")).toBeLessThan(text.indexOf("oldest"));
  });

  it("says so rather than emitting a headerless empty file", () => {
    const text = formatFailureLog([], "0.1.13");
    expect(text).toContain("entries: 0");
    expect(text).toContain("(no failures recorded)");
  });
});

/**
 * The census this replaces, as an assertion instead of a sentence.
 *
 * `failure-text.ts`'s docblock used to COUNT the copies it consolidated, and
 * the number was wrong — eleven inline across five files, not twelve across
 * six (Frank on `25c336fd5`). A count in prose cannot be re-checked and goes
 * stale the first time someone adds a hook, which is why AGENTS.md puts counts
 * in an assertion. This one fails when a copy comes back; the sentence could
 * only ever be re-read.
 *
 * COMMENTS ARE STRIPPED FIRST. `failure-text.ts`'s docblock quotes the very
 * expression this searches for, while explaining what it replaced, and a
 * whole-file regex is how `touch-policy.test.ts` came to match its own
 * justification — the trap AGENTS.md records, where the natural repair is to
 * weaken the pattern until it can no longer catch a real leak.
 *
 * Stated precisely, because a mutation contradicted the easy version: deleting
 * the strip does NOT turn this suite red today. That docblock quote happens to
 * wrap across two lines, so the ` * ` between `.message :` and `String(` keeps
 * the pattern from spanning it. The protection is real but currently
 * accidental in that one file, which is not something to rely on — a reflowed
 * comment or a one-line one would restore the false hit. So the stripper is
 * covered directly, below, instead of being credited with a save it did not
 * make.
 */
describe("errorMessage — the copies, counted by assertion", () => {
  const INLINE_COPY = /instanceof\s+Error\s*\?[^;]*?\.message\s*:\s*String\(/;

  /** Block and line comments out, so prose about the pattern cannot match. */
  function code(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = join(dir, e.name);
      if (e.isDirectory()) return walk(full);
      return /\.tsx?$/.test(e.name) ? [full] : [];
    });
  }

  const files = walk("src");

  it("strips comments, so prose quoting the expression cannot match", () => {
    // The stripper's own both-states check, against a synthetic file rather
    // than a real one: a one-line comment carrying the expression must not
    // register, and the identical line as CODE must.
    // BOTH comment forms, because they are two separate replaces and each
    // needs its own killer: with only the `//` case here, dropping the block
    // strip left the suite green.
    const asLine = `// cause instanceof Error ? cause.message : String(cause)`;
    const asBlock = `/* cause instanceof Error ? cause.message : String(cause) */`;
    const asCode = `const m = cause instanceof Error ? cause.message : String(cause);`;
    for (const prose of [asLine, asBlock]) {
      expect(INLINE_COPY.test(prose)).toBe(true); // unstripped: a false hit
      expect(INLINE_COPY.test(code(prose))).toBe(false); // stripped: gone
    }
    expect(INLINE_COPY.test(code(asCode))).toBe(true); // real code still caught
  });

  it("reads a tree at all — a walk that matches nothing is a silent pass", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("finds the expression in exactly one file — the one that exports it", () => {
    // Deliberately NOT "nowhere but an exempted path". The first run of this
    // gate failed on `failure-text.ts` itself, which is correct: the
    // expression still exists once, as this module's implementation. Naming
    // that file as an exception would have left the gate unable to notice if
    // the implementation were deleted. Pinning the SET says both halves at
    // once — the canonical one is present, and it is the only one.
    const carriers = files.filter((f) =>
      INLINE_COPY.test(code(readFileSync(f, "utf8")))
    );
    expect(carriers).toEqual([join("src", "lib", "failure-text.ts")]);
  });

  it("carries it exactly once even there", () => {
    // A second copy inside that same file would satisfy the set above.
    const source = code(readFileSync("src/lib/failure-text.ts", "utf8"));
    expect(source.match(new RegExp(INLINE_COPY, "g")) ?? []).toHaveLength(1);
  });

  it("does NOT catch stale-target.ts, which differs on purpose", () => {
    // The legitimate state this gate must stay green on. `stale-target.ts`
    // returns `string | null`, not `String(cause)`: it feeds an equality test
    // against a known message, so a non-Error must render as `null`. A pattern
    // broad enough to flag it would force an exemption by name, and an
    // exemption by name is how a gate stops catching anything.
    const source = code(
      readFileSync("src/lib/storage/stale-target.ts", "utf8")
    );
    expect(source).toMatch(/instanceof Error \? cause\.message : null/);
    expect(INLINE_COPY.test(source)).toBe(false);
  });
});
