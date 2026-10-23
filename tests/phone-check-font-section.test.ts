import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { PhoneCheckView } from "@/components/phone-check-screen";
import { readDeviceInfo } from "@/hooks/phone-check-probes";
import type { PhoneCheckState } from "@/hooks/use-phone-check";
import { DIGIT_SAMPLES, SCRIPT_SAMPLES } from "@/lib/phone-check/font-samples";
import {
  formatPhoneCheckReport,
  type DeviceInfo,
} from "@/lib/phone-check/report";
import {
  parseSavedChecks,
  serializeSavedChecks,
} from "@/lib/phone-check/saved-results";
import { LOCALES } from "@/lib/locale";
import { strings } from "@/lib/strings";

import { one, render } from "./render";

/**
 * #1486 — the instrument half of the device font check: a section of script
 * samples with their `lang`, three digit forms, and the phone's language list
 * in the report. Nothing here says how any phone drew anything; the run is a
 * person's, on real phones.
 */

const IDLE: PhoneCheckState = {
  device: null,
  encode: null,
  dsp: null,
  storage: null,
  allocation: null,
  activity: null,
};

function view(state: PhoneCheckState = IDLE): Element {
  const noop = () => {};
  return render(
    createElement(PhoneCheckView, {
      state,
      version: "1.1.0",
      sha: "abc1234",
      onStart: noop,
      onStartMemory: noop,
      onClose: noop,
    })
  );
}

const DEVICE: DeviceInfo = {
  userAgent: "UA",
  deviceMemoryGb: 2,
  cores: 4,
  quotaBytes: null,
  usageBytes: null,
  persisted: null,
  language: "sw-KE",
  languages: ["sw-KE", "en-US"],
};

describe("the font section of the phone check", () => {
  it("shows every sample with its own lang and direction", () => {
    const root = view();
    for (const s of [...SCRIPT_SAMPLES, ...DIGIT_SAMPLES]) {
      const el = one(root, `[data-phone-check-sample="${s.id}"]`);
      expect(el.getAttribute("lang")).toBe(s.lang);
      expect(el.getAttribute("dir")).toBe(s.dir);
      expect(el.textContent).toBe(s.text);
    }
  });

  it("covers the non-Latin scripts of the ten UI languages and the level-3 ones", () => {
    const langs = new Set(SCRIPT_SAMPLES.map((s) => s.lang));
    for (const tag of ["ar", "hi", "zh-Hans", "ru"]) {
      expect(LOCALES.some((l) => l.tag === tag)).toBe(true);
      expect(langs.has(tag)).toBe(true);
    }
    for (const lang of ["am", "bn", "my", "lo", "th", "ur"]) {
      expect(langs.has(lang)).toBe(true);
    }
  });

  it("shows the three digit forms as three different strings", () => {
    const texts = DIGIT_SAMPLES.map((s) => s.text);
    expect(new Set(texts).size).toBe(3);
    expect(texts[0]).toBe("0123456789");
  });

  it("has a heading and an intro from the table", () => {
    const root = view();
    expect(one(root, '[data-phone-check="fonts"] h2').textContent).toBe(
      strings.phoneCheckFontTitle
    );
    expect(one(root, '[data-phone-check="fonts-intro"]').textContent).toBe(
      strings.phoneCheckFontIntro
    );
    expect(one(root, '[data-phone-check="digits-note"]').textContent).toBe(
      strings.phoneCheckDigitsNote
    );
  });
});

describe("the report's language fields", () => {
  const report = (device: DeviceInfo | null) =>
    formatPhoneCheckReport({
      version: "1.1.0",
      sha: "abc1234",
      device: device ? { status: "ok", value: device } : null,
      encode: null,
      dsp: null,
      storage: null,
      allocation: null,
    });

  it("prints navigator.language and navigator.languages", () => {
    const text = report(DEVICE);
    expect(text).toContain("- Language: sw-KE");
    expect(text).toContain("- Languages: sw-KE, en-US");
  });

  it("says not reported when the browser did not say", () => {
    const text = report({ ...DEVICE, language: null, languages: null });
    expect(text).toContain("- Language: not reported");
    expect(text).toContain("- Languages: not reported");
  });

  it("carries one fill-in line per sample so a tester records a verdict", () => {
    const text = report(null);
    for (const s of [...SCRIPT_SAMPLES, ...DIGIT_SAMPLES]) {
      expect(text).toContain(`- ${s.label} (${s.lang}): `);
    }
  });

  it("is read from the navigator by the device probe", async () => {
    const info = await readDeviceInfo({
      userAgent: "UA",
      language: "ar-EG",
      languages: ["ar-EG", "en"],
    });
    expect(info.language).toBe("ar-EG");
    expect(info.languages).toEqual(["ar-EG", "en"]);
    const bare = await readDeviceInfo({});
    expect(bare.language).toBeNull();
    expect(bare.languages).toBeNull();
  });

  it("round-trips through the saved results, and an old payload reads as not reported", () => {
    const saved = parseSavedChecks(
      serializeSavedChecks({
        device: { status: "ok", value: DEVICE },
        encode: null,
        dsp: null,
        storage: null,
      })
    );
    expect(saved?.device).toEqual({ status: "ok", value: DEVICE });

    const old: Record<string, unknown> = { ...DEVICE };
    delete old.language;
    delete old.languages;
    const oldSaved = parseSavedChecks(
      JSON.stringify({ device: { status: "ok", value: old } })
    );
    expect(oldSaved?.device).toEqual({
      status: "ok",
      value: { ...old, language: null, languages: null },
    });

    const wrong = parseSavedChecks(
      JSON.stringify({
        device: { status: "ok", value: { ...DEVICE, languages: [1] } },
      })
    );
    expect(wrong?.device).toBeNull();

    const wrongLanguage = parseSavedChecks(
      JSON.stringify({
        device: { status: "ok", value: { ...DEVICE, language: 5 } },
      })
    );
    expect(wrongLanguage?.device).toBeNull();
  });
});
