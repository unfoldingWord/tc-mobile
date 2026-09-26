import { useCallback, useMemo, useRef } from "react";

import { planReveal, type PendingReveal } from "@/lib/a11y/pending-reveal";

export interface ScrollToNew<Id> {
  /**
   * Register (or drop) a row's element. A `ref` callback on the row's own
   * wrapper: React calls it with the element on mount and with `null` on
   * unmount, which is what keeps the map from holding detached nodes.
   */
  setNode: (id: Id, el: HTMLElement | null) => void;
  /**
   * Arm a scroll for the next {@link reveal}. The row does not have to exist
   * yet — that is the point: the caller arms the id it just created and the
   * effect that watches the list reveals it once it is committed.
   */
  armScroll: (id: Id) => void;
  /**
   * Arm a focus hand-off for the next {@link reveal} the screen is not holding.
   *
   * `null` arms nothing, so a caller can pass a decision that may legitimately
   * have no target (`focusTargetAfterDelete`) without branching.
   *
   * Hand focus off whenever the control that had it is about to unmount — an
   * empty state's CTA that the create destroys, a dialog that closes on
   * Confirm. Without it focus falls to the document, and the next Tab starts at
   * the first header stop, which on these screens is Back.
   */
  armFocus: (id: Id | null) => void;
  /**
   * The row's registered element, or `null` when no row is registered under
   * that id — because it is not on screen, or not committed yet.
   *
   * For the one landing this hook does NOT arm: a node that is itself the
   * focus target (a registered empty state, which carries its own
   * `tabIndex={-1}`) rather than a row with a control inside it.
   */
  nodeFor: (id: Id) => HTMLElement | null;
  /**
   * The control inside a row that takes a hand-off — the same `focusSelector`
   * {@link reveal} uses, so a caller that focuses a row NOW lands where an
   * armed reveal would have, without repeating the selector.
   *
   * Returns the element rather than focusing it, because one caller stashes it
   * for a later return-focus rather than focusing it here.
   */
  controlIn: (id: Id) => HTMLElement | null;
  /**
   * Scroll a row into view now, without arming anything. For a landing that is
   * decided from the list itself rather than from a create — Segments' first
   * load, which lands on the first not-finished row (F5).
   */
  scrollTo: (id: Id) => void;
  /**
   * Act on what is armed. Call it from an effect keyed on the list, plus every
   * flag `focusHeld` reads — a run with nothing armed is a no-op, so keying
   * widely is free and keying narrowly loses hand-offs.
   *
   * @param focusHeld the row cannot take focus on this commit, because the
   *   screen has an overlay up and the list is `inert` beneath it. The armed
   *   target is KEPT for the commit that lifts it; see `lib/a11y/pending-reveal`
   *   for why spending it instead is the #364 defect rather than a small bug.
   *   Required, not defaulted: a default of `false` would make the #364
   *   failure the result of writing less code, so each screen states its
   *   hold policy at its own call site.
   */
  reveal: (focusHeld: boolean) => void;
}

/**
 * Scroll to — and optionally focus — a row the translator has just created
 * (#160 L-15).
 *
 * Books and Segments each grew their own copy of this: a node map, a
 * `setNode` ref callback, a `pendingScroll` ref, a `pendingFocus` ref and an
 * effect that spends both. The two copies are not identical — Books holds the
 * focus hand-off while its delete confirm is up and Segments does not, which is
 * correct today only because Segments arms focus from one site (the empty
 * chapter's invite) with no overlay over it. That is a premise, not a property,
 * and it is the kind that goes stale silently: the screen that needed the
 * `inert` guard is the one #364 was filed about. Sharing the mechanism makes
 * the hold available to both and puts the rule where a test can reach it.
 *
 * **Refs, not state, throughout.** Creating a row already re-renders the
 * screen (`useBooks.createBook`/`addChapter` patch their list in place; Segments'
 * `addSegment` likewise), so the arm does not need to cause a render of its
 * own — and a `setState` here would be a setState-in-effect cascade on every
 * create instead.
 *
 * The screens keep their own effects rather than this hook owning one: their
 * dependency lists are genuinely different (Books re-runs on three separate
 * close edges, Segments on one), and each list carries a comment explaining
 * why, which is worth more at the call site than inside a shared hook.
 *
 * ## What is and is not verified
 *
 * The decision this delegates to is table-tested (`tests/pending-reveal.test.ts`).
 * The DOM around it — the node map, which control `focusSelector` resolves to,
 * that an unmount drops a node, that an arm is spent even when its row never
 * arrived, and that a HELD hand-off is retained and lands on the commit that
 * lifts the hold — is covered in jsdom by `tests/scroll-to-new.test.ts`.
 *
 * What that cannot reach is LAYOUT. jsdom implements none, so
 * `scrollIntoView` is a stub there: the test says this hook calls it, on which
 * node, with `{ block: "nearest" }`. Whether a phone then puts the new row
 * where the translator is looking is a device question, and nothing here
 * answers it — do not write "verified" on that half without one.
 *
 * @param focusSelector which control inside the row takes the hand-off, as a
 *   CSS selector matched within the row's registered element. Chosen by ROLE at
 *   each call site, never by DOM order: the landing spot must not be a control
 *   that saves, deletes or leaves, because the activation that created the row
 *   can still be held down and key-repeat onto it (George R4 P2-1 on Books).
 */
export function useScrollToNew<Id>(focusSelector: string): ScrollToNew<Id> {
  const nodes = useRef(new Map<Id, HTMLElement>());
  const pending = useRef<PendingReveal<Id>>({ scroll: null, focus: null });

  const setNode = useCallback((id: Id, el: HTMLElement | null) => {
    if (el) nodes.current.set(id, el);
    else nodes.current.delete(id);
  }, []);

  const armScroll = useCallback((id: Id) => {
    pending.current = { ...pending.current, scroll: id };
  }, []);

  const armFocus = useCallback((id: Id | null) => {
    pending.current = { ...pending.current, focus: id };
  }, []);

  const nodeFor = useCallback((id: Id) => nodes.current.get(id) ?? null, []);

  const scrollTo = useCallback((id: Id) => {
    nodes.current.get(id)?.scrollIntoView({ block: "nearest" });
  }, []);

  const controlIn = useCallback(
    (id: Id) =>
      nodes.current.get(id)?.querySelector<HTMLElement>(focusSelector) ?? null,
    [focusSelector]
  );

  const reveal = useCallback(
    (focusHeld: boolean) => {
      const plan = planReveal(pending.current, focusHeld);
      pending.current = plan.rest;
      // Through the two accessors above, not a second hand-written
      // `scrollIntoView` and `querySelector(focusSelector)`. Resolving the
      // selector in two places inside this file would leave one copy of
      // exactly the duplication this hook exists to remove from the screens —
      // and it is the copy a later `controlIn` change would silently skip.
      if (plan.scroll !== null) scrollTo(plan.scroll);
      // A bare `.focus()`, as both screens called it before this hook existed.
      // The HTML focus steps scroll the target into view unless
      // `preventScroll: true` is passed, so a hand-off can move the viewport
      // even on a commit that plans no scroll of its own. Carried over
      // deliberately: changing it is a behaviour change, which a no-change
      // extraction is the wrong place for. Filed rather than decided here
      // (George round 1 finding 2, #800).
      if (plan.focus !== null) controlIn(plan.focus)?.focus();
    },
    // Both are stable (`scrollTo` has no deps, `controlIn` keys on the same
    // `focusSelector` this used to read directly), so `reveal`'s own identity
    // is as stable as before — which the memo below depends on.
    [controlIn, scrollTo]
  );

  // Stable identity: consumers put this object in an effect's dependency list,
  // and a fresh object per render would re-run that effect on every tick of a
  // live take. The same reason `useFocusRestore` memoises its pair.
  return useMemo(
    () => ({
      setNode,
      armScroll,
      armFocus,
      nodeFor,
      controlIn,
      scrollTo,
      reveal,
    }),
    [setNode, armScroll, armFocus, nodeFor, controlIn, scrollTo, reveal]
  );
}
