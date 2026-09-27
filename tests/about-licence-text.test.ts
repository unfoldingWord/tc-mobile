// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AboutPanel } from "@/components/about-panel";
import { licenseTexts, type LicenseText } from "@/components/licenses";
import { reportFailure } from "@/hooks/report-failure";
import { strings } from "@/lib/strings";

/**
 * #823 items 1, 2, 3 and 6: the About panel's licence-text fetch.
 *
 * - a failed fetch reaches the failure funnel, not only `console.error`;
 * - a 200 that is HTML (a host answering a missing `.txt` with the app shell)
 *   is a failure, not a licence;
 * - a mounted `href` change shows its own loading state, never the previous
 *   text's failure, and aborts the fetch it replaces;
 * - the `.txt` navigate-fallback denylist entry matches a query string.
 *
 * The panel is mounted for real (react-dom + `act()` in jsdom, the
 * `about-back-navigation.test.ts` harness) so the effect runs.
 */

vi.mock("@/hooks/report-failure", () => ({ reportFailure: vi.fn() }));

const [first, second] = licenseTexts as [LicenseText, LicenseText];
const LICENCE = "MIT License\n\nCopyright (c) unfoldingWord\n";
const SHELL = '<!doctype html>\n<html lang="en"><head></head></html>';

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "<div id='root'></div>";
  container = document.getElementById("root")!;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function respond(body: string, init: ResponseInit) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, init))
  );
}

async function show(text: LicenseText) {
  await act(async () => {
    root.render(
      createElement(AboutPanel, {
        open: true,
        viewing: text,
        onView: () => {},
        onBack: () => {},
        onClose: () => {},
      })
    );
  });
}

const settle = () =>
  vi.waitFor(() =>
    expect(document.body.textContent).not.toContain(strings.aboutTextLoading)
  );
const pre = () => document.querySelector("pre");

it("renders a plain-text licence body and reports nothing", async () => {
  respond(LICENCE, { status: 200, headers: { "content-type": "text/plain" } });
  await show(first);
  await settle();

  expect(pre()?.textContent).toBe(LICENCE);
  expect(reportFailure).not.toHaveBeenCalled();
});

it('reports a failed fetch to the funnel as "about-licence-text" (#823 item 1)', async () => {
  respond("", { status: 404 });
  await show(first);
  await settle();

  expect(document.body.textContent).toContain(strings.aboutTextFailed);
  expect(pre()).toBeNull();
  expect(reportFailure).toHaveBeenCalledTimes(1);
  expect(reportFailure).toHaveBeenCalledWith(
    expect.any(Error),
    "about-licence-text"
  );
});

it("treats a 200 declared text/html as a failure, not a licence (#823 item 2)", async () => {
  respond(SHELL, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
  await show(first);
  await settle();

  expect(document.body.textContent).toContain(strings.aboutTextFailed);
  expect(pre()).toBeNull();
  expect(reportFailure).toHaveBeenCalledWith(
    expect.any(Error),
    "about-licence-text"
  );
});

it("treats a 200 whose body opens as an HTML document as a failure, whatever its declared type (#823 item 2)", async () => {
  respond(`  ${SHELL.toUpperCase()}`, {
    status: 200,
    headers: { "content-type": "text/plain" },
  });
  await show(first);
  await settle();

  expect(document.body.textContent).toContain(strings.aboutTextFailed);
  expect(pre()).toBeNull();
});

it("shows the new text's loading state after a mounted href change, not the previous failure, and aborts the replaced fetch (#823 item 6)", async () => {
  respond("", { status: 500 });
  await show(first);
  await settle();
  expect(document.body.textContent).toContain(strings.aboutTextFailed);

  const signals: AbortSignal[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((_: string, init?: RequestInit) => {
      signals.push(init!.signal!);
      return new Promise<Response>(() => {});
    })
  );
  await show(second);

  expect(document.body.textContent).toContain(strings.aboutTextLoading);
  expect(document.body.textContent).not.toContain(strings.aboutTextFailed);

  // A third text replaces the pending second fetch: that fetch is aborted,
  // and its abort is not reported as a failure.
  vi.mocked(reportFailure).mockClear();
  await show(first);
  expect(signals).toHaveLength(2);
  expect(signals[0]!.aborted).toBe(true);
  expect(signals[1]!.aborted).toBe(false);
  expect(reportFailure).not.toHaveBeenCalled();
});

it("aborts an in-flight fetch on unmount without reporting it (#823 item 6)", async () => {
  let signal: AbortSignal | undefined;
  let reject: (cause: unknown) => void = () => {};
  vi.stubGlobal(
    "fetch",
    vi.fn((_: string, init?: RequestInit) => {
      signal = init!.signal!;
      return new Promise<Response>((_resolve, r) => {
        reject = r;
      });
    })
  );
  await show(first);
  await act(async () => root.unmount());
  expect(signal?.aborted).toBe(true);

  await act(async () => {
    reject(new DOMException("The operation was aborted.", "AbortError"));
  });
  expect(reportFailure).not.toHaveBeenCalled();
  root = createRoot(container);
});

it("keeps a /licenses/*.txt navigation with a query string off the SPA fallback (#823 item 3)", () => {
  const source = readFileSync(
    path.join(__dirname, "..", "vite.config.ts"),
    "utf8"
  );
  const entries = source.match(/navigateFallbackDenylist:\s*\[([^\n]*)\],/);
  if (!entries?.[1])
    throw new Error(
      "could not find navigateFallbackDenylist in vite.config.ts"
    );
  const txt = [...entries[1].matchAll(/\/((?:\\\/|[^/])+)\//g)]
    .map((m) => new RegExp(m[1]!))
    .find((re) => re.test("/licenses/MIT.txt"));
  if (!txt) throw new Error("no denylist entry matches /licenses/MIT.txt");

  expect(txt.test("/licenses/MIT.txt?v=1")).toBe(true);
  expect(txt.test("/licenses/MIT.txtfoo")).toBe(false);
});
