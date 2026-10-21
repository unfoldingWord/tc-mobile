import type { LicenceId } from "@/types/template";

/**
 * The display label of a licence a book carries (#1566, D5, S19): the words a
 * shared file's name and, later, its ID3 copyright frame (#252) show.
 *
 * Only the three Creative Commons ids have a label. `null` (not chosen yet)
 * and `all-rights-reserved` (or any id added later) have none, so no tag is
 * written for them whatever "Other" turns out to mean.
 *
 * @pivotpending #252 — the ID3 writer reads this label; until it lands only
 * `licenceTag` below calls it.
 */
export function licenceLabel(id: LicenceId | null): string | null {
  switch (id) {
    case "CC-BY-SA-4.0":
      return "CC BY-SA 4.0";
    case "CC-BY-4.0":
      return "CC BY 4.0";
    case "CC0-1.0":
      return "CC0 1.0";
    default:
      return null;
  }
}

/**
 * The tag a share filename carries before its extension: `" (CC BY-SA 4.0)"`,
 * or `""` when the licence has no label. ASCII only, so its length is its
 * UTF-8 byte count and a caller can reserve it from a label's budget.
 */
export function licenceTag(id: LicenceId | null): string {
  const label = licenceLabel(id);
  return label === null ? "" : ` (${label})`;
}
