/**
 * The packages the build baked in (#1450 plan task 6; a child of #1451): one
 * source on the package list for every package `templates/manifest.json`
 * names, whatever repo it came from. Nothing here knows a source.
 *
 * The committed `src/data/baked-template-packages.json` is an empty list, and
 * that is what a test run reads. In a build, `vite.config.ts` hands this
 * import the output of `scripts/bake-template-packages.mjs` instead, which
 * has already checked each package's pinned bytes and release rule; the
 * package list validates each one again at its seam, like any other source.
 *
 * A dynamic import, so the packages are their own chunk: a JavaScript file,
 * which the service worker precaches (`workbox.globPatterns` covers `js`, not
 * `json`), so a baked package lists offline.
 */
export async function loadBakedTemplates(): Promise<
  readonly { readonly pkg: unknown; readonly titles: readonly unknown[] }[]
> {
  return (await import("@/data/baked-template-packages.json")).default;
}
