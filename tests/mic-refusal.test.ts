import { describe, expect, it } from "vitest";

import { classifyMicRefusal } from "@/lib/audio/mic-refusal";

/**
 * The regression these guard is #203: every microphone refusal used to render
 * one sentence naming only the "you tapped no" case, sending someone whose
 * operating system blocks the browser (#195) to a site prompt that cannot help.
 *
 * The load-bearing rows are the two that split the OS case from the site case by
 * the permission state: `NotAllowedError` + `granted`/`prompt` → `os-blocked`
 * (device settings), and `NotAllowedError` + `denied` → `site-blocked`. A
 * mutation that collapses either back into the other is the bug returning.
 */
describe("classifyMicRefusal", () => {
  it("is os-blocked when refused while the site permission is granted (#195)", () => {
    expect(classifyMicRefusal("NotAllowedError", "granted")).toBe("os-blocked");
  });

  it("is os-blocked when refused while the state still reads prompt", () => {
    // A real user "no" flips the stored state to denied, so a refusal with the
    // state still at prompt is the OS layer, not the tap.
    expect(classifyMicRefusal("NotAllowedError", "prompt")).toBe("os-blocked");
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
