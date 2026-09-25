/**
 * The sanctioned caller for `tests/dist-native-sw.test.ts` — the native
 * build's counterpart to `scripts/test-dist.mjs` (#923).
 *
 * Reuses `REQUIRE_DIST_BUILD`/`tests/dist-gate.ts` rather than inventing a
 * second flag: the two suites never collide because each runner passes
 * vitest an explicit file list, not the whole `tests/` directory —
 * `scripts/test-dist.mjs` never names `tests/dist-native-sw.test.ts`, and
 * this file never names the three web suites. `npm run test:dist:native`
 * builds the native bundle first (`npm run build:native`), so `dist/sw.js`
 * is the self-destroying native worker, not the web precache worker, by the
 * time this runs — see that test file for what it asserts.
 */
import { spawnSync } from "node:child_process";

process.env.REQUIRE_DIST_BUILD = "1";

const result = spawnSync(
  process.execPath,
  ["node_modules/vitest/vitest.mjs", "run", "tests/dist-native-sw.test.ts"],
  { stdio: "inherit", env: process.env }
);

if (result.error) console.error(result.error);

// A signal-killed child reports `status === null`; treat anything that is not
// a clean 0 as a failure rather than letting the gate exit 0 on it.
process.exit(result.status ?? 1);
