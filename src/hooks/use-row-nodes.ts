import { useCallback, useRef } from "react";

/**
 * A list screen's map from row id to its DOM node, and the one thing both
 * screens do with it: scroll to a row that did not exist yet when the scroll
 * was asked for (#160, L-15).
 *
 * Books and Segments each carried their own `nodes` map, their own byte-identical
 * `setNode`, and their own copy of the pending-scroll consume. This holds the
 * registry and the consume; each screen keeps its own effect.
 *
 * That split is deliberate. The two effects look alike and are not: Books gates
 * its focus hand-off on the delete confirm being down, because the shelf is
 * `inert` while it is up and focusing inside an inert subtree is a silent
 * no-op that consumes the pending target — a fix this repo learned twice
 * (#364) — and it is keyed on three pieces of state for reasons argued in
 * place. Segments' hand-off is ungated and targets a different control. Only
 * the registry and the scroll are the same, so only they are here, and
 * `scrollPending` is called FROM each screen's existing effect rather than
 * owning one: no effect is split, no dependency array moves.
 */
export interface RowNodes<Id extends string> {
  /** `ref` callback for a row: registers on mount, drops on unmount. */
  setNode: (id: Id, el: HTMLElement | null) => void;
  /** The registered node, for a screen's own focus hand-off. */
  nodeFor: (id: Id) => HTMLElement | undefined;
  /**
   * Scroll to whatever `pending` holds, and clear it. A no-op when it is null
   * or its row is not in the tree.
   *
   * The ref is the caller's, because WHEN it is set is screen-specific: both
   * set it just before the state change that adds the row, then consume it on
   * the commit that has the row in the DOM.
   */
  scrollPending: (pending: React.RefObject<Id | null>) => void;
}

export function useRowNodes<Id extends string>(): RowNodes<Id> {
  const nodes = useRef(new Map<Id, HTMLElement>());

  const setNode = useCallback((id: Id, el: HTMLElement | null) => {
    if (el) nodes.current.set(id, el);
    else nodes.current.delete(id);
  }, []);

  const nodeFor = useCallback((id: Id) => nodes.current.get(id), []);

  const scrollPending = useCallback((pending: React.RefObject<Id | null>) => {
    const id = pending.current;
    if (id === null) return;
    nodes.current.get(id)?.scrollIntoView({ block: "nearest" });
    // Cleared whether or not the row was found: a pending id whose row never
    // arrived is stale, and holding it would fire on some later, unrelated
    // commit.
    pending.current = null;
  }, []);

  return { setNode, nodeFor, scrollPending };
}
