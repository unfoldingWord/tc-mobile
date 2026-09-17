import { useEffect, useRef, useState } from "react";

import {
  setUpgradeCoordinator,
  type UpgradeCoordinator,
} from "@/lib/storage/db";

/**
 * What the database is doing to this copy of the app, when it is something the
 * person has to be told about.
 *
 *   ok            nothing to say
 *   blocked       another copy holds an older connection open, so this copy
 *                 cannot open the database at all
 *   reloadNeeded  this copy gave its connection up for another copy's upgrade
 *                 and cannot reopen: its build asks for the older version
 */
export type DatabaseStatus = "ok" | "blocked" | "reloadNeeded";

/**
 * Register the app as the storage layer's upgrade coordinator, and report what
 * came back.
 *
 * The judgement about unsaved work lives here rather than in `lib/storage`,
 * which cannot know what is on screen; the storage layer only says when the
 * question has to be answered. `holdsUnsavedWork` is called from inside a
 * `versionchange` handler, so it must answer synchronously — hence a plain
 * predicate rather than anything awaited.
 *
 * What comes back is the database's CONDITION, not an instruction to render.
 * `blocked` is reported the moment it happens and withdrawn if the other copy
 * closes on its own; whether a screen may be taken over to say so is the
 * caller's decision, and in `App` it waits for nothing to be held.
 */
export function useDatabaseStatus(
  holdsUnsavedWork: () => boolean
): DatabaseStatus {
  const [status, setStatus] = useState<DatabaseStatus>("ok");

  /**
   * The latest predicate, which the registration below reads through.
   *
   * The registration itself must NOT depend on the predicate's identity. An
   * effect keyed on it unregisters before it re-registers, and in that window
   * `blocking()` sees no coordinator and gives the connection away — precisely
   * when a take has just become held, because that is what changes the
   * predicate's identity in the first place. Registering once and reading the
   * answer through this ref closes the window entirely.
   */
  const predicateRef = useRef(holdsUnsavedWork);
  // In an effect, never during render: `react-hooks/refs`, and the same reason
  // behind it — nothing here is read while rendering.
  useEffect(() => {
    predicateRef.current = holdsUnsavedWork;
  }, [holdsUnsavedWork]);

  // Registered once, for as long as this hook is mounted, and unregistered only
  // on unmount.
  useEffect(() => {
    const coordinator: UpgradeCoordinator = {
      holdsUnsavedWork: () => predicateRef.current(),
      onYielded: () => setStatus("reloadNeeded"),
      // Recorded whether or not anything can be shown for it. WHEN to show the
      // panel is the caller's decision, because the panel takes the screen over
      // and unmounts what is under it — which must not happen while a take is
      // held. Deciding it here instead, by checking the predicate and dropping
      // the event when work is in hand, loses the fact permanently: `blocked`
      // fires once per open, and nothing re-reads storage when a take is
      // discarded (`performDiscardTake` returns without touching the database
      // when there is no orphan clip), so the app would go on showing an
      // ordinary screen over a database it cannot reach (Frank R1 P2).
      onBlocked: () => setStatus("blocked"),
      // And taken back down when the block ends on its own — the other copy
      // closed and the queued open came through. Never over `reloadNeeded`:
      // that one is this copy having given its connection away, which no
      // storage event undoes. Only a restart does.
      onUnblocked: () =>
        setStatus((current) => (current === "blocked" ? "ok" : current)),
    };
    setUpgradeCoordinator(coordinator);
    return () => setUpgradeCoordinator(null);
  }, []);

  return status;
}
