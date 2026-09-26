/**
 * The phone check's memory ceiling (#1009): how much PCM this phone can hold
 * before an allocation fails or the page is killed.
 *
 * Opt-in and run last, because the likely end on a small phone is not a
 * catchable `RangeError` but the WebView reloading the page. So progress is
 * written BEFORE each step: if the page dies mid-step, the next visit reads
 * the breadcrumb and reports the last total that was allocated and survived.
 *
 * Pure: the allocator, the breadcrumb store and the yield are injected, so
 * this runs in Node. The browser side (`sessionStorage`, real `Int16Array`s)
 * is `hooks/phone-check-probes.ts`.
 */
import type { AllocationResult } from "./report";

/** The step size, in MB, and the ceiling the check stops at (#1009). */
const ALLOCATION_STEP_MB = 25;
const ALLOCATION_LIMIT_MB = 400;

/** Cumulative totals, in MB: 25, 50, … 400. */
export function allocationSteps(
  stepMb: number = ALLOCATION_STEP_MB,
  limitMb: number = ALLOCATION_LIMIT_MB
): number[] {
  const steps: number[] = [];
  for (let total = stepMb; total <= limitMb; total += stepMb) steps.push(total);
  return steps;
}

/**
 * What is written before each step: the total about to be tried, and the last
 * total that succeeded. Both, so a reload reports the number #1009 asks for
 * (last succeeded) and can still say which step killed the page.
 */
export interface AllocationBreadcrumb {
  readonly attemptingMb: number;
  readonly lastOkMb: number;
}

export function serializeBreadcrumb(crumb: AllocationBreadcrumb): string {
  return JSON.stringify(crumb);
}

/**
 * Read a breadcrumb back. Anything that is not one — absent, truncated,
 * written by some other version — is "no prior attempt", never a throw: this
 * runs on the screen's first render, and a bad value there must not take the
 * screen down.
 */
export function parseBreadcrumb(
  raw: string | null
): AllocationBreadcrumb | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    // Not JSON: treated as no prior attempt, which is what the docblock says.
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { attemptingMb, lastOkMb } = value as Record<string, unknown>;
  if (!isWholeMb(attemptingMb) || !isWholeMb(lastOkMb)) return null;
  return { attemptingMb, lastOkMb };
}

function isWholeMb(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

/** The report for a breadcrumb left behind by a page that went away. */
export function reloadedResult(crumb: AllocationBreadcrumb): AllocationResult {
  return {
    kind: "reloaded",
    lastOkMb: crumb.lastOkMb,
    attemptingMb: crumb.attemptingMb,
  };
}

export interface AllocationDeps {
  /** Allocate (and touch) `mb` more MB, kept alive until the run ends. Throws on failure. */
  readonly allocate: (mb: number) => void;
  /** Write the breadcrumb, or clear it with `null`. */
  readonly writeBreadcrumb: (crumb: AllocationBreadcrumb | null) => void;
  /** Give the page a turn between steps so progress can paint. */
  readonly yieldTurn: () => Promise<void>;
  /** Told each total as it is about to be tried. */
  readonly onStep?: (attemptingMb: number) => void;
  readonly steps?: readonly number[];
}

/**
 * Step through the totals, writing the breadcrumb before each one.
 *
 * Ends by clearing the breadcrumb on every path that returns — a completed
 * run and a caught failure both have their answer in hand, and a crumb left
 * behind would be read on the next visit as a reload that never happened.
 * Only a page that dies mid-step leaves one.
 */
export async function runAllocationSteps(
  deps: AllocationDeps
): Promise<AllocationResult> {
  const steps = deps.steps ?? allocationSteps();
  let lastOkMb = 0;
  try {
    for (const total of steps) {
      deps.writeBreadcrumb({ attemptingMb: total, lastOkMb });
      deps.onStep?.(total);
      await deps.yieldTurn();
      try {
        deps.allocate(total - lastOkMb);
      } catch (cause) {
        return {
          kind: "failed",
          lastOkMb,
          failedAtMb: total,
          errorName: errorName(cause),
        };
      }
      lastOkMb = total;
    }
    return { kind: "completed", lastOkMb };
  } finally {
    deps.writeBreadcrumb(null);
  }
}

/** The `name` of whatever was thrown, for a report that never shows messages. */
export function errorName(cause: unknown): string {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "name" in cause &&
    typeof cause.name === "string" &&
    cause.name !== ""
  ) {
    return cause.name;
  }
  return "unknown error";
}
