/**
 * The bundled language list the Export project language ask searches (#1492).
 *
 * The list is SIL's langtags (MIT; names and autonyms from Ethnologue), cut
 * down by `scripts/build-language-list.mjs` to a tag, an English name and an
 * autonym where known — ADR 0017. It is ~240 KB of JSON, so it is loaded by a
 * dynamic `import()` into a chunk of its own (the `lib/obs/catalog.ts`
 * pattern): app start never parses it, the service worker precaches the chunk
 * so it is there offline, and only the first language ask reads it.
 */

/** One language: its BCP 47 tag, English name and autonym (or `null`). */
export interface LanguageEntry {
  readonly tag: string;
  readonly name: string;
  readonly autonym: string | null;
}

/** An entry with its search keys folded once, at load. */
interface IndexedLanguage extends LanguageEntry {
  readonly keys: readonly string[];
}

export interface LanguageList {
  /** Which langtags release the list was built from. */
  readonly source: string;
  readonly entries: readonly IndexedLanguage[];
}

/** Lower case with accents removed, so "Francais" finds "français". */
export function foldForSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .trim();
}

/** The generated file's shape (`scripts/build-language-list.d.mts`). */
interface LanguageListFile {
  readonly source: string;
  readonly languages: readonly (readonly string[])[];
}

/** Turn the generated file into a searchable list. Pure, for the tests. */
export function indexLanguageList(file: LanguageListFile): LanguageList {
  return {
    source: file.source,
    entries: file.languages.map(([tag = "", name = "", autonym]) => ({
      tag,
      name,
      autonym: autonym ?? null,
      keys: [tag, name, autonym ?? ""].map(foldForSearch),
    })),
  };
}

let loading: Promise<LanguageList> | null = null;

/**
 * The list, loaded once. A failed load is not cached, so the next ask tries
 * again.
 *
 * @pivotpending #1492 — the language ask on Export project is the caller,
 * in the PR after this one.
 */
export function loadLanguageList(): Promise<LanguageList> {
  loading ??= import("@/data/language-list.json").then(
    (module) => indexLanguageList(module.default as LanguageListFile),
    (cause: unknown) => {
      loading = null;
      throw cause;
    }
  );
  return loading;
}

/**
 * How well an entry matches, lower is better, or `null` for no match: the tag
 * itself; a name or autonym that starts with the query; a word inside one that
 * does; a tag that starts with it; and anything that merely contains it.
 */
function rank(keys: readonly string[], query: string): number | null {
  const [tag = "", ...names] = keys;
  if (tag === query) return 0;
  if (names.some((n) => n.startsWith(query))) return 1;
  if (
    names.some((n) => n.split(/[\s\-(),’']+/u).some((w) => w.startsWith(query)))
  )
    return 2;
  if (tag.startsWith(query)) return 3;
  if (keys.some((k) => k.includes(query))) return 4;
  return null;
}

/**
 * The entries matching `query` by tag, English name or autonym, ignoring case
 * and accents, best first and in list order within a rank; at most `limit`
 * of them. `total` counts every match, so the caller can say there are more.
 * An empty query matches everything, in list order.
 *
 * @pivotpending #1492 — the language ask on Export project is the caller,
 * in the PR after this one.
 */
export function searchLanguages(
  list: LanguageList,
  query: string,
  limit: number
): { readonly matches: readonly LanguageEntry[]; readonly total: number } {
  const q = foldForSearch(query);
  if (q === "") {
    return {
      matches: list.entries.slice(0, limit),
      total: list.entries.length,
    };
  }
  const ranked: { entry: IndexedLanguage; rank: number; at: number }[] = [];
  list.entries.forEach((entry, at) => {
    const r = rank(entry.keys, q);
    if (r !== null) ranked.push({ entry, rank: r, at });
  });
  ranked.sort((a, b) => a.rank - b.rank || a.at - b.at);
  return {
    matches: ranked.slice(0, limit).map((r) => r.entry),
    total: ranked.length,
  };
}
