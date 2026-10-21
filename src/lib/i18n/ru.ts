import type { Strings } from "@/lib/strings";

/**
 * The ru table: the keys this language has translated, and nothing else. A key
 * missing here reads from the English table (`buildTable`), and must be named
 * in `pending.ts` until it is translated (#1481).
 */
export const table: Partial<Strings> = {};
