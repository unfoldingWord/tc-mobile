import { useEffect, useState } from "react";

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

  // Re-registered whenever the predicate changes identity, rather than held
  // through a ref: inside a versionchange handler the only useful answer is the
  // current one, and a stale closure would be answering about a take that has
  // since been saved — or missing one just recorded. The caller decides how
  // often that is by how it memoises the predicate; the registration itself is
  // two assignments.
  useEffect(() => {
    const coordinator: UpgradeCoordinator = {
      holdsUnsavedWork,
      onYielded: () => setStatus("reloadNeeded"),
      onBlocked: () => {
        // This panel takes over the screen, which unmounts what is under it.
        // While work is held that would cost more than it explains — the
        // save-failure screen and each screen's own retry are the paths for
        // that — so it waits until nothing is in hand.
        if (!holdsUnsavedWork()) setStatus("blocked");
      },
    };
    setUpgradeCoordinator(coordinator);
    return () => setUpgradeCoordinator(null);
  }, [holdsUnsavedWork]);

  return status;
}
