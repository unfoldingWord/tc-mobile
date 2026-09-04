/**
 * Scripture Burrito ingredient-scope strings.
 *
 * Grammar (docs/research/prior-art.md §4):
 *
 *   ""          whole book
 *   "2"         whole chapter
 *   "2-4"       chapter range
 *   "2:1"       single verse
 *   "2:1-13"    verse range within one chapter
 *   "2:1-3:4"   cross-chapter span
 *
 * Parsing these is the difference between emitting a burrito that validates
 * and one that merely looks right, so the grammar is implemented once, here,
 * and unit-tested.
 *
 * This is the same grammar `SegmentRef.scope` is typed on
 * (`src/types/domain.ts:48`) — not a Burrito *export* concern (out of Phase 1,
 * AGENTS.md item 5), but the internal addressing a segment's optional
 * scripture reference already uses today. `obsFrameScope`
 * (`src/lib/obs/catalog.ts`) builds these strings for OBS; this module is
 * where a Bible-book template (B7's Template Library, #33) would build and
 * read the same strings for a scripture-derived segment.
 */

/**
 * @pivotpending No caller yet — see the module docblock above. B7 (#33) is
 * the writer of `SegmentRef.scope`, which this is the parsed form of.
 */
export interface ParsedScope {
  readonly startChapter: number;
  /** `null` when the scope addresses whole chapters rather than verses. */
  readonly startVerse: number | null;
  readonly endChapter: number;
  readonly endVerse: number | null;
}

const CV = /^(\d+)(?::(\d+))?$/;

/**
 * Parse a scope string. Returns `null` for the whole-book scope (`""`) and
 * throws on anything that is not valid grammar — a malformed scope must not
 * silently become a plausible-looking wrong reference.
 *
 * @pivotpending No caller yet — see the module docblock above (#33).
 */
export function parseScope(scope: string): ParsedScope | null {
  const trimmed = scope.trim();
  if (trimmed === "") return null;

  const [rawStart, rawEnd, ...rest] = trimmed.split("-");
  if (rest.length > 0) throw new Error(`Malformed scope: "${scope}"`);

  const start = CV.exec(rawStart ?? "");
  if (!start) throw new Error(`Malformed scope: "${scope}"`);

  const startChapter = Number(start[1]);
  const startVerse = start[2] === undefined ? null : Number(start[2]);

  if (rawEnd === undefined) {
    return {
      startChapter,
      startVerse,
      endChapter: startChapter,
      endVerse: startVerse,
    };
  }

  const end = CV.exec(rawEnd);
  if (!end) throw new Error(`Malformed scope: "${scope}"`);

  // "2:1-13" means verses 1..13 of chapter 2 — the bare number after the dash
  // is a verse, not a chapter, whenever the start named a verse.
  const endNamesVerse = end[2] !== undefined;
  const endChapter =
    endNamesVerse || startVerse === null ? Number(end[1]) : startChapter;
  const endVerse = endNamesVerse
    ? Number(end[2])
    : startVerse === null
      ? null
      : Number(end[1]);

  const result: ParsedScope = {
    startChapter,
    startVerse,
    endChapter,
    endVerse,
  };
  if (
    result.endChapter < result.startChapter ||
    (result.endChapter === result.startChapter &&
      result.endVerse !== null &&
      result.startVerse !== null &&
      result.endVerse < result.startVerse)
  ) {
    throw new Error(`Scope ends before it starts: "${scope}"`);
  }
  return result;
}

/**
 * @pivotpending No caller yet — see the module docblock above (#33).
 */
export function isValidScope(scope: string): boolean {
  try {
    parseScope(scope);
    return true;
  } catch {
    return false;
  }
}

/**
 * Render a parsed scope back to canonical string form.
 *
 * @pivotpending No caller yet — see the module docblock above (#33).
 */
export function formatScope(parsed: ParsedScope | null): string {
  if (parsed === null) return "";
  const { startChapter, startVerse, endChapter, endVerse } = parsed;

  if (startVerse === null) {
    return startChapter === endChapter
      ? `${startChapter}`
      : `${startChapter}-${endChapter}`;
  }
  if (startChapter === endChapter) {
    return startVerse === endVerse
      ? `${startChapter}:${startVerse}`
      : `${startChapter}:${startVerse}-${endVerse}`;
  }
  return `${startChapter}:${startVerse}-${endChapter}:${endVerse}`;
}
