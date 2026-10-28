import { useCallback, useEffect, useRef, useState } from "react";

import { reportFailure } from "./report-failure";
import { failureKey, isBookNameTaken, type FailureKey } from "./save-failure";
import { bumpStoragePressure } from "./use-storage-pressure";
import {
  createBookFromPlan,
  type TemplateBookIds,
} from "@/lib/storage/template-book";
import { mintTemplateIds, titleResolverFor } from "@/lib/templates/library";
import {
  loadTemplateEntries,
  type TemplateEntry,
} from "@/lib/templates/packages";
import { planBookFromTemplate, type BookPlan } from "@/lib/templates/plan";

/**
 * The Template Library's data and create (#246, part of #1450). The entries
 * are whatever the build's package list holds (`lib/templates/packages.ts`,
 * #1451); this hook names no package, so a package added to the list reaches
 * the picker with no change here.
 */

export type { TemplateEntry };

/**
 * One tap's worth of ids and plan. Minted once per intent and reused on a
 * retry, so a create whose outcome was unknown replays as the same create
 * (`createBookFromPlan` is idempotent on these ids).
 */
export interface TemplateIntent {
  readonly plan: BookPlan;
  readonly ids: TemplateBookIds;
}

export function newIntent(
  entry: TemplateEntry,
  now = Date.now()
): TemplateIntent {
  const plan = planBookFromTemplate(
    entry.pkg,
    titleResolverFor(entry.titles[0]),
    now
  );
  return { plan, ids: mintTemplateIds(plan) };
}

export type CreateOutcome =
  { readonly ok: true } | { readonly ok: false; readonly key: FailureKey };

/**
 * Write the book under `name`. A name another book holds is refused by the
 * store (U4b) and comes back as the `bookNameTaken` key, which the picker
 * shows as the existing Notice; it is the translator's to fix, so it is not
 * written to the problem report.
 */
export async function createFromEntry(
  intent: TemplateIntent,
  name: string
): Promise<CreateOutcome> {
  try {
    await createBookFromPlan(intent.plan, intent.ids, name);
    bumpStoragePressure();
    return { ok: true };
  } catch (cause) {
    if (!isBookNameTaken(cause)) reportFailure(cause, "template-create");
    return { ok: false, key: failureKey(cause, "saveFailed") };
  }
}

export type TemplateLibraryStatus = "loading" | "ready" | "failed";

/**
 * The entries, loaded when the library opens, and a latched create. The latch
 * is taken before the first await, so a second tap while the write is in
 * flight writes nothing and answers `null`.
 */
export function useTemplateLibrary(
  open: boolean,
  onCreated: () => void,
  onBusyChange?: (busy: boolean) => void
) {
  const [status, setStatus] = useState<TemplateLibraryStatus>("loading");
  const [entries, setEntries] = useState<readonly TemplateEntry[]>([]);
  const [creating, setCreating] = useState(false);
  const latch = useRef(false);
  const intent = useRef<{
    entry: TemplateEntry;
    intent: TemplateIntent;
  } | null>(null);
  // Every open loads again, so every open reads "loading" until that load
  // settles: a reopen must not show the last load's failure, or nothing, while
  // the list is read (#1655 follow-up, #1747). Adjusted during render on the
  // rising edge, so the effect below still sets no state before its await.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setStatus("loading");
  }

  useEffect(() => {
    if (!open) {
      // Every close forgets the held intent, system Back included: Back
      // dismisses the layer by `open` falling, without the picker's `close`.
      intent.current = null;
      return;
    }
    let live = true;
    // Deferred past the effect body: no state is set before the first await.
    // A package that fails to load is reported and left out; the library is
    // failed only when nothing loaded at all.
    void loadTemplateEntries().then(
      ({ entries: loaded, failures }) => {
        for (const cause of failures) reportFailure(cause, "template-load");
        if (!live) return;
        setEntries(loaded);
        setStatus(
          loaded.length === 0 && failures.length > 0 ? "failed" : "ready"
        );
      },
      (cause: unknown) => {
        reportFailure(cause, "template-load");
        if (live) setStatus("failed");
      }
    );
    return () => {
      live = false;
    };
  }, [open]);

  /** Forget the held intent (Cancel, or the library closing). */
  const reset = useCallback(() => {
    intent.current = null;
  }, []);

  const create = useCallback(
    async (
      entry: TemplateEntry,
      name: string
    ): Promise<CreateOutcome | null> => {
      // A create already in flight answers this one: `null` is "nothing
      // happened", which the caller shows as nothing. It is not a failure.
      if (latch.current) return null;
      latch.current = true;
      onBusyChange?.(true);
      setCreating(true);
      let outcome: CreateOutcome;
      try {
        if (intent.current?.entry !== entry) {
          intent.current = { entry, intent: newIntent(entry) };
        }
        outcome = await createFromEntry(intent.current.intent, name);
      } finally {
        // Released on a throw too: this picker never unmounts, so a stuck
        // latch would hold the create and refuse Back for the session.
        latch.current = false;
        onBusyChange?.(false);
        setCreating(false);
      }
      if (outcome.ok) {
        intent.current = null;
        onCreated();
      }
      return outcome;
    },
    [onCreated, onBusyChange]
  );

  return { status, entries, creating, create, reset };
}
