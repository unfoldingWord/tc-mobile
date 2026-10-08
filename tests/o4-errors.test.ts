import { readFileSync } from "node:fs";
import path from "node:path";

import { createElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "@/components/error-boundary";
import { PermissionPanel } from "@/components/permission-panel";
import { SaveFailed } from "@/components/save-failed";
import { strings } from "@/lib/strings";

import { one, render } from "./render";
import { stripCssComments } from "./support";

/**
 * The O4 look of the three recovery surfaces (#948, epic #936): mic denied
 * (state 16), crash (18) and `SaveFailed`, which shares the crash screen's
 * shape. Props-to-markup only, through `tests/render.ts` — no effects, no
 * cascade, no browser. Whether the rules in `o4/errors.css` paint what the
 * workbench shows is not something this file can answer.
 */
afterEach(() => {
  vi.restoreAllMocks();
});

function crashScreen(): Element {
  const boundary = new ErrorBoundary({ children: null });
  boundary.state = ErrorBoundary.getDerivedStateFromError();
  return render(createElement(() => boundary.render() as ReactElement));
}

const saveFailedProps = {
  state: "failed" as const,
  kind: "unknown" as const,
  editOnly: false,
  ordinal: 3,
  holdsCutAudio: false,
  attempts: 1,
  onRetry: () => {},
  onDiscard: () => {},
};

describe("mic denied, O4 (state 16)", () => {
  const panel = () =>
    render(
      createElement(PermissionPanel, {
        message: null,
        onRetry: () => {},
        onBack: () => {},
      })
    );

  it("puts the mic glyph in the error circle", () => {
    const circle = one(panel(), ".o4-err-circle");
    expect(circle.classList.contains("o4-err-circle--denied")).toBe(true);
    expect(circle.classList.contains("o4-err-circle--warn")).toBe(false);
    expect(circle.getAttribute("aria-hidden")).toBe("true");
    // The mic glyph — the one icon on this screen that says WHICH thing is off.
    expect(circle.querySelector("svg")?.getAttribute("width")).toBe("58");
  });

  it("keeps the alert on the title, and both controls with their names", () => {
    const container = panel();
    const alert = one(container, '[role="alert"]');
    expect(alert.textContent).toBe(strings.micOffTitle);
    expect(alert.classList.contains("o4-err-title")).toBe(true);
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      strings.micRetry,
      strings.micBack,
    ]);
    for (const button of buttons) expect(alert.contains(button)).toBe(false);
    // Retry is the wide guide button and still the one that takes focus.
    const retry = buttons[0]!;
    expect(retry.classList.contains("o4-err-wide")).toBe(true);
    expect(retry.hasAttribute("autofocus")).toBe(true);
  });
});

describe("crash / recovery, O4 (state 18)", () => {
  it("puts the alert mark in the warn circle", () => {
    const circle = one(crashScreen(), ".o4-err-circle");
    expect(circle.classList.contains("o4-err-circle--warn")).toBe(true);
    expect(circle.querySelector("svg")?.getAttribute("width")).toBe("72");
  });

  it("keeps the dialog's name, description, Restart and the Send-log control", () => {
    const container = crashScreen();
    const dialog = one(container, '[role="alertdialog"]');
    expect(dialog.getAttribute("aria-labelledby")).toBe("app-failed-title");
    expect(dialog.getAttribute("aria-describedby")).toBe("app-failed-teach");
    const title = one(container, "#app-failed-title");
    expect(title.textContent).toBe(strings.appFailed);
    expect(title.classList.contains("o4-err-title")).toBe(true);
    expect(one(container, "#app-failed-teach").textContent).toBe(
      strings.appReloadTeach
    );

    const restart = one(container, `[aria-label="${strings.appReload}"]`);
    expect(restart.classList.contains("o4-err-wide")).toBe(true);
    // The restart glyph, not retry's circular-arrow-with-notch: workbench
    // state 18 draws the restart mark on this button, as `PermissionPanel`
    // does on its own wide Restart.
    expect(restart.querySelector("svg path")?.getAttribute("d")).toBe(
      "M18.3 11a7.3 7.3 0 1 1-2.1-5.2"
    );
    // The Send-log control is the existing one, untouched: same name, quiet.
    const send = one(container, `[aria-label="${strings.shareFailureLog}"]`);
    expect(send.classList.contains("control--quiet")).toBe(true);
    // Restart first, Send after it (`ErrorBoundary`'s docblock).
    expect(
      restart.compareDocumentPosition(send) &
        restart.ownerDocument.defaultView!.Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("never shows the cause (#172)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const boundary = new ErrorBoundary({ children: null });
    const cause = new Error("zzq-raw-cause-text");
    boundary.componentDidCatch(cause, { componentStack: "zzq-stack" });
    boundary.state = ErrorBoundary.getDerivedStateFromError();
    const container = render(
      createElement(() => boundary.render() as ReactElement)
    );
    // Positive floor, so an empty render cannot pass the negative below.
    expect(container.textContent).toContain(strings.appFailed);
    expect(container.textContent).not.toContain("zzq");
  });
});

describe("SaveFailed, O4", () => {
  it("puts the alert mark in the error circle, and keeps Retry and Send", () => {
    const container = render(createElement(SaveFailed, saveFailedProps));
    const circle = one(container, ".o4-err-circle");
    expect(circle.classList.contains("o4-err-circle--warn")).toBe(false);
    const retry = one(container, '[aria-label="Try saving again"]');
    expect(retry.classList.contains("o4-err-wide")).toBe(true);
    one(container, `[aria-label="${strings.shareFailureLog}"]`);
    expect(
      one(container, '[role="alertdialog"]').getAttribute("aria-label")
    ).toBe(strings.saveFailedDialog(false));
  });

  it("keeps the busy mark, not the circle, while a save is in flight", () => {
    const container = render(
      createElement(SaveFailed, { ...saveFailedProps, state: "saving" })
    );
    expect(container.textContent).toContain(strings.saveFailedSaving);
    // The circle is the failure's ground; the in-flight state keeps its
    // plain spinner glyph so the two states cannot read alike.
    expect(container.querySelector(".o4-err-circle")).toBeNull();
  });
});

describe("o4/errors.css", () => {
  const css = stripCssComments(
    readFileSync(
      path.resolve(import.meta.dirname, "..", "src/app/styles/o4/errors.css"),
      "utf8"
    )
  );

  // Every rule's selector list, comments stripped so prose cannot match.
  const rules = [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map(
    ([, selector, body]) => ({ selector: selector!.trim(), body: body! })
  );

  it("prefixes every selector with :root, holding the specificity o4/index.css documents", () => {
    expect(rules.length).toBeGreaterThanOrEqual(6);
    for (const { selector } of rules)
      for (const part of selector.split(","))
        expect(part.trim(), selector).toMatch(/^:root /);
  });

  it("takes every colour from a layer-2 role", () => {
    const declarations = rules.flatMap(({ body }) => [
      ...body.matchAll(/(color|background|border(?:-color)?):\s*([^;]+);/g),
    ]);
    expect(declarations.length).toBeGreaterThanOrEqual(5);
    for (const [, prop, value] of declarations)
      expect(value, `${prop}: ${value}`).toMatch(/^var\(--s-[a-z-]+\)$/);
  });
});
