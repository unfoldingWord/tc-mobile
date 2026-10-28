/**
 * The pure core of `npm run i18n:pending` (#1481): the new text of
 * `src/lib/i18n/pending.ts` from its current text and the tables. It reads
 * and writes nothing, so `tests/i18n-pending-core.test.ts` drives it with
 * fixture strings; `i18n-pending.mjs` loads the tables, calls this and
 * formats the result.
 *
 * Every anchor is checked (#1747, George r1 #1531). The file is cut at the
 * one `export const PENDING`, the first `};` line after it, and the one
 * `ENFORCE_COMPLETE` declaration after that. Only the object between the
 * first two is replaced; the text around it is kept as it is, and the gate is
 * written from the value the file declares. Any anchor missing, repeated or
 * out of order throws, so the script fails rather than write a damaged file.
 */

const PENDING_START = "export const PENDING";
const PENDING_END = "\n};\n";
const ENFORCE = /export const ENFORCE_COMPLETE = (true|false);/g;

/**
 * `previous` with its `PENDING` object rebuilt from `overrides` (tag ->
 * that language's own table) over the English `keys` that may be pending.
 */
export function rewritePending(previous, overrides, keys) {
  const start = previous.indexOf(PENDING_START);
  if (start === -1) throw new Error("pending.ts: no PENDING declaration");
  if (previous.indexOf(PENDING_START, start + 1) !== -1)
    throw new Error("pending.ts: more than one PENDING declaration");
  const close = previous.indexOf(PENDING_END, start);
  if (close === -1) throw new Error("pending.ts: PENDING has no closing };");
  const end = close + PENDING_END.length;

  const gates = [...previous.matchAll(ENFORCE)];
  if (gates.length !== 1)
    throw new Error(
      `pending.ts: ${gates.length} ENFORCE_COMPLETE declarations, not one`
    );
  const [gate] = gates;
  if (gate.index < end)
    throw new Error("pending.ts: ENFORCE_COMPLETE is not after PENDING");

  const rows = Object.keys(overrides)
    .sort()
    .map((tag) => {
      const own = overrides[tag];
      const value =
        Object.keys(own).length === 0
          ? '"all"'
          : JSON.stringify(keys.filter((key) => !Object.hasOwn(own, key)));
      return `  ${JSON.stringify(tag)}: ${value},`;
    });
  const body = `${PENDING_START}: Readonly<Record<string, readonly string[] | "all">> = {\n${rows.join("\n")}\n};\n`;
  return (
    previous.slice(0, start) +
    body +
    previous.slice(end, gate.index) +
    `export const ENFORCE_COMPLETE = ${gate[1]};` +
    previous.slice(gate.index + gate[0].length)
  );
}
