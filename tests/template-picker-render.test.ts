import { createElement } from "react";
import { describe, expect, it } from "vitest";

import {
  TemplateList,
  TemplateLibraryBody,
} from "@/components/template-picker";
import type { TemplateLibraryStatus } from "@/hooks/use-template-library";
import { loadObsTemplate } from "@/lib/templates/obs";
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
  it("while a (re)load is read: no failure Notice, the list and its rows busy", async () => {
    const root = await body("loading");
    expect(root.querySelector(".notice")).toBeNull();
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
