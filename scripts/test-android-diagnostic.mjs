import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";

// Native-lane regression check: invoke preBuild, not checkDiagnosticAssets,
// so removing its dependency also fails. Requires cap sync and the Android SDK.
const configPath = new URL(
  "../android/app/src/main/assets/capacitor.config.json",
  import.meta.url
);
const original = readFileSync(configPath);
const config = JSON.parse(original.toString());
const cases = [
  { mode: "true", debug: true, expected: 0 },
  { mode: "false", debug: false, expected: 0 },
  { mode: "false", debug: true, expected: 1 },
  { mode: "true", debug: false, expected: 1 },
  { mode: "false", debug: undefined, expected: 1 },
  { mode: "false", missing: true, expected: 1 },
];

try {
  for (const fixture of cases) {
    if (fixture.missing) rmSync(configPath);
    else {
      writeFileSync(
        configPath,
        JSON.stringify({
          ...config,
          android: {
            ...config.android,
            webContentsDebuggingEnabled: fixture.debug,
          },
        })
      );
    }
    const result = spawnSync("./gradlew", [":app:preBuild", "--no-daemon"], {
      cwd: new URL("../android/", import.meta.url),
      env: { ...process.env, TC_ANDROID_DIAGNOSTIC: fixture.mode },
      encoding: "utf8",
      timeout: 300_000,
    });
    const label = JSON.stringify(fixture);
    console.log(label, `exit=${result.status}`);
    if (result.error) throw result.error;
    assert.equal(
      result.status,
      fixture.expected,
      result.stdout + result.stderr
    );
    if (fixture.expected === 1) {
      // A toolchain error is not proof that the diagnostic gate rejected it.
      assert.ok(
        (result.stdout + result.stderr).includes(
          fixture.missing
            ? "Run cap sync android before building the APK"
            : "Android diagnostic mode differs from synced assets"
        ),
        result.stdout + result.stderr
      );
    }
  }
} finally {
  writeFileSync(configPath, original);
}
console.log("Android preBuild diagnostic gate passed; synced config restored");
