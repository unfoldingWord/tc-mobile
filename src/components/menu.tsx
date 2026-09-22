import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";
import { Control } from "./control";
import { strings } from "./strings";

/**
 * Focusable controls inside the panel — NATIVELY disabled ones excluded on
 * purpose; `aria-disabled` ones deliberately kept.
 *
 * A natively disabled button can never be `document.activeElement`, so it must
 * be skipped for BOTH the initial focus (landing on it focuses nothing,
 * stranding the user behind the scrim) and the Tab-wrap boundary (a disabled
 * `last` never turns the wrap). The recorder menu's Erase is disabled at
 * idle/no-clip while Edit stays live (it commits then edits a live/paused
 * take, #134), which is exactly when a single shared selector matters. Mirrors
 * EraseConfirm.
 *
 * A row carrying a hint (#135) is `aria-disabled` instead, and so MATCHES this
 * selector by design: it is focusable, announces its reason, and holds its place
 * in the Tab order. Only the open-edge landing filters those out — see the
 * `actionable` list below, which is the other half of this rule.
 */
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Every `Menu` currently in its exit motion, by the callback that ends the
 * motion early (#621, fix class C1 on PR 656).
 *
 * A dismissed drawer stays mounted while it slides out, and Books alone
 * renders three `Menu`s — so a tap that closes one and opens another inside
 * that window (Create book, then a row's ≡) would otherwise leave two drawers
 * on screen at once. The rule is one drawer whenever any drawer is open, and
 * it has two halves because the two events can land in either order: the
 * opening instance ends every other instance's exit on its open edge, and an
 * instance dismissed while a sibling is ALREADY open skips its exit entirely
 * (Create book resolves its write and closes the dialog after the new row —
 * and its ≡ — is already on the shelf, so the row menu can be open first).
 * No locator that finds a menu by role or class, and no assistive technology,
 * sees two. Module-scoped because the instances share no parent — each caller
 * mounts its own `<Menu>`.
 */
const openMenus = new Set<symbol>();
const exitingMenus = new Set<() => void>();

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
   * Opened by a ≡ that stays a ≡ (#608). The header's dismiss control wears
   * the same `menu` glyph as the control that opened it, in the same top-right
   * corner, and the panel shows no visible title — one control, one glyph, one
   * place, and the glyph is the label. The recorder's overflow drawer wears
   * it too (#621, the requirements owner's call on that panel): its "More"
   * heading said nothing the ≡ did not, and a left-pointing chevron reads as
   * "move left" on a drawer that slides back to the RIGHT (see the exit motion
   * below). Off (the default) the header is a title beside a back chevron,
   * which the per-row ≡ menus and the New Book dialog deliberately keep: #589
   * owns their affordances, and this prop must not pre-empt that pick. What a
   * screen reader hears does not change either way: `title` still names the
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
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Mounted for one exit motion after `open` drops (#621): the drawer slides
  // back off the right edge it came in from instead of vanishing on the frame
  // it is dismissed. Adjusted during render — the pattern React documents for
  // deriving state from a changed input, and the one this repo's ESLint leaves
  // open (`setState` inside an effect is refused as a cascading render;
  // `recorder.tsx`'s `prevDenied` is the precedent). Reopening mid-exit is
  // just `open` changing again, so it cancels the exit by the same line.
  const [self] = useState(() => Symbol("menu"));
  const [prevOpen, setPrevOpen] = useState(open);
  const [exiting, setExiting] = useState(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    // No exit motion when a SIBLING drawer is already open (`openMenus`
    // above; this instance is still counted there until its own effect
    // cleans up, hence the `!== self`): decided HERE, in the same render that
    // sees `open` drop, so no commit ever holds two drawers — an effect would
    // let one frame through, and a locator's strict check lands in exactly
    // that frame.
    const siblingOpen = [...openMenus].some((id) => id !== self);
    setExiting(!open && !siblingOpen);
  }

  // Unmount when the exit motion settles — and what "settles" means is the
  // stylesheet's call, not this file's. `getAnimations` returns whatever
  // `.menu-scrim[data-closing]` is animating (the panel's slide and the
  // scrim's fade, `3-components.css`), and their `finished` promises end the
  // exit together. Under `prefers-reduced-motion` the stylesheet sets
  // `animation: none`, the list is empty, and the drawer is gone on the next
  // microtask: reduced motion is honoured by this same path, not a second
  // one, and no duration is written here, so the `--p-dur-*` token stays the
  // only clock. jsdom has no Web Animations API; the optional call gives it
  // the same "nothing to wait for" answer. `finished` REJECTS when an
  // animation is cancelled mid-run (its element restyled or removed), which
  // `allSettled` treats as done too — so nothing here can strand a closed
  // drawer on screen.
  //
  // The motion also ends EARLY when a sibling `Menu` opens mid-exit: `finish`
  // stays registered in `exitingMenus` for as long as this instance is
  // exiting, and the sibling's open edge calls it (below). Both paths end in
  // the same `setExiting(false)`, so there is one unmount, not two. (The
  // other order — a sibling ALREADY open when this one is dismissed — never
  // starts the motion at all; see the render adjustment above.)
  //
  // LAYOUT effects, both of them, on purpose: a `setState` from a layout
  // effect re-renders synchronously, inside the same commit and before the
  // browser paints, so the sibling's open edge removes this drawer in the
  // very task that opened the sibling. From a passive effect the removal
  // landed one frame later, and that frame is where a locator's strict check
  // found two drawers (PR 656 CI; measured at ~9 ms in a Chromium probe).
  const scrimRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!exiting) return;
    const finish = () => setExiting(false);
    exitingMenus.add(finish);
    const running = scrimRef.current?.getAnimations?.({ subtree: true }) ?? [];
    let cancelled = false;
    void Promise.allSettled(running.map((a) => a.finished)).then(() => {
      if (!cancelled) finish();
    });
    return () => {
      cancelled = true;
      exitingMenus.delete(finish);
    };
  }, [exiting]);

  // While open, this instance is counted in `openMenus`, and its open edge
  // ends every other drawer's exit at once (#621 C1). Its own `finish` is
  // never in the set here: reopening mid-exit clears `exiting` in the render
  // adjustment above, and that effect's cleanup has already removed it by the
  // time this one runs.
  useLayoutEffect(() => {
    if (!open) return;
    openMenus.add(self);
    for (const finish of exitingMenus) finish();
    return () => {
      openMenus.delete(self);
    };
  }, [open, self]);

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
      const focusable = panel.querySelectorAll<HTMLElement>(FOCUSABLE);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!open && !exiting) return null;

  // Portalled to <body>, out of the caller's subtree. A caller that goes `inert`
  // to hide its own background from AT (the Segments list does this while a
  // dialog is up) must not thereby inert the open menu itself — which it would
  // if the menu rendered inline inside it. The scrim is `position: fixed`, so
  // the DOM parent never mattered for layout. (Frank/George R-B6.)
  return createPortal(
    <div
      ref={scrimRef}
      className="menu-scrim"
      // On the way out the drawer is paint only (#621): `inert` takes it out
      // of reach and out of the accessibility tree the instant it is
      // dismissed — the exit is something to see, never something to tap or
      // hear — and `data-closing` is what the stylesheet keys the motion on.
      inert={exiting || undefined}
      data-closing={exiting || undefined}
      // A tap on the scrim, but not on the panel, closes.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        // While exiting, the panel is paint and nothing else: hidden from the
        // accessibility tree and no longer modal the instant it is dismissed,
        // so a role query — Playwright's or a screen reader's — finds only the
        // drawer that is actually open (#621 C1). `inert` on the scrim above
        // did not do that on its own: a role query still resolved the inert
        // panel, which is the fact PR 656's CI failures established.
        // `aria-hidden` is the ARIA-defined "not there", which both honour.
        aria-hidden={exiting || undefined}
        aria-modal={exiting ? undefined : "true"}
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
