import { readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";

import type { Strings } from "@/lib/strings";
import { stringsEn } from "@/lib/strings";

/**
 * The checks behind `tests/strings-locale-coverage.test.ts` (#1481), as
 * functions that return the problems they find, so the test can run each one
 * on the real tables and on a fixture carrying exactly one defect.
 */

type Pending = readonly string[] | "all";

const ENGLISH_KEYS = Object.keys(stringsEn);

/** Missing, extra, mistyped and stale-pending keys of one locale. */
export function keyProblems(
  tag: string,
  overrides: Partial<Strings>,
  pending: Pending,
  enforceComplete: boolean
): string[] {
  const problems: string[] = [];
  const own = Object.keys(overrides);
  for (const key of own) {
    if (!ENGLISH_KEYS.includes(key)) problems.push(`${tag}: extra key ${key}`);
    else if (
      typeof (overrides as Record<string, unknown>)[key] !==
      typeof (stringsEn as Record<string, unknown>)[key]
    )
      problems.push(`${tag}: ${key} changes between text and function`);
  }
  const missing = ENGLISH_KEYS.filter((key) => !own.includes(key));
  if (pending === "all") {
    for (const key of own)
      if (ENGLISH_KEYS.includes(key))
        problems.push(`${tag}: pending key ${key} is present`);
  } else {
    for (const key of missing)
      if (!pending.includes(key))
        problems.push(`${tag}: key ${key} is neither present nor pending`);
    for (const key of pending) {
      if (!ENGLISH_KEYS.includes(key))
        problems.push(`${tag}: pending key ${key} is not an English key`);
      else if (own.includes(key))
        problems.push(`${tag}: pending key ${key} is present`);
    }
  }
  if (enforceComplete && missing.length > 0)
    problems.push(`${tag}: ${missing.length} keys missing at release`);
  return problems;
}

/** The parameter types of every function entry, read from `strings.ts`. */
function signatures(): Map<string, string[]> {
  const file = path.resolve(import.meta.dirname, "../src/lib/strings.ts");
  const source = ts.createSourceFile(
    "strings.ts",
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true
  );
  const out = new Map<string, string[]>();
  source.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) return;
    for (const decl of node.declarationList.declarations) {
      if (decl.name.getText() !== "stringsEn") continue;
      let init = decl.initializer;
      while (init && ts.isAsExpression(init)) init = init.expression;
      if (!init || !ts.isObjectLiteralExpression(init)) continue;
      for (const prop of init.properties) {
        const fn = ts.isMethodDeclaration(prop)
          ? prop
          : ts.isPropertyAssignment(prop) &&
              (ts.isArrowFunction(prop.initializer) ||
                ts.isFunctionExpression(prop.initializer))
            ? prop.initializer
            : undefined;
        if (!fn || !prop.name) continue;
        out.set(
          prop.name.getText(),
          fn.parameters.map(
            (p) => (p.dotDotDotToken ? "..." : "") + (p.type?.getText() ?? "?")
          )
        );
      }
    }
  });
  return out;
}

const SIGNATURES = signatures();

/** The function entries of `English`, so a test can floor what it covers. */
export const FUNCTION_ENTRIES = [...SIGNATURES.keys()];

/**
 * Every argument vector worth trying for `name`: numbers all `n` (or, when
 * `distinct`, `n` plus their position, so parity can tell two counts apart),
 * strings a sentinel each, booleans in every combination. A type this does not
 * know throws, so a new parameter type cannot slip past unexercised.
 */
export function argVectors(
  name: string,
  n: number,
  distinct = false
): unknown[][] {
  const types = SIGNATURES.get(name);
  if (!types) throw new Error(`no function entry ${name}`);
  let vectors: unknown[][] = [[]];
  const push = (values: readonly unknown[]): void => {
    vectors = vectors.flatMap((v) => values.map((x) => [...v, x]));
  };
  types.forEach((type, i) => {
    if (type === "...readonly string[]") {
      push(["SENTa" + i]);
      push(["SENTb" + i]);
    } else if (type === "number" || type === "number | null")
      push([distinct ? n + i : n]);
    else if (type === "string" || type === "string | null") push(["SENT" + i]);
    else if (type === "boolean") push([true, false]);
    else if (type === "RestartSubject") push(["recording"]);
    else throw new Error(`${name}: unknown parameter type ${type}`);
  });
  return vectors;
}

export function call(table: Strings, name: string, args: unknown[]): string {
  const entry = (table as unknown as Record<string, unknown>)[name];
  return (entry as (...a: unknown[]) => string).apply(table, args);
}

/**
 * `table` with every function entry but `name` wrapped so the `plural()` forms
 * it records are dropped when it returns: an entry is checked for its own
 * forms, not for those of an entry it calls through `this`, which is checked
 * on its own row (or is still pending).
 */
function isolate(
  table: Strings,
  name: string,
  recorded: Array<Record<string, string>>
): Strings {
  const out: Record<string, unknown> = { ...table };
  for (const [key, value] of Object.entries(table)) {
    if (key === name || typeof value !== "function") continue;
    const fn = value as (...a: unknown[]) => unknown;
    out[key] = function (this: unknown, ...a: unknown[]): unknown {
      const mark = recorded.length;
      try {
        return fn.apply(this, a);
      } finally {
        recorded.length = mark;
      }
    };
  }
  return out as unknown as Strings;
}

/** The counts every plural entry is exercised with (#1481). */
const COUNTS = [0, 1, 2, 3, 5, 11, 21, 100, 1_000_000];

/**
 * Plural forms keyed by the categories the locale needs. `recorded` is the
 * list `plural` is spied into (the test owns the mock); this clears it, runs
 * every entry the locale supplies itself, and reports forms that miss a
 * category `Intl.PluralRules(tag)` reports.
 */
export function pluralProblems(
  tag: string,
  table: Strings,
  own: readonly string[],
  recorded: Array<Record<string, string>>
): string[] {
  const needed = new Intl.PluralRules(tag).resolvedOptions()
    .pluralCategories as string[];
  const problems = new Set<string>();
  for (const name of own) {
    if (!SIGNATURES.has(name)) continue;
    const isolated = isolate(table, name, recorded);
    for (const n of COUNTS)
      for (const args of argVectors(name, n)) {
        recorded.length = 0;
        call(isolated, name, args);
        for (const forms of recorded)
          for (const category of needed)
            if (!(category in forms))
              problems.add(`${tag}: ${name} has no "${category}" form`);
      }
  }
  return [...problems].sort();
}

/**
 * Argument parity: every sentinel the English entry's output carries must be
 * in the locale's output for the same arguments, so a translator cannot drop
 * `{name}` or `${name}`. English is the baseline, so an argument English
 * itself leaves out is not demanded.
 */
export function parityProblems(
  tag: string,
  table: Strings,
  own: readonly string[]
): string[] {
  const problems = new Set<string>();
  for (const name of own) {
    if (!SIGNATURES.has(name)) continue;
    for (const args of argVectors(name, 4242, true)) {
      const english = call(stringsEn, name, args);
      const mine = call(table, name, args);
      for (const arg of args) {
        const text = String(arg);
        if (
          (typeof arg === "string" || typeof arg === "number") &&
          english.includes(text) &&
          !mine.includes(text)
        )
          problems.add(`${tag}: ${name} drops ${text}`);
      }
    }
  }
  return [...problems].sort();
}
