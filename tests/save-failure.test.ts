import { describe, expect, it } from "vitest";

import {
  failureKey,
  isDatabaseDowngrade,
  isQuotaExceeded,
  saveFailureKind,
} from "@/hooks/save-failure";

/**
 * The classifier, and only the classifier: which of two words the recovery
 * screen shows. Duck-typed on purpose, so it can be exercised without a
 * browser — `DOMException` exists in Node, but the point is that the check does
 * not depend on it.
 *
 * What is NOT covered here: the save-failure path itself. Nothing below calls
 * `saveTake`, makes `putClip` or `addTake` reject, or asserts that a failed
 * save keeps its samples. Those transitions are covered by
 * `tests/pending-take.test.ts`, and the storage writes by
 * `tests/storage.test.ts`.
 */
/**
 * Two shapes where reading `name`/`code` off the cause itself throws, rather
 * than returning a value: a getter that throws (a hostile or malformed
 * object arriving as a rejection reason) and a revoked Proxy (any property
 * read throws a TypeError). Both are `typeof … === "object"` and non-null,
 * so they pass every classifier's guard clause and reach the property read
 * (Frank r2 P2 on #886, issuecomment-5822215744).
 */
function throwingGetterCause(): unknown {
  return {
    get name(): string {
      throw new Error("hostile getter");
    },
  };
}
function revokedProxyCause(): unknown {
  const { proxy, revoke } = Proxy.revocable<Record<string, unknown>>({}, {});
  revoke();
  return proxy;
}

describe("saveFailureKind", () => {
  it("recognises a quota failure by name", () => {
    expect(isQuotaExceeded({ name: "QuotaExceededError" })).toBe(true);
    expect(saveFailureKind({ name: "QuotaExceededError" })).toBe("quota");
  });

  it("recognises the legacy DOMException code", () => {
    // Some WebKit builds still report 22 rather than the name.
    expect(isQuotaExceeded({ code: 22 })).toBe(true);
    expect(saveFailureKind({ code: 22 })).toBe("quota");
  });

  it("recognises the newer-data failure, which no retry can clear", () => {
    // `getDb()` throws this for a stored version above `DB_VERSION`. It is the
    // one failure the recovery screen must not offer as a blip: it fails the
    // version check before any transaction, so every further Retry fails the
    // same way (George R1 P2-1).
    expect(isDatabaseDowngrade({ name: "DatabaseDowngradeError" })).toBe(true);
    expect(saveFailureKind({ name: "DatabaseDowngradeError" })).toBe(
      "downgrade"
    );
  });

  it("keeps quota ahead of it, and neither swallows the other", () => {
    // Both are matched by name off the same object shape; a full phone is still
    // a full phone, and is the one the translator can act on.
    expect(isDatabaseDowngrade({ name: "QuotaExceededError" })).toBe(false);
    expect(isQuotaExceeded({ name: "DatabaseDowngradeError" })).toBe(false);
  });

  it("recognises a missing save target as stale, which no retry can clear", () => {
    expect(saveFailureKind(new Error("No such segment: segment-1"))).toBe(
      "stale"
    );
    expect(saveFailureKind(new Error("No such chapter: chapter-1"))).toBe(
      "stale"
    );
  });

  it("treats anything else as unknown", () => {
    expect(saveFailureKind({ name: "VersionError" })).toBe("unknown");
    expect(saveFailureKind(new Error("boom"))).toBe("unknown");
    expect(saveFailureKind({ name: "AbortError" })).toBe("unknown");
    expect(saveFailureKind({ code: 21 })).toBe("unknown");
    expect(saveFailureKind("no room")).toBe("unknown");
    expect(saveFailureKind(undefined)).toBe("unknown");
    expect(saveFailureKind(null)).toBe("unknown");
  });

  it("does not throw when the cause's own name/code cannot be read, and falls through to unknown", () => {
    // Every classifier here is reached by saveFailureKind in sequence
    // (isQuotaExceeded first, then isDatabaseDowngrade): both must survive a
    // shape that throws on read, not just the first one checked.
    expect(() => saveFailureKind(throwingGetterCause())).not.toThrow();
    expect(saveFailureKind(throwingGetterCause())).toBe("unknown");
    expect(() => saveFailureKind(revokedProxyCause())).not.toThrow();
    expect(saveFailureKind(revokedProxyCause())).toBe("unknown");
  });

  it("keeps a readable name or code when only the other one throws (Frank r1 on #905)", () => {
    const throws = (): never => {
      throw new Error("hostile getter");
    };
    const nameWithThrowingCode = (name: string): unknown =>
      Object.defineProperty({ name }, "code", { get: throws });
    expect(isQuotaExceeded(nameWithThrowingCode("QuotaExceededError"))).toBe(
      true
    );
    expect(
      isDatabaseDowngrade(nameWithThrowingCode("DatabaseDowngradeError"))
    ).toBe(true);
    expect(
      isQuotaExceeded(
        Object.defineProperty({ code: 22 }, "name", { get: throws })
      )
    ).toBe(true);
  });
});

/**
 * `failureKey` (#172) — the general Books/Segments vocabulary, distinct from
 * `saveFailureKind` above (that one is the take-save recovery screen's own
 * four-way classification). Only quota is special-cased here: everything
 * else is the call site's own fallback word, verbatim.
 */
describe("failureKey", () => {
  it("returns the fallback for an ordinary (non-quota) failure", () => {
    expect(failureKey(new Error("boom"), "loadFailed")).toBe("loadFailed");
    expect(failureKey(new Error("No such segment: s1"), "saveFailed")).toBe(
      "saveFailed"
    );
    expect(failureKey(undefined, "eraseFailed")).toBe("eraseFailed");
  });

  it('maps a quota-exceeded cause to "noRoom" regardless of the fallback', () => {
    expect(failureKey({ name: "QuotaExceededError" }, "loadFailed")).toBe(
      "noRoom"
    );
    expect(failureKey({ code: 22 }, "saveFailed")).toBe("noRoom");
    expect(failureKey({ name: "QuotaExceededError" }, "eraseFailed")).toBe(
      "noRoom"
    );
  });

  it("returns the fallback, not a throw, when the cause's own shape cannot be read (Frank r2 P2, #886)", () => {
    // A cause classified mid-`catch` is the one place a throw here is worst:
    // the call site is already handling a failure, and a second, unrelated
    // throw from the classifier itself would leave that failure neither
    // mapped nor reported (see the `performErase` hook-level case in
    // tests/use-erase-segment.test.ts).
    expect(failureKey(throwingGetterCause(), "saveFailed")).toBe("saveFailed");
    expect(failureKey(revokedProxyCause(), "loadFailed")).toBe("loadFailed");
  });
});
