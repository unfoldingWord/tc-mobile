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
      onBlocked: () => {
        // This panel takes over the screen, which unmounts what is under it.
        // While work is held that would cost more than it explains — the
        // save-failure screen and each screen's own retry are the paths for
        // that — so it waits until nothing is in hand.
        if (!predicateRef.current()) setStatus("blocked");
      },
    };
    setUpgradeCoordinator(coordinator);
    return () => setUpgradeCoordinator(null);
  }, []);

  return status;
}
