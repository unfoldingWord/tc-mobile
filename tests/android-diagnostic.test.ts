import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const fixtures: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const fixture of fixtures.splice(0))
    rmSync(fixture, { recursive: true, force: true });
});

it("writes an explicit false after diagnostic config was loaded", async () => {
  for (const value of ["true", "false", "", "TRUE"]) {
    vi.stubEnv("TC_ANDROID_DIAGNOSTIC", value);
    vi.resetModules();
    const { default: config } = await import("../capacitor.config");
    expect(config.android?.webContentsDebuggingEnabled).toBe(value === "true");
    expect(config.appId).toBe("org.unfoldingword.tcmobile");
  }
});

it.each([
  ["true", true, 0],
  ["false", false, 0],
  ["", false, 0],
  ["false", true, 1],
  ["true", false, 1],
  ["false", undefined, 1],
])("synced config gate: mode %s, debug %s exits %s", (mode, debug, status) => {
  const dir = mkdtempSync(path.join(tmpdir(), "tc-diagnostic-"));
  fixtures.push(dir);
  const config = path.join(dir, "capacitor.config.json");
  writeFileSync(
    config,
    JSON.stringify({ android: { webContentsDebuggingEnabled: debug } })
  );
  const result = spawnSync(
    process.execPath,
    ["scripts/check-android-diagnostic.mjs", config],
    {
      encoding: "utf8",
      env: { ...process.env, TC_ANDROID_DIAGNOSTIC: mode },
    }
  );
  expect(result.status, result.stderr).toBe(status);
  if (status === 1)
    expect(result.stderr).toContain(
      "Android WebView debugging must be explicitly"
    );
});

it("connects the opt-in to both sync and release build without changing signing", () => {
  const workflow = readFileSync(".github/workflows/android-apk.yml", "utf8");
  expect(workflow).toMatch(
    /diagnostic:\n\s+description:.*\n\s+type: boolean\n\s+default: false/
  );
  const build = workflow.slice(workflow.indexOf("  build:\n"));
  expect(build).toMatch(
    /^  build:\n    name: Build release APK\n    env:\n      TC_ANDROID_DIAGNOSTIC: \$\{\{ inputs\.diagnostic \}\}/
  );
  expect(build.match(/TC_ANDROID_DIAGNOSTIC:/g)).toHaveLength(1);
  expect(build).toContain("      - name: Sync dist/ into the Android project");
  expect(build).toContain("      - name: Build the release APK");
  const nativeGate = build.indexOf(
    "        run: node scripts/test-android-diagnostic.mjs"
  );
  expect(nativeGate).toBeGreaterThan(
    build.indexOf("      - name: Sync dist/ into the Android project")
  );
  expect(nativeGate).toBeLessThan(
    build.indexOf("      - name: Write the signing keystore")
  );

  expect(workflow).toContain(
    "node scripts/check-android-diagnostic.mjs android/app/src/main/assets/capacitor.config.json"
  );
  expect(workflow).toContain("environment: release-signing");
  expect(workflow).toContain(
    './gradlew assembleRelease -PversionCode="$(date +%s)" --no-daemon'
  );
  expect(build).toContain(
    "          name: android-apk-${{ inputs.diagnostic && 'diagnostic-' || '' }}${{ github.sha }}"
  );
});
