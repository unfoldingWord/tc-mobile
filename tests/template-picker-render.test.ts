import { readFile } from "node:fs/promises";
import path from "node:path";

import { createElement } from "react";
import { describe, expect, it } from "vitest";

import {
  TemplateList,
  TemplateLibraryBody,
} from "@/components/template-picker";
import type { TemplateLibraryStatus } from "@/hooks/use-template-library";
import { loadObsTemplate } from "@/lib/templates/obs";
import { loadTemplateEntries } from "@/lib/templates/packages";
import { strings } from "@/lib/strings";

import { one, render } from "./render";

/**
 * The Template Library's list (#246): one row per bundled package, each a
 * thumbnail, the title, and one icon-first licence line. One static render:
 * no effects and no events. The layout is the plainest text-and-thumbnail
 * list on purpose (the layout of a longer list is the requirements owner's
 * call, #246).
 */

async function list(base: string, busy = false): Promise<Element> {
  const entry = await loadObsTemplate();
  return render(
    createElement(TemplateList, {
      entries: [entry],
      base,
      language: "en",
      busy,
      onPick: () => {},
    })
  );
}

/**
 * OBS beside a Bible book (#1450 R7). The entries come through the real
 * package list (`loadTemplateEntries`) from OBS and the vendored Titus
 * package the bake step pins, in the order the list names them, so a row
 * order that differs from the list order is a picker defect. Both orders are
 * drawn: sorting the rows by title or by id each breaks one of them.
 */
const TITUS = path.resolve(
  import.meta.dirname,
  "..",
  "templates",
  "bible-passages",
  "TIT.json"
);

async function loadTitus() {
  return {
    pkg: JSON.parse(await readFile(TITUS, "utf8")) as unknown,
    titles: [],
  };
}

async function rowsFor(
  sources: Parameters<typeof loadTemplateEntries>[0]
): Promise<Element[]> {
  const { entries, failures } = await loadTemplateEntries(sources);
  expect(failures).toEqual([]);
  const root = render(
    createElement(TemplateList, {
      entries,
      base: "/",
      language: "en",
      busy: false,
      onPick: () => {},
    })
  );
  return Array.from(root.querySelectorAll("button.template-row"));
}

const rowTitles = (rows: Element[]) =>
  rows.map((r) => one(r, ".template-row-title").textContent);

describe("TemplateList with a Bible book (#1450 R7)", () => {
  it("draws OBS then Titus in package-list order, each with its title and CC BY-SA 4.0", async () => {
    const rows = await rowsFor([loadObsTemplate, loadTitus]);
    expect(rowTitles(rows)).toEqual(["Open Bible Stories", "Titus"]);
    for (const row of rows) {
      expect(one(row, ".template-row-licence").textContent).toBe(
        "CC BY-SA 4.0"
      );
    }
    const titus = rows[1] as Element;
    expect(titus.getAttribute("aria-label")).toBe(
      strings.sentences("Titus", strings.templateLicenceLabel("CC BY-SA 4.0"))
    );
    // The package has no thumbnail, so the row draws none.
    expect(titus.querySelector("img")).toBeNull();
  });

  it("keeps the list's order when the list names Titus first", async () => {
    const rows = await rowsFor([loadTitus, loadObsTemplate]);
    expect(rowTitles(rows)).toEqual(["Titus", "Open Bible Stories"]);
  });
});

describe("TemplateList", () => {
  it("draws the OBS row: thumbnail at the app-base path, title, icon-first licence line", async () => {
    const root = await list("/");
    const rows = Array.from(root.querySelectorAll("button.template-row"));
    expect(rows).toHaveLength(1);
    const row = rows[0] as Element;
    expect(row.getAttribute("type")).toBe("button");
    // The name carries what a sighted person reads: title, then licence.
    expect(row.getAttribute("aria-label")).toBe(
      strings.sentences(
        "Open Bible Stories",
        strings.templateLicenceLabel("CC BY-SA 4.0")
      )
    );
    expect(one(row, ".template-row-title").textContent).toBe(
      "Open Bible Stories"
    );
    expect(one(row, "img").getAttribute("src")).toBe(
      "/obs/thumbs/obs-01-01.jpg"
    );
    expect(one(row, "img").getAttribute("alt")).toBe("");
    const licence = one(row, ".template-row-licence");
    // Icon first, then the tag.
    expect(licence.firstElementChild?.tagName.toLowerCase()).toBe("svg");
    expect(licence.textContent).toBe("CC BY-SA 4.0");
    // A roleless span's aria-label is not spoken (inference); the row's name
    // carries the licence instead.
    expect(licence.hasAttribute("aria-label")).toBe(false);
  });

  it("resolves the thumbnail against a non-root base, not the route", async () => {
    const root = await list("/tc/");
    expect(one(root, "img").getAttribute("src")).toBe(
      "/tc/obs/thumbs/obs-01-01.jpg"
    );
  });

  it("marks the rows busy while a create is in flight", async () => {
    const root = await list("/", true);
    expect(one(root, "button.template-row").getAttribute("aria-busy")).toBe(
      "true"
    );
  });
});

async function body(
  status: TemplateLibraryStatus,
  creating = false
): Promise<Element> {
  const entry = await loadObsTemplate();
  return render(
    createElement(TemplateLibraryBody, {
      status,
      creating,
      entries: [entry],
      base: "/",
      language: "en",
      onPick: () => {},
    })
  );
}

describe("TemplateLibraryBody (#1747)", () => {
  it("while a (re)load is read: the loading sentence as a busy status, no failure Notice, the list and its rows busy", async () => {
    const root = await body("loading");
    const notices = Array.from(root.querySelectorAll(".notice"));
    expect(notices).toHaveLength(1);
    const notice = notices[0] as Element;
    expect(notice.getAttribute("data-tone")).toBe("busy");
    expect(notice.getAttribute("role")).toBe("status");
    expect(notice.textContent).toBe("Loading the templates.");
    expect(notice.textContent).toBe(strings.loadingTemplates);
    expect(one(root, ".settings-list").getAttribute("aria-busy")).toBe("true");
    expect(one(root, "button.template-row").getAttribute("aria-busy")).toBe(
      "true"
    );
  });

  it("once nothing loaded: the failure Notice, as an alert", async () => {
    const root = await body("failed");
    const notice = one(root, ".notice");
    expect(notice.getAttribute("role")).toBe("alert");
    expect(notice.textContent).toBe(strings.loadFailed);
  });

  it("once ready: no Notice, rows not busy", async () => {
    const root = await body("ready");
    expect(root.querySelector(".notice")).toBeNull();
    expect(one(root, ".settings-list").getAttribute("aria-busy")).toBe("false");
    expect(one(root, "button.template-row").getAttribute("aria-busy")).toBe(
      "false"
    );
  });

  it("while a create is in flight, ready or not: rows busy", async () => {
    const root = await body("ready", true);
    expect(one(root, "button.template-row").getAttribute("aria-busy")).toBe(
      "true"
    );
  });
});
