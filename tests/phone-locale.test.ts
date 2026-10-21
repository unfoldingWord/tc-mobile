// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyPhoneLocale,
  installPhoneLocale,
  usePhoneLocale,
} from "@/hooks/phone-locale";
import { installLocale } from "@/lib/i18n/locales";
import { activeLocale, SHIPPED_LOCALE } from "@/lib/locale";
import { plural } from "@/lib/plural";
import { strings, stringsEn } from "@/lib/strings";

/**
 * The runtime locale installer and follower (#1538, ADR 0015 (b), (e), (g)).
 *
 * No language but English has a translation yet, so the French and Arabic
 * tables here are injected: the registry's own `fr` and `ar` modules are
 * replaced by objects each case fills or empties. The phone's language list
 * is injected through `navigator.languages`.
 *
 * What this does NOT establish: the first frames on a right-to-left phone
 * (ADR 0015 (a)), or that every screen re-renders in a real browser. Those
 * are the device rows on #1538.
 */

const tables = vi.hoisted(() => ({
  fr: {} as Record<string, unknown>,
  ar: {} as Record<string, unknown>,
}));
vi.mock("@/lib/i18n/fr", () => ({ table: tables.fr }));
vi.mock("@/lib/i18n/ar", () => ({ table: tables.ar }));

/** Every English entry, text entries prefixed, so the table is complete. */
function fill(target: Record<string, unknown>, prefix: string): void {
  for (const [key, value] of Object.entries(stringsEn)) {
    target[key] = typeof value === "string" ? `${prefix}${value}` : value;
  }
}

function empty(target: Record<string, unknown>): void {
  for (const key of Object.keys(target)) delete target[key];
}

let languages: readonly string[] = ["en"];

beforeEach(() => {
  languages = ["en"];
  Object.defineProperty(navigator, "languages", {
    configurable: true,
    get: () => languages,
  });
  fill(tables.fr, "FR ");
  fill(tables.ar, "AR ");
  installLocale(SHIPPED_LOCALE);
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
});

afterEach(() => {
  empty(tables.fr);
  empty(tables.ar);
  installLocale(SHIPPED_LOCALE);
});

const word = (): string => strings.menuTitle;

describe("applyPhoneLocale, at launch", () => {
  it("installs a complete locale's table, lang and dir", () => {
    expect(applyPhoneLocale(["fr-FR", "en"])).toBe(true);
    expect(word()).toBe("FR Menu");
    expect(activeLocale().tag).toBe("fr");
    expect(document.documentElement.lang).toBe("fr");
    expect(document.documentElement.dir).toBe("ltr");
  });

  it("sets dir from the locale entry, rtl for Arabic", () => {
    applyPhoneLocale(["ar-EG"]);
    expect(word()).toBe("AR Menu");
    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
  });

  it("skips an incomplete locale, ending at English (ADR 0015 (g))", () => {
    delete tables.fr.menuTitle;
    expect(applyPhoneLocale(["fr-FR", "en"])).toBe(false);
    expect(word()).toBe("Menu");
    expect(activeLocale()).toBe(SHIPPED_LOCALE);
    expect(document.documentElement.lang).toBe("en");
  });

  it("counts an entry set to undefined as missing", () => {
    tables.fr.menuTitle = undefined;
    applyPhoneLocale(["fr"]);
    expect(activeLocale()).toBe(SHIPPED_LOCALE);
    expect(word()).toBe("Menu");
  });

  it("walks past an incomplete locale to the next complete one", () => {
    delete tables.fr.menuTitle;
    applyPhoneLocale(["fr", "ar"]);
    expect(activeLocale().tag).toBe("ar");
  });

  it("reads navigator.languages when called before createRoot", () => {
    languages = ["fr-CA"];
    installPhoneLocale();
    expect(word()).toBe("FR Menu");
  });

  it("falls back to navigator.language when the list is empty", () => {
    languages = [];
    Object.defineProperty(navigator, "language", {
      configurable: true,
      get: () => "fr",
    });
    installPhoneLocale();
    expect(activeLocale().tag).toBe("fr");
  });

  it("ships English for a language whose real table is incomplete", () => {
    empty(tables.fr);
    empty(tables.ar);
    applyPhoneLocale(["fr", "ar", "zh-TW"]);
    expect(activeLocale()).toBe(SHIPPED_LOCALE);
    expect(word()).toBe("Menu");
  });

  it("ships Spanish to a Spanish phone, from the real es table (#1585)", () => {
    empty(tables.fr);
    empty(tables.ar);
    applyPhoneLocale(["fr", "es-419"]);
    expect(activeLocale().tag).toBe("es");
    expect(word()).toBe("Menú");
    expect(document.documentElement.lang).toBe("es");
  });
});

describe("plural's default follows the installed locale (ADR 0015 (b))", () => {
  it("selects by the installed locale's rule when no tag is passed", () => {
    const forms = { one: "{n} one", other: "{n} other" };
    expect(plural(21, forms)).toBe("21 other");
    // Russian selects `one` at 21; English selects `other`.
    installLocale({ tag: "ru", dir: "ltr" });
    expect(plural(21, forms)).toBe("21 one");
  });
});

/** Mounts the follower with the take state as a prop. */
function Probe({ takeOpen }: { takeOpen: boolean }) {
  usePhoneLocale(takeOpen);
  return createElement("p", null, strings.menuTitle);
}

describe("usePhoneLocale, a change while running (ADR 0015 (e))", () => {
  let container: HTMLDivElement;
  let root: Root;
  let visibility: DocumentVisibilityState = "visible";

  beforeEach(() => {
    visibility = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const shown = (): string | null => container.textContent;
  const mount = (takeOpen: boolean) =>
    act(() => root.render(createElement(Probe, { takeOpen })));
  const languageChange = () =>
    act(() => {
      window.dispatchEvent(new Event("languagechange"));
    });

  it("re-renders in the new language on languagechange", () => {
    mount(false);
    expect(shown()).toBe("Menu");
    languages = ["fr"];
    languageChange();
    expect(shown()).toBe("FR Menu");
    expect(document.documentElement.lang).toBe("fr");
  });

  it("re-resolves on return to the foreground", () => {
    mount(false);
    languages = ["fr"];
    visibility = "hidden";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(shown()).toBe("Menu");
    visibility = "visible";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(shown()).toBe("FR Menu");
  });

  it("with a take open, changes no words until the take closes", () => {
    mount(true);
    languages = ["fr"];
    languageChange();
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(shown()).toBe("Menu");
    expect(word()).toBe("Menu");
    expect(document.documentElement.lang).toBe("en");
    mount(false);
    expect(shown()).toBe("FR Menu");
    expect(document.documentElement.lang).toBe("fr");
  });

  it("stops listening when unmounted", () => {
    mount(false);
    act(() => root.unmount());
    languages = ["fr"];
    window.dispatchEvent(new Event("languagechange"));
    expect(word()).toBe("Menu");
    root = createRoot(container);
  });
});
