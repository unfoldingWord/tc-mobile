/** Injected by Vite from package.json — see vite.config.ts `define`. */
declare const __APP_VERSION__: string;
/** Short git SHA of the build — see vite.config.ts `define`. */
declare const __BUILD_SHA__: string;
/** Full 40-hex git commit id of the build — see vite.config.ts `define`. */
declare const __BUILD_SHA_FULL__: string;
/**
 * Installed version per disclosed package, defined from the installed
 * manifests (`scripts/licence-versions.mjs`) — see `vite.config.ts` and
 * `vitest.config.ts` `define` (#1381).
 */
declare const __DEP_VERSIONS__: Readonly<Record<string, string>>;
