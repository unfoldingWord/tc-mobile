import type { TemplatePackage, TemplateTitleTable } from "@/types/template";
import { loadObsTemplate } from "./obs";
import { parseTemplatePackage, parseTemplateTitleTable } from "./validate";

/**
 * The build's template package list (#1451, part of #1450). Which packages a
 * build ships is this list and nothing else: the library hook and the picker
 * read whatever it holds, so a package from a new source is added to a build
 * by adding its loader here, with no change to app code. The direction this
 * follows is the DRI's, recorded on #1451 on 2026-10-19: code that is
 * "modular and capable of adapting to other sources that might be included".
 *
 * Open Bible Stories is the only package shipped today.
 */

/** A validated package and its title tables, one row of the library. */
export interface TemplateEntry {
  readonly pkg: TemplatePackage;
  readonly titles: readonly TemplateTitleTable[];
}

/**
 * One source's loader. It hands back its package and title tables in the
 * contract's shape; the list validates both, so a source cannot put a shape
 * the contract refuses in front of the picker.
 */
type TemplateSource = () => Promise<{
  readonly pkg: unknown;
  readonly titles: readonly unknown[];
}>;

const PACKAGES: readonly TemplateSource[] = [loadObsTemplate];

function toEntry(raw: Awaited<ReturnType<TemplateSource>>): TemplateEntry {
  const pkg = parseTemplatePackage(raw.pkg);
  return {
    pkg,
    titles: raw.titles.map((t) => parseTemplateTitleTable(t, pkg)),
  };
}

/**
 * Load every package on the list, in list order. A package that fails to
 * load, breaks the contract, or repeats an id already listed is left out and
 * its cause handed back in `failures`; it never hides the others. The caller
 * routes each failure to the problem report (`lib/` has no reporter).
 */
export async function loadTemplateEntries(
  list: readonly TemplateSource[] = PACKAGES
): Promise<{
  readonly entries: readonly TemplateEntry[];
  readonly failures: readonly unknown[];
}> {
  // An async wrapper, so a loader that throws before returning a promise is
  // one rejected package rather than a throw out of this call.
  const settled = await Promise.allSettled(
    list.map(async (load) => toEntry(await load()))
  );
  const entries: TemplateEntry[] = [];
  const failures: unknown[] = [];
  const ids = new Set<string>();
  for (const result of settled) {
    if (result.status === "rejected") {
      failures.push(result.reason);
    } else if (ids.has(result.value.pkg.id)) {
      failures.push(
        new Error(`template package "${result.value.pkg.id}" is listed twice`)
      );
    } else {
      ids.add(result.value.pkg.id);
      entries.push(result.value);
    }
  }
  return { entries, failures };
}
