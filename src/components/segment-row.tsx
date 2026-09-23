import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { Control } from "./control";
import { Icon } from "./icon";
import { Menu } from "./menu";
import { NameEdit } from "./name-edit";
import { Notice } from "./notice";
import { strings } from "./strings";
import { reportFailure } from "@/hooks/report-failure";
import { Waveform } from "./waveform";
import { cn } from "@/lib/utils";
import { segmentRowState } from "@/types/view";
import type { SegmentRow as SegmentRowModel } from "@/types/view";

interface SegmentRowProps {
  row: SegmentRowModel;
  /** This row is the one currently sounding (only one row plays at a time). */
  playing: boolean;
  /** Milliseconds into the sounding take; meaningful only while `playing`. */
  playbackElapsedMs: number;
  /**
   * The take that just stopped RAN OUT, rather than being stopped by hand.
   * Read on the commit where `playing` goes false — the session reports both
   * facts together — and it is the one thing this row cannot work out for
   * itself: the two endings arrive here as the same prop change (#601).
   */
  ranOut?: boolean;
  /**
   * Toggle playback from a scrub offset (seconds). Maps to `playTake`, which
   * toggles: called while this row plays, it stops — so the offset is read
   * only when starting.
   */
  onPlay: (offsetSeconds: number) => void;
  /** Open the recorder sheet for this segment — to record an empty one, or to
   * edit (insert/append/re-record) one that already has audio. */
  onOpenRecorder: () => void;
  onSetFinished: (finished: boolean) => void;
  /**
   * Ask to erase this segment's recording (B6, D-TWO-ENTRIES). Picked from the
   * row's overflow menu; the screen owns the confirm and the store op, so both
   * Erase entry points share one implementation and one dialog. Offered only on
   * a recorded row — a never-recorded row has no audio to erase.
   */
  onErase: () => void;
  /**
   * Commit a typed label (#591), resolving `true` once it has landed. The store
   * normalises it (trim, blank ⇒ `null`); the row only keeps its field up on
   * `false` so the translator can try again.
   */
  onRename: (label: string) => Promise<boolean>;
  /**
   * This row's overflow menu has opened, with the function that closes it.
   *
   * Two jobs, one channel, deliberately: the screen goes `inert` behind the
   * menu for AT/switch users (the menu is portalled out, so it stays reachable
   * while the list does not), and — since #452 PR4 — registers it as a
   * system-Back `Layer` whose `dismiss()` IS the `close` handed over here. One
   * channel because the two facts must never disagree: a registered layer whose
   * menu is already gone traps Back at this screen's depth (#494 item 3).
   *
   * **Called from the tap handler, never from an effect** (invariant 6,
   * `docs/design/back-navigation.md`). It used to be reported from a
   * `useEffect` keyed on the open boolean, which is the shape invariant 6
   * exists to keep out of layer bookkeeping: an unstable dependency fires that
   * effect's cleanup and body spuriously, which here would deregister and
   * re-register a live layer.
   *
   * Optional — a consumer that manages neither is free to ignore both.
   */
  onMenuOpen?: (close: () => void) => void;
  /** This row's overflow menu has closed, by any of its own paths or by Back. */
  onMenuClose?: () => void;
  /**
   * A save is landing (the list is refreshing). Opening the recorder is held
   * off until it does: the row still reads by its pre-save state, so entering
   * now would open on stale audio. Play stays live.
   */
  busy?: boolean;
  /**
   * This row's Record is the next required action in the guided chain (#604) —
   * the hop between "Add segment" and the recorder, which is the only door to
   * it. Only ever true on a row with no audio, which is the only state that
   * renders a Record at all; `guided-step.ts` owns that rule.
   */
  guided?: boolean;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/**
 * One segment, as a row (mockup 2, v0.1.2 rework):
 *   [ status + ordinal ] [ waveform ] [ transport ] [ menu | spacer ]
 *
 * The three states are derived clip-presence-first (`segmentRowState`): a
 * dangling clip reads as never-recorded so the only offer is re-record, never
 * amber bars over audio the database cannot play.
 *
 * The whole left zone is one `.row-open` button in all three states (#79):
 * tapping the status slot or the ordinal opens the segment in the recorder/
 * editor. The status slot holds a green check-circle only on a finished row and
 * otherwise reserves its 22px so ordinals stay left-aligned down the list. A
 * finished row is tinted green throughout (#81) — waveform, play button, a
 * quiet surface wash. The per-row overflow menu (#80) is on every row since it
 * carries Rename (#591), which a facilitator uses while setting a chapter up,
 * before anything is recorded. Its audio items — Edit / Finished / Erase — are
 * recorded-row only: a never-recorded segment has no audio to erase and, since
 * Finished lives only in that menu, cannot be marked finished — the
 * finished-invariant made structural. A never-recorded row opens the recorder
 * from its record button, sized to match play (#82).
 *
 * The ordinal always shows; a label, when set, follows it ("3 · verses 3–4").
 */
export function SegmentRow({
  row,
  playing,
  playbackElapsedMs,
  ranOut = false,
  onPlay,
  onOpenRecorder,
  onSetFinished,
  onErase,
  onRename,
  onMenuOpen,
  onMenuClose,
  busy = false,
  guided = false,
}: SegmentRowProps) {
  const state = segmentRowState(row);
  const [menuOpen, setMenuOpen] = useState(false);
  // The menu is showing its rename field (#591) rather than its action list,
  // the rename write is in flight, and the last one did not land. All three
  // reset whenever the menu opens or closes.
  const [renaming, setRenaming] = useState(false);
  const [savingLabel, setSavingLabel] = useState(false);
  const [renameFailed, setRenameFailed] = useState(false);
  // Advances on every open and close, so a rename that settles after
  // the translator has moved on cannot close, or mark as failed, a menu it no
  // longer belongs to — the chapter menu's session token, for the same reason.
  const menuSession = useRef(0);
  // Where focus goes once leaving rename mode has committed. `Menu` places
  // focus only on its open edge, so without this the unmounting field drops
  // focus to <body>: behind a modal on Cancel, or on a page with nothing
  // focused after a save. Set by the two exits, read by the layout effect
  // below.
  const pendingFocus = useRef<"rename" | "menu" | null>(null);
  const renameControlRef = useRef<HTMLButtonElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  // The same fact as `menuOpen`, as a ref, for committed cleanup paths —
  // never read during render (`react-hooks/refs`).
  const menuOpenRef = useRef(false);
  // Latest-refs for the two callbacks, so the unmount cleanup can stay an
  // effect with an EMPTY dependency array — it must run on unmount and on
  // nothing else. Written in the layout phase for the same reason
  // `use-screen-layers.ts` writes its own there: a passive write can be one
  // commit behind a macrotask that reads it.
  const onMenuOpenRef = useRef(onMenuOpen);
  const onMenuCloseRef = useRef(onMenuClose);
  useLayoutEffect(() => {
    onMenuOpenRef.current = onMenuOpen;
    onMenuCloseRef.current = onMenuClose;
  });
  // One close for every path out of the menu — its own Close/scrim/Escape, each
  // action item, and the system Back that runs this as the layer's `dismiss()`.
  // Idempotent: closing an already-closed menu re-reports `false`, which
  // `popLayer` and the screen's own `setRowMenuOpen(false)` both absorb.
  const closeMenu = useCallback(() => {
    menuSession.current += 1;
    setMenuOpen(false);
    setRenaming(false);
    setSavingLabel(false);
    setRenameFailed(false);
    menuOpenRef.current = false;
    onMenuCloseRef.current?.();
  }, []);
  const openMenu = useCallback(() => {
    menuSession.current += 1;
    setMenuOpen(true);
    menuOpenRef.current = true;
    // Handed over in the SAME handler that flips the state (invariant 6).
    onMenuOpenRef.current?.(closeMenu);
  }, [closeMenu]);
  // The one thing the old reporting effect did that a tap handler cannot: a row
  // that unmounts with its menu open must still release the list's `inert` and
  // its layer, or the screen is left inert behind a menu that no longer exists
  // and Back is trapped at this depth (#494 item 3). Empty deps, so it is an
  // unmount cleanup and nothing else.
  useEffect(
    () => () => {
      if (menuOpenRef.current) onMenuCloseRef.current?.();
    },
    []
  );
  const hasClip = row.hasClip;
  // Losing the clip takes the menu's audio items away without unmounting this
  // row, so an open menu closes rather than reflowing under the translator's
  // finger. Release its layer after that prop change commits, using the latest
  // callback ref above. Never notify the parent during render or from
  // dependency-change cleanup.
  useLayoutEffect(() => {
    if (!hasClip && menuOpenRef.current) closeMenu();
  }, [hasClip, closeMenu]);
  const durationMs = row.durationMs ?? 0;
  const ordinal = row.ordinal;

  // Commit the typed label, then close on success. A failure keeps the field up
  // with a line in the menu itself — the screen's Notice is behind the scrim.
  const onSaveLabel = (value: string) => {
    const session = menuSession.current;
    setSavingLabel(true);
    setRenameFailed(false);
    const settle = (ok: boolean) => {
      if (menuSession.current !== session) return;
      setSavingLabel(false);
      if (ok) {
        // Back to the ≡ that opened the menu, so the next move starts from
        // this row rather than from the top of the page.
        pendingFocus.current = "menu";
        closeMenu();
      } else setRenameFailed(true);
    };
    // `onRename` is not expected to reject (the hook catches), but if it ever
    // does the field must not sit on "Saving…" forever: a rejection is a rename
    // that did not land, and its cause still reaches the log.
    void onRename(value).then(settle, (cause: unknown) => {
      reportFailure(cause, "segment-rename");
      settle(false);
    });
  };
  // Cancel / Escape: back to the action list. NameEdit makes this a no-op while
  // a write is in flight, so there is no settle left to orphan here.
  const onCancelRename = () => {
    pendingFocus.current = "rename";
    setRenaming(false);
    setRenameFailed(false);
  };
  // After the commit that brings the action list back (Cancel), or that closes
  // the menu and lifts the list's `inert` (a save) — a node inside an inert
  // subtree cannot take focus, which is why this waits for the commit.
  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (target === "rename" && !renaming) {
      pendingFocus.current = null;
      renameControlRef.current?.focus();
    } else if (target === "menu" && !menuOpen) {
      pendingFocus.current = null;
      menuButtonRef.current?.focus();
    }
  }, [renaming, menuOpen]);

  // The resting scrub position, [0,1]. While playing, the dot tracks the take's
  // elapsed instead; a hand stop rests it where it reached, so `position`
  // catches up to the last elapsed fraction.
  const [position, setPosition] = useState(0);
  const [dragging, setDragging] = useState(false);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const lastElapsedFraction = useRef(0);
  const wasPlaying = useRef(false);

  const playingFraction =
    playing && durationMs > 0 ? clamp01(playbackElapsedMs / durationMs) : 0;

  useEffect(() => {
    if (playing && durationMs > 0) {
      lastElapsedFraction.current = clamp01(playbackElapsedMs / durationMs);
    }
  }, [playing, playbackElapsedMs, durationMs]);

  useEffect(() => {
    // A hand stop is a place the translator picked, so the dot stays there
    // rather than snapping back to the old start position. A take that RAN OUT
    // picked nothing, and resting at the end points the next Play's offset past
    // the audio — the segment then cannot be played twice without dragging the
    // dot back (#601), so a run-out rests at the start instead.
    if (wasPlaying.current && !playing) {
      setPosition(ranOut ? 0 : lastElapsedFraction.current);
    }
    wasPlaying.current = playing;
  }, [playing, ranOut]);

  // A 1:1 re-record replaces the clip under the SAME row instance (same key),
  // so the resting scrub must snap back to the start when the audio identity
  // changes — otherwise the dot points into a clip that no longer exists
  // (G5-#4). Keyed on the clip's id, a TRUE identity: a re-record mints a fresh
  // ClipId, so this fires even when the replacement is the same length (a
  // duration key collided — F7). Reset during render against the previous id
  // held in state, React's recommended shape for "reset state when a prop
  // changes" (no effect, no extra commit). `lastElapsedFraction` needs no reset:
  // it is only read after a playback session, which rewrites it every frame.
  const [prevClipId, setPrevClipId] = useState(row.clipId);
  if (row.clipId !== prevClipId) {
    setPrevClipId(row.clipId);
    setPosition(0);
  }

  const fraction = playing ? playingFraction : position;

  const fractionFromEvent = useCallback((clientX: number): number => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    return rect.width > 0 ? clamp01((clientX - rect.left) / rect.width) : 0;
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!hasClip) return;
      const frac = fractionFromEvent(e.clientX);
      // Dragging while a row plays stops it and moves the dot (F4). Point the
      // rest position at the tapped spot BEFORE stopping: the playing→false
      // effect rests the dot at `lastElapsedFraction`, so without this a
      // tap-to-seek would snap back to wherever playback had reached.
      if (playing) {
        lastElapsedFraction.current = frac;
        onPlay(0);
      }
      setDragging(true);
      setPosition(frac);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [hasClip, playing, onPlay, fractionFromEvent]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      setPosition(fractionFromEvent(e.clientX));
    },
    [dragging, fractionFromEvent]
  );

  const onPointerUp = useCallback(() => setDragging(false), []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!hasClip) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setPosition((p) => clamp01(p - 0.05));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setPosition((p) => clamp01(p + 0.05));
      }
    },
    [hasClip]
  );

  // The left zone opens the segment in all three states (#79). The finished
  // aria-label is now the ONLY place the finished state reaches AT on the row —
  // the checkbox's `aria-checked` is gone and the menu is closed — so it carries
  // "finished" explicitly. `openSegment` on an empty row stays distinct from the
  // record button's "Record segment N" so the two do not collide.
  const openLabel =
    state === "finished"
      ? strings.editSegmentFinished(ordinal, row.label)
      : hasClip
        ? strings.editSegment(ordinal, row.label)
        : strings.openSegment(ordinal, row.label);

  return (
    <div className={cn("row", state === "finished" && "row--finished")}>
      <button
        type="button"
        onClick={onOpenRecorder}
        disabled={busy}
        aria-label={openLabel}
        className="row-open"
      >
        <span className="row-status">
          {state === "finished" && <Icon name="check" size={16} />}
        </span>
        <span className="t-ordinal row-heading">
          {strings.segmentHeading(ordinal, row.label)}
        </span>
      </button>

      {hasClip ? (
        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label={strings.scrubSegment(ordinal)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fraction * 100)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onKeyDown={onKeyDown}
          className="scrub min-w-0 flex-1"
        >
          <Waveform
            peaks={row.peaks}
            height={26}
            finished={state === "finished"}
          />
          <span
            className="scrub-dot"
            style={{ left: `${fraction * 100}%` }}
            aria-hidden="true"
          />
        </div>
      ) : (
        <div className="min-w-0 flex-1">
          <Waveform peaks={null} height={26} recorded={false} />
        </div>
      )}

      {hasClip ? (
        <Control
          icon={playing ? "pause" : "play"}
          label={
            playing
              ? strings.pauseSegment(ordinal)
              : strings.playSegment(ordinal)
          }
          variant="play"
          size={20}
          className="flex-none"
          // Held with the other controls while a save refreshes the list: the
          // row still carries the pre-save durationMs, so an offset computed
          // from it would seek the wrong place in the clip just written.
          disabled={busy}
          onClick={() => onPlay(fraction * (durationMs / 1000))}
        />
      ) : (
        <Control
          icon="record"
          label={strings.recordSegment(ordinal)}
          variant="record"
          size={20}
          className="flex-none"
          disabled={busy}
          // Never on a control held inert by a landing save: the ring would
          // be pointing at a tap the row is refusing.
          guided={guided && !busy}
          onClick={onOpenRecorder}
        />
      )}

      {/* The per-row overflow (#80). Rename on every row (#591); Edit /
          Finished / Erase on a recorded row only — a never-recorded segment has
          no audio to erase, and gating Finished here is what keeps the
          finished-invariant structural: `onSetFinished(true)` is unreachable
          from an empty row. The same Erase hook and confirm the recorder menu
          uses live in the screen, so both entry points erase one way. */}
      <Control
        ref={menuButtonRef}
        icon="more"
        label={strings.segmentMenu(ordinal)}
        variant="quiet"
        size={20}
        className="flex-none"
        disabled={busy}
        onClick={openMenu}
      />
      <Menu
        open={menuOpen}
        onClose={closeMenu}
        title={strings.recorderMenuTitle}
      >
        {renaming ? (
          <>
            {/* Seeded with the current label, or empty while there is none —
                the facilitator types the verses rather than editing the
                ordinal, which stays whatever the label says. */}
            <NameEdit
              initialValue={row.label ?? ""}
              fieldLabel={strings.segmentNameField}
              onSave={onSaveLabel}
              onCancel={onCancelRename}
              busy={savingLabel}
            />
            {/* Announced wherever focus sits, as on the chapter rename: Enter
                leaves focus on the field, not on Confirm's busy mark. */}
            {savingLabel && <Notice tone="busy">{strings.savingName}</Notice>}
            {renameFailed && <Notice>{strings.renameSegmentFailed}</Notice>}
          </>
        ) : (
          <>
            {hasClip && (
              <>
                <Control
                  icon="edit"
                  label={strings.editSegment(ordinal, row.label)}
                  variant="quiet"
                  onClick={() => {
                    closeMenu();
                    onOpenRecorder();
                  }}
                />
                <Control
                  icon="check"
                  label={
                    row.finished
                      ? strings.markUnfinished(ordinal)
                      : strings.markFinished(ordinal)
                  }
                  variant="quiet"
                  // Green while already finished. A standalone class, not
                  // inheritance — the menu is portalled to <body>, outside
                  // `.row--finished`.
                  className={row.finished ? "is-done" : undefined}
                  onClick={() => {
                    closeMenu();
                    onSetFinished(!row.finished);
                  }}
                />
              </>
            )}
            <Control
              ref={renameControlRef}
              icon="edit"
              label={strings.renameSegment}
              variant="quiet"
              onClick={() => setRenaming(true)}
            />
            {hasClip && (
              <Control
                icon="trash"
                label={strings.eraseSegment}
                variant="quiet"
                onClick={() => {
                  // Erase FIRST, then close this menu: the screen registers the
                  // confirm's layer inside `onErase` and this close unregisters
                  // this menu's, so the stack goes 1 -> 2 -> 1 and never passes
                  // through empty. Same interleave, and the same reason, as
                  // Books' `onArmDelete` (#452 PR3).
                  onErase();
                  closeMenu();
                }}
              />
            )}
          </>
        )}
      </Menu>
    </div>
  );
}
