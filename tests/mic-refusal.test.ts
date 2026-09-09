import { describe, expect, it } from "vitest";

import { classifyMicRefusal } from "@/lib/audio/mic-refusal";

/**
 * The regression these guard is #203: every microphone refusal used to render
 * one sentence naming only the "you tapped no" case, sending someone whose
 * operating system blocks the browser (#195) to a site prompt that cannot help.
 *
 * The load-bearing rows split the three remedies by the permission state, all
 * under `NotAllowedError`: `granted` → `os-blocked` (device settings — the #195
 * case, refused while the site itself is granted), `denied` → `site-blocked`
 * (the origin's own block), and `prompt`/`unknown` → `prompt` (indeterminate —
 * a dismissed prompt, or a platform that hides the state, both cleared by
 * tapping Record again and allowing). A mutation that collapses `prompt` into
 * `os-blocked` is #203's inversion returning: it would send a dismissed prompt
 * to device settings, the one layer that cannot help.
 */
describe("classifyMicRefusal", () => {
  it("is os-blocked when refused while the site permission is granted (#195)", () => {
    expect(classifyMicRefusal("NotAllowedError", "granted")).toBe("os-blocked");
  });

  it("is prompt (not os-blocked) when the state still reads prompt", () => {
    // A dismissed prompt (X / tap-outside / Esc) leaves the state at `prompt`
    // and throws NotAllowedError; the remedy is to tap Record again and Allow,
    // NOT device settings — so this must not read as the OS case (R1 P2).
    expect(classifyMicRefusal("NotAllowedError", "prompt")).toBe("prompt");
  });

  it("is site-blocked when the origin's permission reads denied", () => {
    expect(classifyMicRefusal("NotAllowedError", "denied")).toBe(
      "site-blocked"
    );
  });

  it("is prompt when the platform hides the permission state (iOS Safari)", () => {
    expect(classifyMicRefusal("NotAllowedError", "unknown")).toBe("prompt");
  });

  it("is no-device for NotFoundError regardless of permission", () => {
    expect(classifyMicRefusal("NotFoundError", "granted")).toBe("no-device");
    expect(classifyMicRefusal("DevicesNotFoundError", "unknown")).toBe(
      "no-device"
    );
  });

  it("is other for a non-permission failure", () => {
    expect(classifyMicRefusal("AbortError", "unknown")).toBe("other");
    expect(classifyMicRefusal(undefined, "granted")).toBe("other");
  });
});
