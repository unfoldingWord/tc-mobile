/**
 * When the build-artifact suites run — as a decision, so it can be tested.
 *
 * `tests/dist-css.test.ts` and `tests/precache-manifest.test.ts` read files a
 * production build emits into `dist/`. Both used to gate on whether that
 * directory happened to EXIST, which made the suite's own tally a function of
 * leftover state rather than of the tree: `npm run verify` runs `test` before
 * `build`, so the same commit reports six skipped cases on a checkout nothing
 * has built and six passing ones on a checkout something has (#568). Two
 * tallies for one tree means neither is evidence, and a test that silently
 * does not run is indistinguishable from a test that passed — the same defect
 * class as a gate that cannot go red.
 *
 * So artifact presence no longer decides anything. The CALLER's intent does:
 *
 *   REQUIRE_DIST_BUILD unset  ->  skip, whatever is or is not in dist/
 *   REQUIRE_DIST_BUILD set    ->  run; a missing artifact is an ERROR, not a
 *                                 skip, because the caller promised a build
 *
 * `npm run test:dist` is the sanctioned caller and the only thing that sets
 * the variable; it is invoked after `npm run build` (see `verify` in
 * package.json and the build-artifact step in `.github/workflows/ci.yml`).
 * A bare `npm test` therefore always reports the same skips, and the loud
 * half is reachable: point the sanctioned caller at a tree with no build and
 * it goes red instead of quietly green.
 */

/** Whether the caller has promised that a build precedes this run. The
 *  variable is a flag — any non-empty value sets it. */
export function distBuildRequired(
  env: Record<string, string | undefined> = process.env
): boolean {
  return Boolean(env.REQUIRE_DIST_BUILD);
}

/** The gate. `artifactPresent` is deliberately ignored unless `required` —
 *  that is the whole property #568 turns on. */
export function distGateDecision(
  required: boolean,
  artifactPresent: boolean
): "run" | "skip" | "fail" {
  if (!required) return "skip";
  return artifactPresent ? "run" : "fail";
}

/**
 * The gate as the suites consume it — and the only place the loud half lives.
 *
 * This throws rather than returning `"fail"`, and both suites call it at
 * MODULE scope. That placement is the point (Frank R1 P2 on #572): the first
 * shape of this fix put the loud half in an ordinary `it()` case in each
 * suite, so deleting those two cases left every assertion in
 * `dist-gate.test.ts` green while `REQUIRE_DIST_BUILD` with no build went
 * back to skipping quietly — the exact false-green #568 exists to close,
 * reachable by deleting a test. A module-scope throw cannot be defeated that
 * way: it fires during collection, so vitest fails the whole file and
 * `npm run test:dist` exits non-zero no matter which cases are present.
 *
 * `distGateDecision` above stays the pure, three-valued decision so it can be
 * tested without catching anything; this is the wiring that makes `"fail"`
 * reach the runner.
 */
export function resolveDistGate(
  artifactPresent: boolean,
  missingArtifact: string,
  env: Record<string, string | undefined> = process.env
): "run" | "skip" {
  const decision = distGateDecision(distBuildRequired(env), artifactPresent);
  if (decision === "fail") {
    throw new Error(
      `REQUIRE_DIST_BUILD is set but ${missingArtifact} was not found — run ` +
        "`npm run build` first, or drop the variable. Only `npm run " +
        "test:dist` should set it."
    );
  }
  return decision;
}
