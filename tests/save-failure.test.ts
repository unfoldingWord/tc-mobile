import { describe, expect, it } from "vitest";

import {
  failureKey,
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

/**
 * The vocabulary mapping (#172): which word a SCREEN says about a failure.
 *
 * `saveFailureKind` above answers a different question — which of two recovery
 * screens the held take gets — and is called from one place. This one is called
 * from every hook that catches a load or a write, and it exists so that "no room
 * left on this phone" is classified on all of them rather than only on the take
 * save, and so that a browser's own exception text never reaches a translator.
 *
 * The keys are `strings` entries; the screens index `strings` with what comes
 * back, so a key with no entry is a compile error at the use site, not a blank
 * Notice at runtime.
 */
describe("failureKey", () => {
  it("classifies a quota failure as noRoom whatever the fallback", () => {
    expect(failureKey({ name: "QuotaExceededError" }, "saveFailed")).toBe(
      "noRoom"
    );
    expect(failureKey({ name: "QuotaExceededError" }, "loadFailed")).toBe(
      "noRoom"
    );
    // The legacy WebKit code, the half `isQuotaExceeded` exists for.
    expect(failureKey({ code: 22 }, "eraseFailed")).toBe("noRoom");
  });

  it("falls back for any other cause", () => {
    expect(failureKey(new Error("boom"), "saveFailed")).toBe("saveFailed");
    expect(failureKey({ name: "AbortError" }, "loadFailed")).toBe("loadFailed");
    expect(failureKey({ code: 21 }, "eraseFailed")).toBe("eraseFailed");
  });

  it("falls back for a cause that is not an object at all", () => {
    // A `throw "no room"` and a rejected promise carrying nothing are both
    // possible, and neither may be read for a `.name`.
    expect(failureKey("no room", "saveFailed")).toBe("saveFailed");
    expect(failureKey(undefined, "loadFailed")).toBe("loadFailed");
    expect(failureKey(null, "loadFailed")).toBe("loadFailed");
  });
});
