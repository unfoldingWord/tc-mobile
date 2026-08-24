import { describe, expect, it } from "vitest";

import { isQuotaExceeded, saveFailureKind } from "@/hooks/save-failure";

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

  it("treats anything else as unknown", () => {
    expect(saveFailureKind(new Error("boom"))).toBe("unknown");
    expect(saveFailureKind({ name: "AbortError" })).toBe("unknown");
    expect(saveFailureKind({ code: 21 })).toBe("unknown");
    expect(saveFailureKind("no room")).toBe("unknown");
    expect(saveFailureKind(undefined)).toBe("unknown");
    expect(saveFailureKind(null)).toBe("unknown");
  });
});
