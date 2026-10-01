/**
 * The staged-file ownership handoff `useShareFlow` drives (#365).
 *
 * Pulled out of the hook as a plain, dependency-free state machine so the one
 * property both review lenses flagged on #347 round 6 — a `reset()` or
 * unmount racing `send()`'s synchronous takeover must never discard a file
 * the OS chooser is still being offered — is provable in Node
 * (`tests/share-handoff.test.ts`), not only by reading `share-flow.ts`'s
 * control flow. The concrete regression both reviewers named: a later edit
 * moves the discard back onto `reset()` without the handoff, the translator
 * taps Share now and then the scrim, and `FileProvider` is left serving a
 * file that no longer exists.
 *
 * This module owns exactly two facts — what is armed, and whether a send
 * currently owns it — and nothing else. It does NOT know about the run-id
 * cancellation token (`share-flow.ts`'s `runIdRef`/`current()`, the same
 * generation-token shape every async flow in this codebase uses, not a
 * property specific to this handoff) or about `status`/`error` (UI-facing
 * state the hook still sets directly). Splitting further would re-describe
 * React glue as "pure" without adding a provable invariant; kept in
 * `hooks/`, alongside `share-flow.ts` and `share-target.ts`, rather than
 * `lib/`, because it exists only to serve this one hook's protocol, not as a
 * general-purpose utility.
 */
export interface ShareHandoff<T> {
  /** What is armed right now, or `null`. Read-only from outside; use `arm`,
   * `take`, `restore` and `dropArmed` to change it. */
  readonly armed: T | null;
  /** Whether a send currently owns the flow. Cleared only by
   * {@link finishSending}. */
  readonly sending: boolean;
  /**
   * Arm a freshly prepared value. The caller (`prepare()`) is responsible for
   * confirming nothing is already armed and no send owns the flow first
   * (`isBusy()`) — this method does not re-check either.
   */
  arm(value: T): void;
  /**
   * Take ownership for a send, SYNCHRONOUSLY — the property the whole module
   * exists for. Returns the armed value and clears it in the same call, so a
   * `reset()`/unmount that runs even one microtask later sees nothing armed
   * and cannot discard the file the chooser now holds. Returns `null` if
   * nothing was armed. Marks `sending` true only when it returns non-null.
   */
  take(): T | null;
  /**
   * Put a value back after a retryable send failure (the tap's activation was
   * spent, but the File still stands). Does not touch `sending` — the send
   * that called this is still the one that must call {@link finishSending}.
   */
  restore(value: T): void;
  /** Clear the sending flag once a send has fully settled. Does not touch
   * what is armed — `restore` may have just re-armed a value. */
  finishSending(): void;
  /**
   * Drop whatever is currently armed — `reset()` or unmount. Returns it so
   * the caller can dispose of any resource (discard a staged file), or
   * `null` if {@link take} already claimed it: that null is the invariant
   * #365 exists to prove. A send already in flight keeps running and owns
   * its own cleanup; this never reaches into it.
   */
  dropArmed(): T | null;
  /** Whether a fresh value may be armed right now — something is already
   * armed, or a send owns the flow. */
  isBusy(): boolean;
}

export function createShareHandoff<T>(): ShareHandoff<T> {
  let armed: T | null = null;
  let sending = false;
  return {
    get armed() {
      return armed;
    },
    get sending() {
      return sending;
    },
    arm(value) {
      armed = value;
    },
    take() {
      if (armed === null) return null;
      const value = armed;
      armed = null;
      sending = true;
      return value;
    },
    restore(value) {
      armed = value;
    },
    finishSending() {
      sending = false;
    },
    dropArmed() {
      const value = armed;
      armed = null;
      return value;
    },
    isBusy() {
      return armed !== null || sending;
    },
  };
}
