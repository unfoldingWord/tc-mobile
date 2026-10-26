import { describe, expect, it, vi } from "vitest";

// #1466 round 1: `loadObsTemplate` shares one promise, but must not keep a
// rejection — a lazy chunk that failed to load offline has to load on the
// next call. The catalogue load is replaced so the first call fails.
const loads = vi.hoisted(() => ({ count: 0 }));

vi.mock("@/lib/obs/catalog", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/obs/catalog")>();
  return {
    ...actual,
    loadObsCatalog: () => {
      loads.count += 1;
      return loads.count === 1
        ? Promise.reject(new Error("chunk failed to load"))
        : actual.loadObsCatalog();
    },
  };
});

const { loadObsTemplate } = await import("@/lib/templates/obs");

describe("loadObsTemplate after a failed load", () => {
  it("tries again rather than keeping the rejection", async () => {
    await expect(loadObsTemplate()).rejects.toThrow("chunk failed to load");
    const { pkg } = await loadObsTemplate();
    expect(pkg.chapters).toHaveLength(50);
    expect(loads.count).toBe(2);
  });
});
