import { describe, expect, it } from "vitest";

import { beginCreate, endCreate } from "@/hooks/template-create-guard";

describe("beginCreate/endCreate — the Template Library's double-tap guard (#246)", () => {
  it("claims a fresh id and returns true", () => {
    const inFlight = new Set<string>();
    expect(beginCreate(inFlight, "obs")).toBe(true);
    expect(inFlight.has("obs")).toBe(true);
  });

  it("refuses a second claim of the SAME id already in flight", () => {
    const inFlight = new Set<string>(["obs"]);
    expect(beginCreate(inFlight, "obs")).toBe(false);
    // Unchanged — a refused claim must not perturb the set a real create is
    // still holding a reference to.
    expect(inFlight.size).toBe(1);
  });

  it("claims a DIFFERENT id while one is already in flight", () => {
    const inFlight = new Set<string>(["obs"]);
    expect(beginCreate(inFlight, "bible:RUT")).toBe(true);
    expect([...inFlight].sort()).toEqual(["bible:RUT", "obs"]);
  });

  it("endCreate releases exactly the given id, leaving others claimed", () => {
    const inFlight = new Set<string>(["obs", "bible:RUT"]);
    endCreate(inFlight, "obs");
    expect([...inFlight]).toEqual(["bible:RUT"]);
  });

  it("endCreate on an id that was never claimed is a no-op", () => {
    const inFlight = new Set<string>(["obs"]);
    endCreate(inFlight, "bible:GEN");
    expect([...inFlight]).toEqual(["obs"]);
  });

  it("round-trips: begin, end, then begin again succeeds", () => {
    const inFlight = new Set<string>();
    expect(beginCreate(inFlight, "obs")).toBe(true);
    endCreate(inFlight, "obs");
    expect(beginCreate(inFlight, "obs")).toBe(true);
  });
});
