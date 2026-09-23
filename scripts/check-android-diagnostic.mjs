import { readFileSync } from "node:fs";

// Check the serialized config, not the TypeScript input: cap sync must replace
// a previous diagnostic build's true with an explicit false on ordinary builds.
const expected = process.env.TC_ANDROID_DIAGNOSTIC === "true";
const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (config.android?.webContentsDebuggingEnabled !== expected) {
  console.error(`Android WebView debugging must be explicitly ${expected}`);
  process.exit(1);
}
console.log(`Android WebView debugging: ${expected}`);
