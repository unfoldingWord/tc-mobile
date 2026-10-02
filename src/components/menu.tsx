import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { useDesign } from "@/hooks/use-design";
import { cn } from "@/lib/utils";
import { Control } from "./control";
import { FOCUSABLE, wrapTab } from "./focus-trap";
import type { IconName } from "./icon";
import {
  sheetDragOffset,
  sheetDragRelease,
  sheetDragVelocity,
  type SheetDragSample,
} from "./sheet-drag";
import { strings } from "@/lib/strings";

/**
 * How long a released sheet takes to spring back, a little past the 160ms
 * transition in `o4/sheets.css`, after which the drag's inline offset and
 * state are removed. Under reduced motion there is no transition and the
 * sheet is already home; the cleanup is the same.
 */
const SHEET_SETTLE_MS = 200;

/**
 * A press that lands on a control in the header (the ✕) stays a tap and
 * never starts a drag.
 */
function startsOnControl(target: EventTarget): boolean {
  return (
    "closest" in target &&
    (target as Element).closest("button, input, a") !== null
  );
}

/**
 * How long after a drag closes a sheet its trailing click may still arrive.
 * Past this, the swallow below is removed unused, so it can never eat the
 * next real tap.
 */
const TRAILING_CLICK_MS = 400;

/**
 * A drag that closes a sheet ends in a `pointerup`, and the browser follows
 * it with a compatibility `click`. The sheet is already gone by then, so
 * that click would land on whatever it covered under the finger: a book on
 * Books, a row or a record control on Segments (#1273, George round 1).
 * This swallows that one click, in the capture phase on the document so no
 * target sees it, and removes itself on the first click or after
 * {@link TRAILING_CLICK_MS}, whichever comes first. Module scope, not the
 * component's: the Menu has unmounted by the time the click arrives. The ✕'s
 * own tap never arms it.
 */
function swallowTrailingClick(doc: Document): void {
  const swallow = (ev: Event) => {
    ev.preventDefault();
    ev.stopPropagation();
    disarm();
  };
  const timer = setTimeout(() => {
    doc.removeEventListener("click", swallow, true);
  }, TRAILING_CLICK_MS);
  const disarm = () => {
    clearTimeout(timer);
    doc.removeEventListener("click", swallow, true);
  };
  doc.addEventListener("click", swallow, true);
}

/** A drag in progress, one pointer at a time. */
interface SheetDrag {
  readonly pointerId: number;
  readonly startY: number;
  readonly sheetHeight: number;
  last: SheetDragSample;
  velocity: number;
}

interface MenuProps {
  open: boolean;
  onClose: () => void;
  /**
   * Panel heading, announced by a screen reader. Defaults to the global menu's
   * title; the recorder opens the same surface with its own title (Edit, Mark
   * finished and Erase in B6).
   */
  title?: string;
  /**
   * Accessible name of the header's dismiss control. Defaults to "Close menu",
   * which is what this panel is on every menu — but not on the New Book dialog
   * (#314), where it is the "create nothing" exit and a screen-reader user would
   * otherwise be told a naming dialog closes a menu (George R2 P3-4).
   */
  closeLabel?: string;
  /**
   * When this changes, the open-edge focus lands again. The About panel (#36)
   * swaps the drawer body between its list and an in-drawer licence text, and
   * each swap must re-place focus inside the still-open dialog rather than leave
   * it orphaned on a control that just unmounted. Defaults undefined, so a menu
   * that never swaps its body focuses once on open as before.
   */
  focusKey?: string | number;
  /**
   * The panel shows no visible title, and the dismiss control sits alone in
   * the top-right corner. In the current look that control wears the glyph
   * `dismissIcon` names — one glyph, one place, and the glyph is the label;
   * under O4 it is the ✕ every sheet closes with (#1268, the `back` docblock
   * below), whatever `dismissIcon` says. Which glyph is `dismissIcon`'s call: `menu` (≡,
   * the default) for the global menu (#608), where it is also the glyph of
   * the control that opened it; `more` (⋮) for an object's menu that opts in.
   * The recorder's overflow drawer opts in (#621, the requirements owner's
   * call on that panel): its "More" heading said nothing the glyph did not,
   * and a left-pointing chevron reads as "move left" on a drawer that docks
   * on the RIGHT. Since #1225 that drawer acts on the segment being edited,
   * so it is an object menu: both of its openers are ⋮ and its dismiss
   * passes `dismissIcon="more"` to match, which leaves the Books screen's
   * global menu as the only ≡. Off (the default) the header is a title
   * beside the dismiss control — a back chevron in the current look, the ✕
   * under O4 — which every other menu keeps: the book, chapter and segment
   * menus (opened from a ⋮ since #589) and the New Book dialog.
   * What a screen reader hears does not change either way: `title` still
   * names the dialog and `closeLabel` still names the control ("Close menu"
   * dismisses, as before), which is also what the e2e specs locate the menu
   * by.
   */
  hamburger?: boolean;
  /**
   * The glyph `hamburger` paints on the dismiss control. Read only when
   * `hamburger` is on; the back chevron of the default header is not
   * configurable. Defaults to `menu` (≡), the global menu's glyph.
   */
  dismissIcon?: "menu" | "more";
  /**
   * The header control steps BACK one level inside this panel rather than
   * closing it, so it keeps the back chevron in both looks. About's licence
   * view is the one caller (#36): its control is "Back to the list".
   *
   * Everywhere else, the O4 look draws the header control as ✕ (#1268, the
   * requirements owner: "Can we use a standard close button (some form of
   * X)?"), whatever `hamburger` and `dismissIcon` say: one closer, in the
   * same top-right place, on every sheet. Its name is still `closeLabel`
   * ("Close menu" by default). The current look keeps the chevron, ≡ and ⋮
   * described above.
   */
  back?: boolean;
  /**
   * When true, the header AND every child — Close included — go `inert`:
   * unfocusable, unclickable, and excluded from the accessibility tree as
   * one subtree (#491, the DRI's class-level pick on the judgment sheet,
   * issuecomment-5739827376 / issuecomment-5741730440).
   *
   * Four review rounds each found a different live control reachable in the
   * Segments/Books ≡ menu while the share-progress overlay was showing on
   * top of it — the menu close, then Rename/Delete, then the Share control
   * itself (Frank at `ec2a148`) — because each round guarded only the
   * control it was shown. This prop is the one primitive that covers all of
   * them, INCLUDING any future control this menu grows, without a
   * per-handler list to keep in sync: a caller sets it from
   * `shareOverlayOwnsScreen(progress)` and every per-handler
   * `shareOverlayOwnsScreen` guard those controls carried becomes provably
   * redundant, not merely `undefined` for the default case.
   */
  inert?: boolean;
  /**
   * Rendered inside the panel — inside its `aria-modal` boundary — but
   * OUTSIDE the `inert` subtree above, so it keeps reaching assistive
   * technology even while `inert` is true. `inert` removes its whole
   * subtree from the accessibility tree (not just from focus), so a live
   * region nested inside the inert header/children would go silent exactly
   * when `inert` is true — the one time #491's outcome text needs it.
   * `ShareProgress` itself is a SIBLING portal, not a descendant of this
   * `aria-modal` dialog, so it cannot carry this region either (George r1
   * P2 #3's original finding). Absent for every other caller.
   */
  liveRegion?: React.ReactNode;
  /**
   * The menu's contents.
   *
   * Never empty on the global menu any more: Books always mounts the About &
   * licenses entry (#36), the theme toggle (#171) and the design control
   * (#938), and ahead of them `FailureLogPanel` while the failure log has
   * rows (#205) — that panel is deliberately absent on a phone that has never
   * failed, so a quiet phone's menu holds About, the toggle and the design
   * control. The empty case still exists for
   * callers that pass nothing, but it is no longer the global menu's normal
   * state. Template Library (B7, #33) is the other consumer still to come.
   */
  children?: React.ReactNode;
}

/**
 * The global menu, opened from the hamburger.
 *
 * The surface, not the entries: a scrim, a focus trap, close on Escape or a
 * scrim tap, and a heading a screen reader announces. Every entry arrives as
 * `children` — the row menus' actions, and on the global menu the failure log's
 * Send and Clear (#205) whenever there is something to send.
 *
 * One consequence of holding real children now: a child may portal a dialog of
 * its own OVER this panel rather than closing it first (`FailureLogPanel`'s
 * Clear confirm does). `EraseConfirm` captures Escape and marks it handled for
 * that reason, and the `defaultPrevented` check below is what honours it — the
 * same contract the rename field already relied on.
 *
 * A caller can also go further and cede the whole panel — see `inert` and
 * `liveRegion` above — to a DIFFERENT overlay that has taken over the screen
 * without unmounting this one (#491's share-progress modal is the first
 * caller; every other caller leaves both props unset).
 */
export function Menu({
  open,
  onClose,
  title = strings.menuTitle,
  closeLabel = strings.menuClose,
  focusKey,
  hamburger = false,
  dismissIcon = "menu",
  back = false,
  inert,
  liveRegion,
  children,
}: MenuProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  // The header (title + Close). Held so the open-edge focus can skip past it to
  // the first real action rather than landing on the dismiss control.
  const headerRef = useRef<HTMLDivElement | null>(null);
  // Read `onClose` from the keydown listener without re-subscribing it. Both B6
  // consumers pass an inline `onClose` and open the menu over a TICKING parent —
  // the recorder menu is now live mid-take (elapsedMs every 100 ms) and the row
  // menu sits on a list that repaints every 60 ms during playback. Keying the
  // effect on `onClose` would re-run it — and re-grab focus — on every tick,
  // yanking a keyboard user off the entry they were on (George R-B6, the same
  // defect EraseConfirm already fixed). A ref keeps the handler current without
  // that churn, so the effect binds once per open.
  // `useLayoutEffect`, not `useEffect` (#517 item 2, George r3 P3 on #508):
  // #491 made this ref load-bearing for a share overlay's menu — while the
  // overlay owns the screen, `onCloseChapterMenu`/`onCloseShareMenu` (read
  // through this ref by the Escape handler below) must see the LIVE
  // `shareOverlayOwnsScreen(progress)` and refuse to close, mirroring the
  // `busyRef`/`onCancelRef`/`onDismissRef` fix `share-progress.tsx` already
  // carries for the identical shape (Frank at `9832a8b` P2, #491). React does
  // not guarantee that a passive effect runs before the browser paints or
  // before a queued event is handled, so a keydown in that window — a fast
  // Escape right after the
  // overlay opens or closes in the same commit that changed what `onClose`
  // would do — can fire against a STALE ref. `share-progress.tsx`'s own
  // capture-phase Escape listener is expected to swallow the keydown before
  // this one sees it, so this is the second-failure window (that listener
  // not yet bound, and a stale `onCloseRef` at once) rather than an observed
  // defect. A layout effect runs synchronously right after the DOM
  // mutation, before paint or any queued event, so the ref is current by the
  // time anything could react to what just rendered.
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  const { design } = useDesign();
  const o4 = design === "o4";
  const dismissGlyph: IconName = back
    ? "back"
    : o4
      ? "close"
      : hamburger
        ? dismissIcon
        : "back";

  // DRAG DOWN TO CLOSE (#1268, the requirements owner: "it should work as
  // drag down to close"). O4 only, and only where the grip is drawn: a
  // bottom sheet, which `o4/sheets.css` keys on what the panel holds. The
  // side drawer (About) draws none, so a press there never starts a drag.
  //
  // WHERE A DRAG STARTS: the grip and the header row, never the body. The
  // body is where a sheet scrolls (the recorder sheet is capped at half the
  // screen and scrolls past that) and where its tiles are, so a drag there
  // would fight both. The header holds no scrolling content, and a press on
  // a button in it (the ✕) stays a tap. Both carry `touch-action: none` in
  // `o4/sheets.css`, so the browser does not claim the finger for a pan and
  // cancel the drag.
  //
  // The sheet follows the finger through `--sheet-drag-y` on the panel, set
  // here rather than through state so a move re-renders nothing. A release
  // that closes calls `onClose`, the same function the ✕, Escape and the
  // scrim call, so focus return and the caller's state reset are the
  // caller's, unchanged. Every release springs the sheet back first, so a
  // caller that refuses the close leaves the sheet where it was.
  const gripRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<SheetDrag | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    },
    []
  );

  const settle = () => {
    const panel = panelRef.current;
    if (!panel) return;
    panel.setAttribute("data-sheet-drag", "settling");
    panel.style.setProperty("--sheet-drag-y", "0px");
    if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      settleTimer.current = null;
      panel.removeAttribute("data-sheet-drag");
      panel.style.removeProperty("--sheet-drag-y");
    }, SHEET_SETTLE_MS);
  };

  const onDragStart = (e: React.PointerEvent<HTMLElement>) => {
    const panel = panelRef.current;
    const grip = gripRef.current;
    if (!panel || !grip || dragRef.current) return;
    if (!e.isPrimary || e.button !== 0) return;
    if (startsOnControl(e.target)) return;
    if (window.getComputedStyle(grip).display === "none") return;
    if (settleTimer.current !== null) {
      clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }
    dragRef.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      sheetHeight: panel.getBoundingClientRect().height,
      last: { y: e.clientY, t: e.timeStamp },
      velocity: 0,
    };
    panel.setAttribute("data-sheet-drag", "dragging");
    panel.style.setProperty("--sheet-drag-y", "0px");
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onDragMove = (e: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const sample = { y: e.clientY, t: e.timeStamp };
    drag.velocity = sheetDragVelocity(drag.last, sample, drag.velocity);
    drag.last = sample;
    panelRef.current?.style.setProperty(
      "--sheet-drag-y",
      `${sheetDragOffset(drag.startY, e.clientY)}px`
    );
  };

  const onDragEnd = (e: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    const outcome = sheetDragRelease({
      offset: sheetDragOffset(drag.startY, e.clientY),
      velocity: drag.velocity,
      lastMoveAt: drag.last.t,
      releasedAt: e.timeStamp,
      sheetHeight: drag.sheetHeight,
    });
    settle();
    if (outcome === "close") {
      swallowTrailingClick(e.currentTarget.ownerDocument);
      onClose();
    }
  };

  const onDragCancel = (e: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    settle();
  };

  // Bound in both looks; the current look renders no grip, and a press
  // without a grip on screen never starts a drag (`onDragStart`).
  const dragHandlers = {
    onPointerDown: onDragStart,
    onPointerMove: onDragMove,
    onPointerUp: onDragEnd,
    onPointerCancel: onDragCancel,
    onLostPointerCapture: onDragCancel,
  };

  // Land focus inside the panel ONCE on the open edge — first ENABLED control,
  // never a disabled one (focusing it is a no-op that strands the user behind
  // the scrim — Frank R-B6) — and not again on every parent render.
  //
  // Skip the header's Close to land on the first ACTION: a menu that opens with
  // focus on its dismiss control invites an immediate close, and a one-action
  // menu (Share chapter, B7) makes that the wrong first target (George R-B7).
  // Fall back to the panel's first focusable, which is Close on an empty menu.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = Array.from(
      panel.querySelectorAll<HTMLElement>(FOCUSABLE)
    );
    // Hinted rows are `aria-disabled`, not natively disabled (#135), so they now
    // MATCH `FOCUSABLE` and hold their place in the Tab order — which is the
    // point: that is how a keyboard or switch user hears the reason. They are
    // still the wrong place to LAND on open, so the open-edge focus skips them
    // and falls back only if the menu holds nothing actionable.
    const actionable = focusables.filter(
      (el) => el.getAttribute("aria-disabled") !== "true"
    );
    const target =
      actionable.find((el) => !headerRef.current?.contains(el)) ??
      focusables.find((el) => !headerRef.current?.contains(el)) ??
      focusables[0];
    target?.focus();
    // `focusKey` re-lands focus when the caller swaps the body under a still-open
    // menu (#36): the previous target may have unmounted, so re-run the landing.
  }, [open, focusKey]);

  // The focus trap + Escape, bound once per open; reads `onClose` via the ref.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // A child already handled this Escape (the rename field calls
        // preventDefault on its own Cancel — G1). Honour it: closing the whole
        // menu here would double-fire and drop an armed share via share.reset().
        // This reads a flag on the one shared native event, so it holds no matter
        // how React delegates the portalled field's synthetic event.
        if (e.defaultPrevented) return;
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      // Keep Tab inside the panel: with nothing behind it reachable, focus
      // wrapping is what makes the scrim a real boundary and not just paint.
      wrapTab(panel, e);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Gone on the render `open` drops, with no exit motion. Every caller drops
  // its own layer, Back ownership and overlay flags in `onClose`, and some
  // replace the drawer in that same render, so a drawer kept mounted to slide
  // out broke four callers (#621, PR 656). Any drawer motion, in or out,
  // needs a contract with the callers first; that is #706, not a change here.
  if (!open) return null;

  // Portalled to <body>, out of the caller's subtree. A caller that goes `inert`
  // to hide its own background from AT (the Segments list does this while a
  // dialog is up) must not thereby inert the open menu itself — which it would
  // if the menu rendered inline inside it. The scrim is `position: fixed`, so
  // the DOM parent never mattered for layout. (Frank/George R-B6.)
  return createPortal(
    <div
      className="menu-scrim"
      // A tap on the scrim, but not on the panel, closes.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="menu-panel"
      >
        {liveRegion}
        {/* `display: contents` (Tailwind `contents`): this node carries
            `inert` without owning a box of its own, so the header and
            `children` stay direct flex items of `.menu-panel` above —
            `inert` changes reachability, never layout. */}
        <div className="contents" inert={inert || undefined}>
          {/* The O4 grip (#1268): drawn, and a place to start dragging the
              sheet down, but not a control. It is `aria-hidden` and takes no
              focus; the ✕ below is the accessible close. Inside the `inert`
              subtree, so a sheet another overlay owns cannot be dragged
              away either. */}
          {o4 && (
            <div
              ref={gripRef}
              className="menu-grip"
              aria-hidden="true"
              {...dragHandlers}
            />
          )}
          {/* `justify-end` when the title is dropped keeps the one remaining
              child — the dismiss control — in the top-right corner, where the
              opener of this panel was; `justify-between` alone would slide
              it to the left edge as the header's only flex item. */}
          <div
            ref={headerRef}
            className={cn(
              "menu-head flex items-center",
              hamburger ? "justify-end" : "justify-between"
            )}
            {...dragHandlers}
          >
            {!hamburger && <span className="t-title">{title}</span>}
            <Control
              icon={dismissGlyph}
              label={closeLabel}
              variant="quiet"
              onClick={onClose}
            />
          </div>
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
