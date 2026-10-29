import type { TemplatePackage, TemplateTitleTable } from "@/types/template";
import { loadBakedTemplates } from "./baked";
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
 * Open Bible Stories ships in every build. The baked packages follow it, in
 * the order `templates/manifest.json` lists them; a production build bakes
 * none today (`scripts/bake-template-packages.mjs` says which a build takes).
 */

/** A validated package and its title tables, one row of the library. */
export interface TemplateEntry {
  readonly pkg: TemplatePackage;
  readonly titles: readonly TemplateTitleTable[];
}

/** A package and its title tables as a source hands them over, unchecked. */
interface RawTemplate {
  readonly pkg: unknown;
  readonly titles: readonly unknown[];
}

/**
 * One source's loader. It hands back one package, or several, with their
 * title tables in the contract's shape; the list validates each, so a source
 * cannot put a shape the contract refuses in front of the picker.
 */
type TemplateSource = () => Promise<RawTemplate | readonly RawTemplate[]>;

const PACKAGES: readonly TemplateSource[] = [
  loadObsTemplate,
  loadBakedTemplates,
];

function toEntry(raw: RawTemplate): TemplateEntry {
  const pkg = parseTemplatePackage(raw.pkg);
  return {
    pkg,
    titles: raw.titles.map((t) => parseTemplateTitleTable(t, pkg)),
  };
}

/**
 * Load every package on the list, in list order. A source that fails to load
 * is left out; so is a package that breaks the contract or repeats an id
 * already listed, without its siblings from the same source. Each cause is
 * handed back in `failures`; it never hides the others. The caller routes
 * each failure to the problem report (`lib/` has no reporter).
 */
export async function loadTemplateEntries(
  list: readonly TemplateSource[] = PACKAGES
): Promise<{
  readonly entries: readonly TemplateEntry[];
  readonly failures: readonly unknown[];
}> {
  // An async wrapper, so a loader that throws before returning a promise is
  // one rejected package rather than a throw out of this call.
  const settled = await Promise.allSettled(list.map(async (load) => load()));
  const entries: TemplateEntry[] = [];
  const failures: unknown[] = [];
  const ids = new Set<string>();
  for (const result of settled) {
    if (result.status === "rejected") {
      failures.push(result.reason);
      continue;
    }
    const raws: readonly RawTemplate[] = Array.isArray(result.value)
      ? result.value
      : [result.value];
    for (const raw of raws) {
      let entry: TemplateEntry;
      try {
        entry = toEntry(raw);
      } catch (cause) {
        failures.push(cause);
        continue;
      }
      if (ids.has(entry.pkg.id)) {
        failures.push(
          new Error(`template package "${entry.pkg.id}" is listed twice`)
        );
      } else {
        ids.add(entry.pkg.id);
        entries.push(entry);
      }
    }
  }
  return { entries, failures };
}
