// Rewrites src/lib/i18n/pending.ts from the tables (#1481): `npm run i18n:pending`.
//
// A language with no translated key is "all"; any other lists the English keys
// it does not have. ENFORCE_COMPLETE is read back from the current file and
// kept, so regenerating never flips the release gate. The rewrite itself is
// i18n-pending-core.mjs, which throws on a file whose anchors it cannot find.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import prettier from "prettier";
import { createServer } from "vite";

import { rewritePending } from "./i18n-pending-core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "src/lib/i18n/pending.ts");

const server = await createServer({
  root,
  configFile: false,
  logLevel: "error",
  appType: "custom",
  server: { middlewareMode: true },
  resolve: { alias: { "@": path.join(root, "src") } },
});
try {
  const { LOCALE_OVERRIDES } = await server.ssrLoadModule(
    "/src/lib/i18n/locales.ts"
  );
  const { stringsEn } = await server.ssrLoadModule("/src/lib/strings.ts");
  const { ENGLISH_ONLY } = await server.ssrLoadModule(
    "/src/lib/i18n/english-only.ts"
  );
  // S11: English-only keys are never pending (lib/i18n/english-only.ts).
  const keys = Object.keys(stringsEn).filter((key) => !ENGLISH_ONLY.has(key));
  const text = rewritePending(
    readFileSync(target, "utf8"),
    LOCALE_OVERRIDES,
    keys
  );
  const options = (await prettier.resolveConfig(target)) ?? {};
  writeFileSync(
    target,
    await prettier.format(text, { ...options, filepath: target })
  );
} finally {
  await server.close();
}
