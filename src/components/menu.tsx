import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";
import { Control } from "./control";
import { FOCUSABLE, wrapTab } from "./focus-trap";
import { strings } from "./strings";

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
   * The header's dismiss control wears the `menu` glyph (≡), in the top-right
   * corner, and the panel shows no visible title — one glyph, one place, and
   * the glyph is the label. For the global menu (#608) that is also the glyph
   * of the control that opened it — both are ≡, top-right, always. The
   * recorder's overflow drawer opts in too (#621, the requirements owner's
   * call on that panel): its "More" heading said nothing the ≡ did not, and a
   * left-pointing chevron reads as "move left" on a drawer that docks on the
   * RIGHT. Since #863 the recorder's two openers no longer match: record
   * mode's header opener is ≡, but the edit toolbar's opener is ⋮ (the same
   * kebab #589/#683 gave the object menus) — the drawer's OWN dismiss stays ≡
   * regardless of which one opened it, because ≡ is used only at the top
   * right (#608) and the drawer's header is the only top-right control
   * showing while it is open. Off (the default) the header is a title beside
   * a back chevron, which every other menu keeps — the book, chapter and
   * segment menus (opened from a ⋮ since #589) and the New Book dialog. What
   * a screen reader hears does not change either way: `title` still names the
   * dialog and `closeLabel` still names the control ("Close menu" dismisses,
   * as before), which is also what the e2e specs locate the menu by.
   */
  hamburger?: boolean;
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
   * Never empty on the global menu any more: Books always mounts the theme
   * toggle here (#171), and ahead of it `FailureLogPanel` while the failure
   * log has rows (#205) — that panel is deliberately absent on a phone that
   * has never failed, so a quiet phone's menu holds the toggle alone. The
   * empty case still exists for callers that pass nothing, but it is no
   * longer the global menu's normal state. Template Library (B7, #33) is the
   * other consumer still to come.
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
  hamburger = false,
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
  }, [open]);

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
          {/* `justify-end` when the title is dropped keeps the one remaining
              child — the dismiss control — in the top-right corner, where the
              ≡ that opened this panel was; `justify-between` alone would slide
              it to the left edge as the header's only flex item. */}
          <div
            ref={headerRef}
            className={cn(
              "flex items-center",
              hamburger ? "justify-end" : "justify-between"
            )}
          >
            {!hamburger && <span className="t-title">{title}</span>}
            <Control
              icon={hamburger ? "menu" : "back"}
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
