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
 * Test-only helper (moved out of `src/lib/scripture/` in #818/#159, per the
 * DRI pick on that PR): no `src/` caller exists, and #253's own text does not
 * name `ParsedScope`/`parseScope`/`isValidScope`/`formatScope` as consumers —
 * AGENTS.md: an export with no issue behind it gets deleted, not tagged. This
 * grammar is kept because `tests/obs-catalog.test.ts` uses `parseScope` and
 * `isValidScope` as a real helper to check `obsFrameScope`'s output against
 * it, alongside `tests/scope.test.ts`'s own coverage. #253 can reintroduce a
 * `src/`-side version of this grammar if the Template Library actually needs
 * one.
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
