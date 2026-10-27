// @vitest-environment jsdom
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, describe, expect, it } from "vitest";

import { ChapterPlayControl } from "@/components/chapter-play-control";
import type { ChapterRowStatus } from "@/components/chapter-row-status";
import { Control } from "@/components/control";
import { CoverPicker } from "@/components/cover-picker";
import { EraseConfirm } from "@/components/erase-confirm";
import { FailureLogPanel } from "@/components/failure-log-panel";
import { LanguageAsk } from "@/components/language-ask";
import { LicenceAsk } from "@/components/licence-ask";
import { Menu } from "@/components/menu";
import { NameEdit } from "@/components/name-edit";
import { O4BookDeleteAsk } from "@/components/o4-book-delete-ask";
import { CoverTile, O4CoverPick } from "@/components/o4-book-menu";
import { Tile, TileGrid } from "@/components/o4-tile-menu";
import { PermissionPanel } from "@/components/permission-panel";
import { RecorderMenu } from "@/components/recorder-menu";
import { RecorderToolbar } from "@/components/recorder-toolbars";
import { SelectionOverlay } from "@/components/selection-overlay";
import { SettingRow } from "@/components/setting-row";
import { SettingsPanel } from "@/components/settings-panel";
import { ShareProgressPanel } from "@/components/share-progress-panel";
import { StoragePressureBanner } from "@/components/storage-pressure-banner";
import type { UseLibraryShare } from "@/hooks/use-library-share";
import { TemplateList } from "@/components/template-picker";
import {
  CANONICAL_SAMPLE_RATE,
  framesToSpokenSeconds,
} from "@/lib/audio/format";
import { strings } from "@/lib/strings";
import { indexLanguageList } from "@/lib/languages/list";
import { completeLocales, installLocale } from "@/lib/i18n/locales";
import { SHIPPED_LOCALE } from "@/lib/locale";
import { loadObsTemplate } from "@/lib/templates/obs";

import { render } from "./render";

/**
 * A gate for #1344's "every control carries a full accessible name": render
 * each presentational surface the audit touched, in English and in every
 * complete language, and read the attributes it emits.
 *
 * Three rules, each reported by surface and locale:
 *
 * 1. A button, radio, slider, switch or image has a non-empty accessible name.
 * 2. No `aria-label` sits on an element with no role that has none natively (a
 *    plain `span` or `div`): such a label is not spoken (inference), so the
 *    words it holds are lost. A `div` with a `role` stays fine.
 * 3. Label in name (WCAG 2.5.3): when a control draws text, its accessible
 *    name contains that text, so a person who says what they see is understood
 *    and a screen reader does not speak less than the screen shows.
 *
 * Scope is the surfaces listed in `SURFACES`, not a tree sweep. A surface this
 * does not list is not covered; adding one is one entry.
 *
 * Covered: Control, SettingRow, TemplateList, LicenceAsk, O4BookDeleteAsk,
 * ChapterPlayControl, CoverPicker, LanguageAsk, SelectionOverlay,
 * ShareProgressPanel, EraseConfirm, SettingsPanel, Menu, the book menu's
 * Cover colour tile and cover pick, Tile and TileGrid, RecorderMenu,
 * RecorderToolbar, PermissionPanel, NameEdit, FailureLogPanel and
 * StoragePressureBanner.
 *
 * Not covered, by name: the book menu's `LicenceTile` and the recorder menu's
 * Stop tile (a ru or id name drops its caption, #1732); the app (≡) menu, the
 * chapter and segment menus and every screen; `ShareProgress` itself (the
 * portal and its focus logic around the panel). A surface that portals
 * (`mounted`) is mounted in jsdom rather than rendered to static markup.
 *
 * WHAT A RENDER READ CANNOT SEE. This reads attributes in static markup. It is
 * not what TalkBack or VoiceOver speak: it does not run a browser's name
 * algorithm (the one below is a reduced reading of it: `aria-labelledby`, then
 * `aria-label`, then `alt` on an image or exposed text otherwise, then
 * `title`; `alt=""` and a presentational role mark a decorative image that
 * needs no name), it sees no CSS (so
 * `display: none` and the screen-reader-only class are matched by name), and
 * it cannot read a live region's announcement. Spoken form is a device check.
 *
 * The rules are read through `render`, so a comment cannot satisfy them.
 */

interface Finding {
  rule: 1 | 2 | 3;
  site: string;
  detail: string;
}

const NAMED_ROLES = new Set(["radio", "slider", "switch", "img"]);
// Elements whose own tag gives them a role, so an `aria-label` is spoken.
const LABELLABLE_TAGS = new Set([
  "button",
  "a",
  "input",
  "select",
  "textarea",
  "img",
  "svg",
  "section",
  "nav",
  "form",
  "dialog",
  "fieldset",
  "table",
  "ul",
  "ol",
  "main",
  "header",
  "footer",
  "aside",
]);

const squash = (text: string): string =>
  text.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The text a name is computed from: what is exposed to assistive technology,
 * not what is drawn. `aria-hidden` text is drawn but not exposed, so it names
 * nothing; screen-reader-only text is exposed but not drawn, so it does.
 */
function exposedText(el: Element): string {
  let out = "";
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3) out += node.textContent ?? "";
    else if (node.nodeType === 1) {
      const child = node as Element;
      if (
        child.hasAttribute("hidden") ||
        child.getAttribute("aria-hidden") === "true"
      ) {
        continue;
      }
      out += ` ${exposedText(child)} `;
    }
  }
  return out;
}

/** Each separately drawn piece of text, so a name may put a word between two. */
function drawnParts(el: Element): string[] {
  const parts: string[] = [];
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3) {
      const text = squash(node.textContent ?? "");
      if (text !== "") parts.push(text);
    } else if (node.nodeType === 1) {
      const child = node as Element;
      if (child.hasAttribute("hidden") || child.matches(".sr-only")) continue;
      parts.push(...drawnParts(child));
    }
  }
  return parts;
}

function accessibleName(el: Element): string {
  const by = el.getAttribute("aria-labelledby");
  if (by !== null) {
    const doc = el.ownerDocument;
    return by
      .split(/\s+/)
      .map((id) => doc.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
  }
  const label = el.getAttribute("aria-label");
  if (label !== null && label.trim() !== "") return label.trim();
  const title = (el.getAttribute("title") ?? "").trim();
  if (el.tagName === "IMG") {
    // A present `alt`, empty included, is the name; `title` only without one.
    const alt = el.getAttribute("alt");
    return alt !== null ? alt.trim() : title;
  }
  return exposedText(el).replace(/\s+/g, " ").trim() || title;
}

/**
 * `alt=""` with no author label, or a presentational role: not named. A
 * presentational role is ignored on a focusable `<button>`, which still needs
 * a name.
 */
function decorative(el: Element): boolean {
  const role = el.getAttribute("role");
  const presentational = role === "presentation" || role === "none";
  if (presentational && el.tagName !== "BUTTON") return true;
  return (
    el.tagName === "IMG" &&
    el.getAttribute("alt") === "" &&
    !el.hasAttribute("aria-labelledby") &&
    (el.getAttribute("aria-label") ?? "").trim() === ""
  );
}

function site(el: Element): string {
  const cls = el.getAttribute("class");
  return `<${el.tagName.toLowerCase()}${cls ? `.${cls.split(" ")[0]}` : ""}>`;
}

/** Every finding in `root`, across the three rules. */
function findings(root: Element, labelInName = true): Finding[] {
  const out: Finding[] = [];
  const named = root.querySelectorAll(
    "button, img, [role=radio], [role=slider], [role=switch], [role=img]"
  );
  for (const el of Array.from(named)) {
    if (decorative(el)) continue;
    const role = el.getAttribute("role");
    if (role !== null && !NAMED_ROLES.has(role) && el.tagName !== "BUTTON") {
      continue;
    }
    const name = accessibleName(el);
    if (name === "") {
      out.push({ rule: 1, site: site(el), detail: "empty name" });
      continue;
    }
    if (labelInName) {
      for (const part of drawnParts(el)) {
        if (squash(name).includes(part)) continue;
        out.push({
          rule: 3,
          site: site(el),
          detail: `name "${name}" lacks drawn text "${part}"`,
        });
      }
    }
  }
  for (const el of Array.from(root.querySelectorAll("[aria-label]"))) {
    if (
      el.hasAttribute("role") ||
      LABELLABLE_TAGS.has(el.tagName.toLowerCase())
    ) {
      continue;
    }
    out.push({
      rule: 2,
      site: site(el),
      detail: `aria-label "${el.getAttribute("aria-label")}" on a roleless element`,
    });
  }
  return out;
}

const noop = () => {};

/** Mount one element in the jsdom window, read the body it portals into. */
async function mount(element: ReactElement): Promise<Element> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  await act(async () => root.render(element));
  // Read a copy: the unmount below would empty the live tree. The copy gets a
  // document of its own, so `aria-labelledby` still resolves through
  // `getElementById` (a detached node's owner document cannot see its ids).
  const copy = document.implementation.createHTMLDocument("").body;
  copy.innerHTML = document.body.innerHTML;
  await act(async () => root.unmount());
  host.remove();
  // A floor: a portal that rendered nothing would read as a clean surface.
  if (copy.querySelector("[role=dialog] button") === null) {
    throw new Error("a mounted surface drew no dialog with a button in it");
  }
  return copy;
}

const SR = CANONICAL_SAMPLE_RATE;
const noRef = { current: null };
const toolbarProps = {
  mode: "record" as const,
  recording: false,
  recordRef: noRef,
  rerecordRef: noRef,
  rerecordDisabled: false,
  rerecordHint: null,
  recordInert: false,
  guidedRecord: false,
  isClosing: false,
  playingBuffer: false,
  dragging: false,
  idleEditable: true,
  playSource: "whole" as const,
  playDisabled: false,
  editToolbarDisabled: false,
  editToolbarHint: null,
  undoBlocked: null,
  redoBlocked: null,
  zoom: 1,
  windowControlsInert: false,
  onRecordButton: noop,
  onPlayButton: noop,
  onEnterEdit: noop,
  onAuditionButton: noop,
  onToggleZoom: noop,
  onUndo: noop,
  onRedo: noop,
  onExitEdit: noop,
  onRerecord: noop,
};
const recorderMenuProps = {
  open: true,
  onClose: noop,
  mode: "record" as const,
  ordinal: 3,
  finishedState: "empty" as const,
  markReason: null,
  eraseReason: null,
  onToggleFinished: noop,
  onErase: noop,
};
const libraryShare: UseLibraryShare = {
  status: "idle",
  error: null,
  sendUnconfirmed: false,
  missing: 0,
  incompleteChapters: 0,
  incompleteBooks: 0,
  progress: { phase: "hidden" },
  prepare: () => Promise.resolve(null),
  send: () => Promise.resolve("sent"),
  reset: noop,
  ownsScreen: () => false,
  dismissProgress: noop,
};

interface Surface {
  name: string;
  build: () => ReactElement[] | Promise<ReactElement[]>;
  /**
   * The surface portals to `document.body` (`Menu`, `EraseConfirm`), which
   * static markup cannot render. It is mounted with `react-dom/client` in the
   * file's jsdom window and the body is read instead. Still attributes, no
   * layout and no cascade.
   */
  mounted?: true;
  /** Rule 3 off, with the reason beside the entry. */
  labelInName?: false;
}

const STATUSES: ChapterRowStatus[] = [
  "rest",
  "loading",
  "playing",
  "paused",
  "failed",
];

const SURFACES: Surface[] = [
  {
    name: "Control",
    build: () => [
      createElement(Control, { icon: "retry", label: "Try again" }),
      createElement(Control, {
        icon: "retry",
        label: "Try again",
        caption: "Try again",
        pressed: false,
        busy: true,
      }),
      createElement(Control, {
        icon: "retry",
        label: "Try again",
        disabled: true,
        hint: { label: "Nothing to retry" },
      }),
    ],
  },
  {
    name: "SettingRow",
    build: () => [
      createElement(SettingRow, {
        icon: "hear",
        label: "Sound",
        on: true,
        onClick: noop,
      }),
      createElement(SettingRow, {
        icon: "hear",
        label: "Sound",
        on: false,
        onClick: noop,
      }),
      createElement(SettingRow, {
        icon: "hear",
        label: "Theme",
        onClick: noop,
      }),
    ],
  },
  {
    name: "TemplateList",
    build: async () => [
      createElement(TemplateList, {
        entries: [await loadObsTemplate()],
        base: "/",
        language: "en",
        busy: false,
        onPick: noop,
      }),
    ],
  },
  {
    name: "LicenceAsk",
    build: () => [
      createElement(LicenceAsk, {
        onContinue: noop,
        onCancel: noop,
        saving: false,
        error: null,
      }),
      createElement(LicenceAsk, {
        onContinue: noop,
        onCancel: noop,
        saving: false,
        error: null,
        change: { current: "CC-BY-4.0" },
      }),
    ],
  },
  {
    name: "O4BookDeleteAsk",
    build: () => [
      createElement(O4BookDeleteAsk, {
        name: "Mark",
        coverHex: "#2a9d8f",
        busy: false,
        keepRef: noop,
        onKeep: noop,
        onDelete: noop,
      }),
    ],
  },
  {
    name: "ChapterPlayControl",
    build: () => [
      ...STATUSES.map((status) =>
        createElement(ChapterPlayControl, {
          heading: "Chapter 1",
          recordedCount: 2,
          status,
          pausedFraction: status === "paused" ? 0.4 : null,
          onPress: noop,
          readProgress: () => null,
        })
      ),
      createElement(ChapterPlayControl, {
        heading: "Chapter 1",
        recordedCount: 0,
        status: "rest",
        pausedFraction: null,
        onPress: noop,
        readProgress: () => null,
      }),
    ],
  },
  {
    name: "CoverPicker",
    build: () => [
      createElement(CoverPicker, { selected: "teal", onSelect: noop }),
      createElement(CoverPicker, { selected: null, onSelect: noop }),
    ],
  },
  {
    name: "LanguageAsk",
    build: () => [
      createElement(LanguageAsk, {
        state: {
          kind: "ready",
          list: indexLanguageList({
            source: "SIL langtags test",
            languages: [
              ["en", "English"],
              ["fr", "French", "français"],
            ],
          }),
        },
        onRetry: noop,
        onPick: noop,
        onCancel: noop,
        saving: false,
        error: null,
      }),
    ],
  },

  {
    name: "SelectionOverlay",
    build: () => [
      createElement(SelectionOverlay, {
        win: {
          start: 0,
          end: SR * 10,
          visibleSamples: SR * 10,
          centerlineSample: SR * 5,
        },
        selection: { start: SR, end: SR * 4 },
        workingLength: SR * 10,
        onChange: noop,
        startLabel: strings.selectionStartHandle,
        endLabel: strings.selectionEndHandle,
        valueText: (s: number) =>
          strings.selectionHandleTime(framesToSpokenSeconds(s)),
      }),
    ],
  },
  {
    name: "ShareProgressPanel",
    build: () => [
      createElement(ShareProgressPanel, {
        role: "status",
        text: "Preparing the chapter to share",
        o4: {
          icon: "share",
          ring: 0.5,
          meter: { now: 50 },
          chips: [
            { state: "finished", label: 1 },
            { state: "current", label: 2 },
            { state: "stays", label: 3 },
          ],
        },
      }),
    ],
  },
  {
    name: "EraseConfirm",
    mounted: true,
    build: () => [
      createElement(EraseConfirm, {
        open: true,
        title: "Erase this segment?",
        confirmLabel: "Erase",
        cancelLabel: "Cancel",
        onConfirm: noop,
        onCancel: noop,
      }),
      createElement(EraseConfirm, {
        open: true,
        title: "Record again?",
        confirmLabel: "Record again",
        cancelLabel: "Cancel",
        glyph: "record",
        busy: true,
        onConfirm: noop,
        onCancel: noop,
        preview: {
          peaks: null,
          playing: false,
          onTogglePlay: noop,
          playLabel: "Play",
          pauseLabel: "Pause",
        },
      }),
    ],
  },
  {
    name: "SettingsPanel",
    mounted: true,
    build: () => [createElement(SettingsPanel, { open: true, onClose: noop })],
  },
  {
    name: "Menu",
    mounted: true,
    build: () => [
      createElement(
        Menu,
        { open: true, onClose: noop, hamburger: true },
        createElement("p", null, "Body")
      ),
      createElement(
        Menu,
        { open: true, onClose: noop, back: true },
        createElement("p", null, "Body")
      ),
    ],
  },
  {
    name: "O4BookMenu tiles",
    build: () => [
      createElement(
        TileGrid,
        null,
        // Not here: `LicenceTile`, whose Russian name drops its caption's
        // form (#1732). Left out of the entry, not skipped inside it.
        createElement(CoverTile, { coverHex: "#2a9d8f", onClick: noop })
      ),
      createElement(O4CoverPick, {
        selected: "teal",
        onSelect: noop,
        error: null,
      }),
    ],
  },
  {
    name: "O4TileMenu Tile",
    build: () => [
      createElement(
        TileGrid,
        null,
        createElement(Tile, {
          tone: "plain",
          icon: "retry",
          label: "Try again",
          caption: "Try again",
          onClick: noop,
        }),
        createElement(Tile, {
          tone: "plain",
          icon: "retry",
          label: "Try again",
          caption: "Try again",
          disabled: true,
          hint: { label: "Nothing to retry" },
          onClick: noop,
        })
      ),
    ],
  },
  {
    name: "RecorderMenu",
    mounted: true,
    build: () => [
      createElement(RecorderMenu, recorderMenuProps),
      createElement(RecorderMenu, {
        ...recorderMenuProps,
        mode: "edit",
        finishedState: "finished",
        markReason: "no-audio",
        eraseReason: "no-audio",
        bookName: "Mark",
        bookCoverHex: "#2a9d8f",
        chapterNumber: 2,
        chapterHeading: "Chapter 2",
        chapterName: "A long chapter name",
      }),
      // Not here: the `recording` variant, whose Stop tile name drops its
      // caption in Indonesian and Russian (#1732).
    ],
  },
  {
    name: "RecorderToolbar",
    build: () => [
      createElement(RecorderToolbar, toolbarProps),
      createElement(RecorderToolbar, { ...toolbarProps, recording: true }),
      createElement(RecorderToolbar, {
        ...toolbarProps,
        playSource: null,
        playDisabled: true,
        rerecordDisabled: true,
        rerecordHint: { label: "Nothing to erase" },
        editToolbarDisabled: true,
        editToolbarHint: { label: "Record first" },
      }),
      createElement(RecorderToolbar, { ...toolbarProps, mode: "edit" }),
      createElement(RecorderToolbar, {
        ...toolbarProps,
        mode: "edit",
        zoom: 4,
        playSource: "selection",
        undoBlocked: "nothing-to-undo",
        redoBlocked: "nothing-to-redo",
      }),
      createElement(RecorderToolbar, {
        ...toolbarProps,
        mode: "edit",
        playingBuffer: true,
        windowControlsInert: true,
      }),
    ],
  },
  {
    name: "PermissionPanel",
    build: () => [
      createElement(PermissionPanel, {
        message: null,
        onRetry: noop,
        onBack: noop,
      }),
      createElement(PermissionPanel, {
        message: "The microphone is off",
        onRetry: noop,
        onBack: noop,
        settingsPlatform: "ios-app",
      }),
      createElement(PermissionPanel, {
        message: "The microphone is off",
        onRetry: noop,
        onBack: noop,
        settingsPlatform: "android-app",
      }),
    ],
  },
  {
    name: "NameEdit",
    build: () => [
      createElement(NameEdit, {
        initialValue: "Mark",
        fieldLabel: "Book name",
        onSave: noop,
        onCancel: noop,
      }),
      createElement(NameEdit, {
        initialValue: "Mark",
        fieldLabel: "Book name",
        onSave: noop,
        onCancel: noop,
        busy: true,
        guided: true,
      }),
    ],
  },
  {
    name: "FailureLogPanel",
    mounted: true,
    build: () => [
      createElement(
        Menu,
        { open: true, onClose: noop, hamburger: true },
        createElement(FailureLogPanel, {
          count: 2,
          onDone: noop,
          onClearConfirmOpen: noop,
          onClearConfirmClose: noop,
        })
      ),
    ],
  },
  {
    name: "StoragePressureBanner",
    build: () => [
      createElement(StoragePressureBanner, {
        notice: { tone: "info", text: "Storage is getting full" },
        share: libraryShare,
      }),
      createElement(StoragePressureBanner, {
        notice: { tone: "alert", text: "Storage is almost full" },
        share: { ...libraryShare, status: "preparing" },
      }),
      createElement(StoragePressureBanner, {
        notice: { tone: "alert", text: "Storage is almost full" },
        share: { ...libraryShare, status: "ready", missing: 2 },
      }),
      createElement(StoragePressureBanner, {
        notice: { tone: "alert", text: "Storage is almost full" },
        share: { ...libraryShare, error: "failed" },
      }),
    ],
  },
];

afterAll(() => installLocale(SHIPPED_LOCALE));

describe("the gate itself, in both states", () => {
  it("is red on an empty name, a roleless label and a name that drops drawn text", () => {
    const bad = render(
      createElement("div", null, [
        createElement("button", { key: "a", type: "button" }),
        createElement("span", { key: "b", "aria-label": "Licence" }, "CC"),
        createElement(
          "button",
          { key: "c", type: "button", "aria-label": "Open" },
          "Open Bible Stories"
        ),
        createElement("div", {
          key: "d",
          role: "radio",
          "aria-checked": false,
        }),
      ])
    );
    expect(
      findings(bad)
        .map((f) => f.rule)
        .sort()
    ).toEqual([1, 1, 2, 3]);
  });

  it("is green on a labelled group, a named radio and a name that holds its text", () => {
    const good = render(
      createElement(
        "div",
        { role: "group", "aria-label": "Licence" },
        createElement(
          "button",
          { type: "button", "aria-label": "Open Bible Stories, licence" },
          "Open Bible Stories"
        ),
        createElement("div", {
          role: "radio",
          "aria-checked": true,
          "aria-label": "CC0",
        })
      )
    );
    expect(findings(good)).toEqual([]);
  });

  it("does not count screen-reader-only text as drawn", () => {
    const root = render(
      createElement(
        "button",
        { type: "button", "aria-label": "Keep" },
        createElement("span", { className: "sr-only" }, "Delete this book?"),
        "Keep"
      )
    );
    expect(findings(root)).toEqual([]);
  });

  it("names from exposed text: aria-hidden is not a name, sr-only text is", () => {
    const hiddenOnly = render(
      createElement(
        "button",
        { type: "button", "aria-label": "" },
        createElement("span", { "aria-hidden": "true" }, "Try again")
      )
    );
    expect(findings(hiddenOnly).map((f) => f.rule)).toEqual([1]);
    const srOnly = render(
      createElement(
        "button",
        { type: "button" },
        createElement("span", { className: "sr-only" }, "Delete")
      )
    );
    expect(findings(srOnly)).toEqual([]);
  });

  it('reads a native image: no alt is red, alt or alt="" or presentation is clean', () => {
    const img = (props: Record<string, string>) =>
      render(createElement("div", null, createElement("img", props)));
    expect(findings(img({ src: "a.png" })).map((f) => f.rule)).toEqual([1]);
    expect(findings(img({ src: "a.png", title: "Cover" }))).toEqual([]);
    expect(findings(img({ src: "a.png", alt: "" }))).toEqual([]);
    expect(findings(img({ src: "a.png", alt: "", title: "x" }))).toEqual([]);
    expect(findings(img({ src: "a.png", alt: "Cover" }))).toEqual([]);
    expect(findings(img({ src: "a.png", role: "presentation" }))).toEqual([]);
    expect(findings(img({ src: "a.png", role: "none" }))).toEqual([]);
  });

  it("resolves aria-labelledby in a mounted surface: a target names, a missing one is red", async () => {
    const probe = (target: string) =>
      createElement(
        Menu,
        { open: true, onClose: noop, hamburger: true },
        createElement("span", { id: "labelledby-probe" }, "Probe"),
        createElement("button", { type: "button", "aria-labelledby": target })
      );
    expect(findings(await mount(probe("labelledby-probe")))).toEqual([]);
    expect(
      findings(await mount(probe("labelledby-missing"))).map((f) => f.rule)
    ).toEqual([1]);
  });

  it("keeps a presentational role on a button under rules 1 and 3", () => {
    // Browsers ignore role="none" / "presentation" on a focusable button.
    const btn = (props: Record<string, string>, text: string) =>
      render(
        createElement(
          "div",
          null,
          createElement("button", { type: "button", ...props }, text)
        )
      );
    expect(findings(btn({ role: "none" }, "")).map((f) => f.rule)).toEqual([1]);
    expect(
      findings(btn({ role: "presentation" }, "")).map((f) => f.rule)
    ).toEqual([1]);
    expect(
      findings(
        btn({ role: "none", "aria-label": "Open" }, "Open Bible Stories")
      ).map((f) => f.rule)
    ).toEqual([3]);
    expect(
      findings(
        btn(
          { role: "none", "aria-label": "Open Bible Stories" },
          "Open Bible Stories"
        )
      )
    ).toEqual([]);
  });
});

describe("every surface the audit touched carries full accessible names", () => {
  for (const surface of SURFACES) {
    it(`${surface.name}, in English and every complete language`, async () => {
      const all: string[] = [];
      // An empty locale list would make `toEqual([])` below pass vacuously.
      expect(completeLocales().length).toBeGreaterThan(0);
      for (const locale of completeLocales()) {
        installLocale(locale);
        // Built after the install: a prop read from `strings` at build time
        // must come from the locale this iteration names.
        for (const element of await surface.build()) {
          const root = surface.mounted ? await mount(element) : render(element);
          for (const f of findings(root, surface.labelInName !== false)) {
            all.push(
              `${surface.name} [${locale.tag}] rule ${f.rule} ${f.site}: ${f.detail}`
            );
          }
        }
      }
      expect(all).toEqual([]);
    });
  }
});
