/**
 * The book cover-colour palette, and how a book resolves to one (#957, from
 * #937's D7/D8 — "people choose a colour", "a palette of 8–12").
 *
 * ## The palette is final
 *
 * Ten keys, the requirements owner's round-2 pick (D8b), decided 2026-09-25
 * and recorded on #937 (issuecomment-5837859829): the twelve round-1
 * candidates minus `mulberry` and `pine`. Nothing about the SHAPE below
 * assumes the count stays ten forever, though — {@link resolveCoverKey}
 * still treats a stored key it does not recognise as ordinary, expected
 * input rather than a bug, which is exactly what lets a book coloured
 * `"pine"` under the round-1 list — or by any future trim — keep resolving to
 * SOMETHING sane rather than crashing or freezing this file at today's count.
 *
 * ## Why the hex values live here and not in a CSS layer-2 role
 *
 * AGENTS.md's CSS-layer rule is that a component reaches colour only through a
 * layer-2 semantic ROLE, never a layer-1 primitive directly — the rule exists
 * so a themed colour can be redefined per theme without hunting down every
 * component that painted it. A book's cover colour is not that kind of
 * colour: it is the one thing about it that must NOT change with the theme —
 * "forest" has to read as the same green in both, or the whole point of
 * picking a colour to tell two books apart is lost the moment a theme switch
 * reshuffles which book looks like what. It is also not a small, enumerable
 * set of MEANINGS (success/warn/live, the roles layer 2 actually holds) but a
 * palette a later PR can retune, so it does not belong in layer 1 either —
 * that would make trimming it a CSS-file edit alongside this one, in the one
 * layer AGENTS.md says nothing here can check (`knip`'s own words: ".css —
 * Compiled extension excluded by project"). Keeping key → hex as plain `lib/`
 * data keeps it one edit, keeps it typed, and keeps it reachable from a Node
 * test. `components/cover-picker.tsx` paints the swatch fill from this table
 * directly (inline style), and reaches for a layer-2 role only for the
 * THEMED part of its own markup — the selected ring — which is a UI decision
 * that does vary sensibly by theme.
 *
 * This is a judgement call, not a rule quoted from AGENTS.md; the rule itself
 * is scoped to component and app-level colour, and its own stated purpose
 * (redefinable-per-theme roles) is the reason this specific palette reads as
 * the exception rather than a leak.
 *
 * ## DOM-free
 *
 * Pure data and pure functions, like the rest of `lib/`: no `window`, no
 * `document`, nothing `typecheck:lib`'s no-DOM-lib compile would reject.
 */

import type { Book } from "@/types/domain";

/**
 * The ten final keys (#937 D8b, decided 2026-09-25).
 *
 * The Books lane (#942) calls {@link resolveCoverKey} and
 * {@link coverColourHex}; the O4 book menu (#949) mounts the picker.
 */
export type CoverColourKey =
  | "amber"
  | "teal"
  | "plum"
  | "forest"
  | "brick"
  | "slate"
  | "rose"
  | "olive"
  | "rust"
  | "cocoa";

/**
 * Key → hex. Order here is display order in {@link COVER_COLOUR_KEYS} and in
 * the picker row — the order #937 listed the final ten in.
 */
const PALETTE: Record<CoverColourKey, string> = {
  amber: "#b87c22",
  teal: "#11796d",
  plum: "#7a3570",
  forest: "#2f6b3a",
  brick: "#a23b2a",
  slate: "#4b5a6b",
  rose: "#b0406a",
  olive: "#6b6a1e",
  rust: "#b4521c",
  cocoa: "#6e4a2e",
};

/**
 * Every key, in display order.
 *
 * The picker (`components/cover-picker.tsx`) walks this to lay out its
 * swatch row.
 */
export const COVER_COLOUR_KEYS: readonly CoverColourKey[] = Object.keys(
  PALETTE
) as CoverColourKey[];

/**
 * The hex a key paints.
 *
 * The Books screen's cover (#942) reads it into an inline custom property;
 * the picker reads it straight into a swatch's inline fill style.
 */
export function coverColourHex(key: CoverColourKey): string {
  return PALETTE[key];
}

/** Whether a stored string is one of today's live palette keys. */
function isCoverColourKey(key: string): key is CoverColourKey {
  return Object.prototype.hasOwnProperty.call(PALETTE, key);
}

/**
 * A stable, deterministic hash of a string to an unsigned 32-bit integer
 * (FNV-1a). Used only to pick a fallback palette index — this is not a
 * cryptographic or collision-resistant hash, and does not need to be one.
 *
 * Deterministic across calls and across processes: the same id always
 * produces the same number, which is the property {@link resolveCoverKey}'s
 * fallback depends on — a book with no chosen colour must look the same
 * colour every time it is opened, not re-roll on every render.
 *
 * Not exported: {@link resolveCoverKey} is the one public surface for "which
 * colour does this book get" and this is its private working — kept testable
 * through that surface (see `tests/cover-colour.test.ts`'s spread/stability
 * cases) rather than as a second thing a caller could reach for and diverge
 * on.
 */
function stableHash(input: string): number {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return hash >>> 0; // unsigned
}

/**
 * The fallback key for a book with no chosen colour (or an unrecognised
 * one): a stable hash of its id, modulo the live palette. Pure and
 * synchronous — the same id always resolves to the same key, for as long as
 * the palette's SIZE does not change; trimming or reordering the palette
 * changes a fresh book's roll but never crashes on an old one.
 */
function fallbackKey(bookId: string): CoverColourKey {
  const index = stableHash(bookId) % COVER_COLOUR_KEYS.length;
  // `%` of an unsigned hash by a positive length is always in range; the
  // non-null assertion is the type-system's own guarantee, not a hope.
  return COVER_COLOUR_KEYS[index]!;
}

/**
 * Resolve a book to the cover colour it actually shows: its own chosen key
 * when it has one that is still in the live palette, otherwise a fallback
 * derived from its id.
 *
 * A stored key that no longer names a live palette entry — the palette was
 * trimmed after this book picked it — is treated exactly like no key at all,
 * rather than thrown or painted as a broken swatch: {@link isCoverColourKey}
 * is the one gate between "trust the stored value" and "derive one," and it
 * is the only branch that can ever return something other than
 * `book.coverColourKey`.
 *
 * Takes the two fields it needs rather than a whole `Book`, so a caller
 * building one (a fresh row not yet round-tripped through storage) or a test
 * does not need to construct a complete record.
 *
 * This is the one function #942's book rows call for "which colour does
 * this book show", and the one #943's new-book sheet and #949's book menu
 * are each expected to call.
 */
export function resolveCoverKey(
  book: Pick<Book, "id" | "coverColourKey">
): CoverColourKey {
  if (book.coverColourKey !== null && isCoverColourKey(book.coverColourKey)) {
    return book.coverColourKey;
  }
  return fallbackKey(book.id);
}
