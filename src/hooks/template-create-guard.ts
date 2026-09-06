/**
 * The synchronous double-tap guard behind `useTemplateLibrary`'s `create`
 * (#246): pulled out of the hook into a plain, DOM-free module so it can be
 * unit-tested in Node, the way `hooks/report-failure.ts` keeps its own
 * logic testable outside a component tree — no jsdom/React-renderer exists
 * in this repo, so a hook's *state transitions* are ordinarily review
 * surface only, but the transition itself does not need React to exist.
 *
 * The risk this closes: a double-tap on the SAME template row, in the
 * window before React re-renders it busy. `createBookFromTemplate` already
 * makes a REPEATED import of the SAME template safe at the storage layer
 * (#253 — it names the second book rather than colliding), so the failure
 * mode here is narrower and UI-only — two concurrent calls from one tap
 * would both be honoured by storage, producing TWO books where the
 * translator asked for one. `beginCreate`/`endCreate` close that window
 * synchronously, before either call's first `await`, which is why the
 * caller must check-and-add in one call rather than a separate `has` then
 * `add` (a second tap between those two lines would race it).
 *
 * Keyed per id, not a single flag: a DIFFERENT template importing while
 * this one is still writing is a legitimate second action, not a repeat of
 * the first — 66 Bible-book rows would otherwise all block on each other.
 */

/**
 * Claim `id` for an in-flight create. Returns `false` (and leaves `inFlight`
 * unchanged) if `id` is already claimed — the caller's signal to drop this
 * tap rather than start a second create. Returns `true` after adding it.
 */
export function beginCreate(inFlight: Set<string>, id: string): boolean {
  if (inFlight.has(id)) return false;
  inFlight.add(id);
  return true;
}

/** Release `id`, whether its create succeeded, failed, or never began. */
export function endCreate(inFlight: Set<string>, id: string): void {
  inFlight.delete(id);
}
