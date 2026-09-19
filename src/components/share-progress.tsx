import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { Icon } from "./icon";
import { noticePresentation } from "./notice-tone";
import { shareProgressText } from "./share-error-copy";
import { shareSettledGlyph } from "./share-outcome-glyph";
import type { ShareProgress as ShareProgressState } from "@/hooks/share-progress";

interface ShareProgressProps {
  /** The hook's timeline. Renders nothing while `hidden`. */
  progress: ShareProgressState;
  /** Picks the secondary text only — the glyphs are the same for both. */
  scope: "chapter" | "book";
  /**
   * A scrim tap, or the Escape this component now captures, while BUSY.
   * Wired to `reset()` itself (George r1 P2 #1/#2), not the screen's full
   * menu close: `reset()` already refuses to run while `handoff.sending`
   * (this lane's own prior round), so during SEND this is the "swallowed"
   * half of the Escape contract below — but during PREPARE it genuinely
   * cancels the encode, which a translator still needs a pointer OR a
   * keyboard cancel for on a long book. Wiring this to the screen's menu
   * close instead (the previous shape) was itself George r1's finding: that
   * close now refuses to run at all while this overlay is up, so it can no
   * longer be what a busy-phase cancel goes through.
   */
  onCancel: () => void;
  /** A tap anywhere, or the Escape this component now captures, while an
   *  OUTCOME is showing: end the flash early. */
  onDismiss: () => void;
}

/**
 * The share modal (#491): one large glyph over a scrim while a share is
 * prepared and handed over, then one outcome glyph — handed to the sheet,
 * dismissed, nothing to share, failed — for a moment, then gone.
 *
 * A share that succeeded on the Android APK looked exactly like one the
 * translator had dismissed (#336's 2026-09-17 report). The busy state was a
 * line of text in the menu and the outcome was absent; for a person who may
 * not read that is the worst of both. This is the state-in-place answer: the
 * glyph is the signal, the line under it is secondary, and the timing — the
 * minimum busy hold, the outcome hold — is the hook's, provable in Node
 * (`hooks/share-progress.ts`), not this component's.
 *
 * Presentational only. Rendered by each screen as a SIBLING of its `Menu`,
 * portalled to `<body>` like `EraseConfirm`, so it survives the menu closing
 * and sits above it (z 90 over the menu's 80; the two are never up together
 * with the confirm, which the screens close the menu before arming, and now
 * also refuse to arm at all while this overlay is up — see
 * `shareOverlayOwnsScreen`).
 *
 * Not a dialog — `role` still comes from the tone table (`status` for a wait
 * or a heads-up, `alert` for a failure) and never from the caller, the same
 * rule `Notice` states, and it stays out of the caller's `aria-modal`
 * `Menu`. But it DOES now own the keyboard while visible (George r1 P2 #1/#2,
 * #491): the menu behind it stays mounted for the reasons `onCancel` above
 * gives, and with no pointer able to reach it (the scrim is `position:
 * fixed`, `z-index: 90` over the menu's 80) a keyboard/switch user's Tab was
 * the one path still reaching it — landing on the book menu's Rename or
 * Delete during the outcome hold, arming a destructive confirm under a glyph
 * that says the book was just shared. So this component grabs focus onto
 * itself on the hidden→visible edge (there is nothing else IN it to focus —
 * `tabIndex={-1}`, the same "focus a non-interactive node" shape
 * `error-boundary.tsx`'s crash heading already uses) and, in a CAPTURE-phase
 * `window` listener, both `preventDefault` AND `stopPropagation` every Tab
 * and Escape while it is up. `stopPropagation` is the part `EraseConfirm`'s
 * own capture handler does not need and this one does: `menu.tsx`'s Tab-wrap
 * does not consult `defaultPrevented` at all (only its Escape handler does),
 * so without stopping propagation Menu's own bubble-phase listener would
 * still run afterward and wrap focus back into Rename/Delete regardless.
 * Escape mirrors the click handler's own busy/outcome split below rather
 * than being a bare no-op, so keyboard and pointer agree: `onCancel` while
 * busy is the same "swallowed during send, genuine during prepare" contract
 * the prop doc gives, `onDismiss` while an outcome is showing ends the flash
 * early the same as a tap.
 *
 * This still does not fully close the gap alone: a screen reader's own
 * gesture navigation (a VoiceOver/TalkBack swipe or rotor move) does not
 * dispatch a `Tab` `KeyboardEvent` at all, so it is `listInert`/the shelf's
 * `inert` and the book menu's guarded Rename/Delete — not this — that keep
 * THAT path from reaching the menu underneath. All three derive from the one
 * `shareOverlayOwnsScreen` predicate for that reason.
 */
export function ShareProgress({
  progress,
  scope,
  onCancel,
  onDismiss,
}: ShareProgressProps) {
  const visible = progress.phase !== "hidden";
  const busy = progress.phase === "busy";
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Read from the keydown listener without re-subscribing it — mirrors
  // `EraseConfirm`: the listener binds once per hidden→visible edge (below),
  // so a parent re-render (the recorder's own 60 ms playback tick is the
  // documented case elsewhere in this repo) never re-attaches it or re-grabs
  // focus mid-flow.
  const busyRef = useRef(busy);
  const onCancelRef = useRef(onCancel);
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    busyRef.current = busy;
    onCancelRef.current = onCancel;
    onDismissRef.current = onDismiss;
  });

  // Land focus on the panel itself on the hidden→visible edge — the only
  // thing here TO focus, since this overlay carries no controls.
  useEffect(() => {
    if (visible) panelRef.current?.focus();
  }, [visible]);

  // The isolation fix itself (George r1 P2 #1/#2): see the docblock above for
  // why CAPTURE and `stopPropagation`, both, are required.
  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (busyRef.current) onCancelRef.current();
        else onDismissRef.current();
        return;
      }
      if (e.key === "Tab") {
        // No interior to wrap Tab between — freezing it is the correct
        // degenerate case of "keep Tab inside the panel" for a panel with no
        // focusable content of its own.
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [visible]);

  if (progress.phase === "hidden") return null;
  // The wait wears the same retry mark `Notice`'s `busy` tone does, spun by
  // the stylesheet; an outcome wears the table's mark for it.
  const glyph = busy
    ? { icon: noticePresentation("busy").icon, tone: "busy" as const }
    : shareSettledGlyph(progress.settled);
  const { role } = noticePresentation(glyph.tone);
  // The stylesheet keys the glyph's ink on this, not on the tone: success is
  // `--s-done`, not the `info` tone's amber.
  const outcome = busy ? "busy" : progress.settled;
  return createPortal(
    <div
      className="share-scrim"
      data-outcome={outcome}
      onClick={(e) => {
        // While busy only the scrim cancels — a tap on the panel itself is not
        // read as "stop the encode". An outcome clears on a tap anywhere.
        if (busy) {
          if (e.target === e.currentTarget) onCancel();
        } else onDismiss();
      }}
    >
      <div ref={panelRef} tabIndex={-1} role={role} className="share-progress">
        <Icon name={glyph.icon} size={48} className="share-progress-glyph" />
        <span className="share-progress-text">
          {shareProgressText(progress, scope)}
        </span>
      </div>
    </div>,
    document.body
  );
}
