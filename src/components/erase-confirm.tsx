import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

import { wrapTab } from "./focus-trap";
import { createPortal } from "react-dom";

import { Control } from "./control";
import { Icon } from "./icon";
import { Waveform } from "./waveform";
import type { Peaks } from "@/types/audio";

/**
 * The confirm's "Play what will be lost" row (#979, the O4 13/G5 remainder
 * after #1022): the workbench's `vConfirm()` draws a `.prev` row between the
 * title and the two buttons — a waveform and a Play/Pause transport for the
 * take about to be erased. Optional, and rendered only when the caller passes
 * it, so a caller that does not — the book Delete, the failure log's Clear,
 * and (for now) the recorder's own record-again call site — gets the same
 * markup as before (see `EraseConfirmProps.preview`'s own docblock for why
 * that last one is not wired yet).
 *
 * Presentational, like every other prop here: the caller owns the actual
 * playback (`SegmentsAudio.playTake`/`playingId`/`playbackElapsedMs` in
 * `segments-screen.tsx`), and hands this component only what to draw and one
 * callback to toggle it. No audio API is touched from this file.
 */
export interface EraseConfirmPreview {
  /** Peaks for the take about to be lost, or `null` for a never-recorded
   *  segment — the confirm dialog is never opened for one, so this is
   *  defensive, not a real path; the row disables Play rather than assume. */
  peaks: Peaks | null;
  /** This preview is the one currently sounding. */
  playing: boolean;
  /** Toggle playback of the previewed take from its start (offset 0) — this
   *  row never scrubs, unlike the segment row it borrows `Waveform` from. */
  onTogglePlay: () => void;
  /** Accessible name while idle. Supplied by the integrator, like every other
   *  label on this component (strings.ts's `eraseConfirmPreviewPlay`). */
  playLabel: string;
  /** Accessible name while sounding (strings.ts's `eraseConfirmPreviewPause`). */
  pauseLabel: string;
  /** Paints the finished (green) wash instead of the voice (amber) one,
   *  mirroring `Waveform`'s own `finished` prop and `SegmentRow`'s row. */
  finished?: boolean;
}

interface EraseConfirmProps {
  open: boolean;
  /** The confirming line, e.g. "Erase this recording?". Copy is supplied by the
   *  integrator (strings.ts), never read here — this surface is pure UI. */
  title: string;
  /** Accessible name of the destructive action. */
  confirmLabel: string;
  /** Accessible name of the safe action. */
  cancelLabel: string;
  /** The erase is in flight: Erase disables, while Cancel stays enabled so the
   *  focus trap is never empty — but its action, like Escape and a scrim tap, is
   *  guarded to a no-op, so a destructive op is not abandoned half-done. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** The icon in the badge. The bin by default: the segment Erase (13), the
   *  book Delete (G6) and the failure log's Clear pass nothing and render
   *  exactly as before. "record" is O4 G5, the record-again confirm (#979):
   *  the workbench's record badge. The confirm BUTTON keeps the bin whatever
   *  this says, because it erases and starts no take (#1022). The caller
   *  decides, so this surface stays free of the design switch. */
  badge?: "trash" | "record";
  /**
   * The "Play what will be lost" row (#979 remainder). Omitted entirely by
   * default — the book Delete, the failure log's Clear, and today's segment
   * Erase and record-again call sites, all render exactly as before. Wired
   * from `segments-screen.tsx`'s own segment Erase (the O4 "13" dialog) only:
   * the recorder's record-again call site (O4 G5) is not wired here, because
   * `recorder.tsx` is owned by an open PR at the time of writing (see the PR
   * body) — a caller-side gap, not a limit of this prop.
   */
  preview?: EraseConfirmPreview;
}

/**
 * The erase confirmation (B6, D-CONFIRM).
 *
 * A minimal-text dialog: a badge (the bin, or the record dot for O4 G5), one
 * line, and two choices. Destructive,
 * so focus lands on Cancel — the safe action — not on Erase, and Escape or a
 * scrim tap resolves to Cancel too.
 *
 * Presentational only: it holds no store or hook, and every label and outcome
 * arrives by prop. The scrim, focus trap, Escape-closes and scrim-tap-cancels
 * mirror `menu.tsx`; the a11y contract (role=dialog, aria-modal, aria-label,
 * Tab trapped inside) is the same.
 */
export function EraseConfirm({
  open,
  title,
  confirmLabel,
  cancelLabel,
  busy = false,
  onConfirm,
  onCancel,
  badge = "trash",
  preview,
}: EraseConfirmProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Read from the keydown listener without re-subscribing it. The listener is
  // bound once per open (below); keying it on `busy`/`onCancel` instead would
  // re-run the whole effect — and re-fire the focus grab — on every parent
  // render, which while a take plays is every 60 ms, yanking a keyboard user off
  // Erase before they can confirm (George R-B6). Refs updated each render keep
  // the handler current without that churn.
  const busyRef = useRef(busy);
  const onCancelRef = useRef(onCancel);
  // Synced in a LAYOUT effect, not during render (refs must not be written
  // while rendering) and not in a passive `useEffect` (share-progress.tsx's
  // identical bug, Frank at `9832a8b` P2, #491): a passive effect is
  // scheduled after the browser paints, so a keydown queued in that same
  // window can fire against a STALE `busyRef` — here, an Escape landing
  // between `onConfirm` setting the parent's `busy` and this effect
  // catching up, read as "not busy" and cancelled a confirm that had already
  // started committing. A layout effect runs synchronously right after the
  // DOM mutation, before paint or any queued event, so the refs are current
  // by the time anything could react to what just rendered — the keydown
  // listener reads the latest values without the effect that binds it
  // re-running.
  useLayoutEffect(() => {
    busyRef.current = busy;
    onCancelRef.current = onCancel;
  });

  // The synchronous in-flight latch. `busy` reaches this component only after the
  // parent renders and a passive effect syncs `busyRef` — a window in which the
  // guard is still false. For a NON-destructive control that is harmless, but
  // here an Escape/Cancel/scrim in that window would tear the dialog down while
  // clearSegmentTake is committing, un-inert the recorder sheet, and let Back's
  // close() SAVE over the erase (Frank R-B6). So confirm latches this ref
  // synchronously, before onConfirm runs; every cancel path checks it. Reset on
  // the open edge so a reused dialog starts clean.
  const inFlightRef = useRef(false);
  useEffect(() => {
    if (open) inFlightRef.current = false;
  }, [open]);

  // The one cancel path. Blocked the instant Erase is activated (`inFlightRef`),
  // and while the parent reports `busy` (belt-and-braces). Stable identity (reads
  // only refs) so the bound-once keydown effect can depend on it without
  // re-binding.
  const cancel = useCallback(() => {
    if (inFlightRef.current || busyRef.current) return;
    onCancelRef.current();
  }, []);
  const beginConfirm = () => {
    if (inFlightRef.current) return; // also the synchronous double-activation guard
    inFlightRef.current = true;
    onConfirm();
  };

  // Land on Cancel, the safe action, ONCE on the closed→open edge — not the
  // first control in DOM order (this is destructive), and not on every render.
  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>(".confirm-cancel")?.focus();
  }, [open]);

  // When the erase commits, Erase disables (below). If it held focus, focus
  // would fall out of the panel to the document, breaking the trap for a
  // keyboard/switch user mid-op. Move it to Cancel — which stays enabled, its
  // action guarded to a no-op — so focus stays inside the dialog (#77). Fires
  // only on the busy edge; on the open edge `busy` is false, so it never fights
  // the Cancel-focus grab above.
  useEffect(() => {
    if (open && busy) {
      panelRef.current?.querySelector<HTMLElement>(".confirm-cancel")?.focus();
    }
  }, [open, busy]);

  // The focus trap + Escape, bound once per open. Reads `busy`/`onCancel`
  // through refs so a parent re-render never re-attaches it or re-grabs focus.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Marked handled, ALWAYS — including mid-erase, when `cancel` is a
        // no-op. This dialog can be stacked over an open `Menu` (the failure
        // log's Clear, George R2 P3-3, is armed from inside the menu rather
        // than after closing it, so a mis-tap returns to the panel with an
        // armed share intact). `menu.tsx` closes on Escape unless a child
        // claims it, reading `defaultPrevented` on this same native event —
        // the contract its rename field already uses. Without this, one Escape
        // would cancel the confirm and tear down the menu behind it.
        e.preventDefault();
        // Mid-erase, Escape does nothing: the op is already committing.
        cancel();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      // Keep Tab inside the panel; with the scrim covering everything behind,
      // wrapping is what makes it a real boundary. Cancel stays enabled while
      // busy (see below), so the trap is never empty and Tab cannot escape.
      wrapTab(panel, e);
    };
    // CAPTURE, not bubble. This dialog can be stacked over an open `Menu` (the
    // failure log's Clear, George R2 P3-3), and `menu.tsx` binds its own window
    // keydown when it opens — which is BEFORE this one, so on the bubble phase
    // the menu would read `defaultPrevented` as false and close itself before
    // this handler ever ran. Capturing puts the topmost dialog first, which is
    // what "modal" means, and it is what makes the `defaultPrevented` contract
    // `menu.tsx` already documents for its rename field work here too.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, cancel]);

  if (!open) return null;

  // Portalled to <body>, like Menu: on the recorder path this dialog is rendered
  // inside `.recorder-scrim` (z 60), so without the portal its own z-index would
  // only compete INSIDE that stacking context and the portalled menu (z 80) would
  // paint over it. At <body> its z 90 sits above both (George R-B6). It also
  // keeps the confirm out of any caller subtree that goes `inert`.
  return createPortal(
    <div
      className="confirm-scrim"
      // A tap on the scrim, but not the panel, cancels — unless mid-erase.
      onClick={(e) => {
        if (e.target === e.currentTarget) cancel();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="confirm-panel"
      >
        <Icon name={badge} size={32} className="confirm-glyph" />
        <span className="t-title">{title}</span>
        {preview && (
          <div className="confirm-preview">
            <Waveform
              peaks={preview.peaks}
              height={44}
              recorded={preview.peaks !== null}
              finished={preview.finished}
              className="min-w-0 flex-1"
            />
            <Control
              icon={preview.playing ? "pause" : "play"}
              label={preview.playing ? preview.pauseLabel : preview.playLabel}
              variant="play"
              size={26}
              // Not tied to `busy`: playback is non-destructive, and the
              // caller already stops it before an erase commits
              // (`audio.leave()` in `segments-screen.tsx`'s `onConfirmErase`)
              // — this only guards the one case where there is nothing to
              // play.
              disabled={preview.peaks === null}
              onClick={preview.onTogglePlay}
              className="confirm-preview-play"
            />
          </div>
        )}
        <div className="confirm-actions">
          <Control
            icon="back"
            label={cancelLabel}
            variant="quiet"
            // Deliberately NOT disabled while busy: disabling both buttons would
            // empty the focus trap and let Tab escape the dialog (George R-B6,
            // the same disabled-last-item hole this round closed in menu.tsx).
            // The action is guarded by `cancel()` instead — a tap once Erase is
            // activated is a no-op — so the trap stays honest.
            onClick={cancel}
            className="confirm-cancel"
          />
          <Control
            icon="trash"
            label={confirmLabel}
            variant="record"
            disabled={busy}
            onClick={beginConfirm}
          />
        </div>
      </div>
    </div>,
    document.body
  );
}
