/**
 * Where focus goes when a full-body recovery panel RESOLVES (#199) — the
 * decision alone, so it is a truth table rather than a phone.
 *
 * The recorder has three panels that replace the sheet body and `autoFocus`
 * their own control: `PermissionPanel` (the mic was refused), `LoadErrorPanel`
 * (the segment's audio could not be read) and the held-take recovery (#165).
 * Each is correct while it is up — `recorder.tsx`'s overlay restore suppresses
 * itself for exactly that reason.
 *
 * The gap is the SUCCESS edge. A "Try again" that works clears the error, the
 * panel unmounts with focus on the control that has just gone away, and the
 * sheet's own focus grab is mount-only (`recorder.tsx`, deps `[]`) because App
 * keys the sheet on segmentId. The Segments list behind is `inert`, so focus
 * falls to `<body>` and the next Tab reaches the header Back. Touch users are
 * unaffected; a keyboard, switch or screen-reader user is stranded outside the
 * sheet they are working in.
 *
 * #199 offered accepting that as a residual (which is what `PermissionPanel`
 * already did) or landing focus deliberately. This is the second, for all
 * three panels rather than one: a resolved panel leaves the sheet in exactly
 * the state a fresh open leaves it, so it should land focus exactly where a
 * fresh open does — the same call, not a second policy.
 *
 * Booleans, never elements, so it stays inside `lib/`'s DOM ban and runs in the
 * Node-only suite. The half that reads the DOM and calls `.focus()` lives in
 * `recorder.tsx` and, like `use-focus-restore.ts`, has no automated coverage
 * anywhere in this repo (#361) — it is review and on-device surface, and is
 * not claimed as tested.
 */

interface PanelRecoveryInput {
  /**
   * A full-body panel owned the sheet body on the previous commit. `false` on
   * the first commit, which is what keeps a fresh open from double-focusing:
   * the mount effect has already landed focus by then.
   */
  readonly ownedLastCommit: boolean;
  /**
   * A full-body panel owns it now. Still true means the panel is merely
   * CHANGING (a failed retry re-renders it, or one panel gives way to
   * another), and its own `autoFocus` is the right landing — stealing that
   * back would strand a screen-reader user off the Retry they were handed.
   */
  readonly ownsNow: boolean;
  /**
   * The sheet is closing. `heldTake`'s two-tap discard clears the panel and
   * closes the recorder in the same turn, and `PermissionPanel`'s Back does
   * the same, so a cleared panel is not by itself evidence of a recovery.
   * Focusing inside an unmounting sheet is dead code at best, and at worst
   * fights the Segments screen's own hand-off.
   */
  readonly closing: boolean;
}

/**
 * True on exactly one edge: a panel that owned the body no longer does, and
 * the sheet is staying open. Deliberately not `ownedLastCommit !== ownsNow`,
 * which would also fire on the panel APPEARING and steal the `autoFocus` it
 * just set.
 */
export function panelRecoveryFocus({
  ownedLastCommit,
  ownsNow,
  closing,
}: PanelRecoveryInput): boolean {
  return ownedLastCommit && !ownsNow && !closing;
}
