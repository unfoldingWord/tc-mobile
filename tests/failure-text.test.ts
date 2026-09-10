import { describe, expect, it } from "vitest";

import { describeCause, formatFailureLog } from "@/lib/failure-text";
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
