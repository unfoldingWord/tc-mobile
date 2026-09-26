# Provenance — @breezystack/lamejs 1.2.7

This folder holds the source code of the MP3 encoder library that tC Mobile
bundles, `@breezystack/lamejs` version 1.2.7 (LGPL-3.0). It is kept in this
repository so the library's source stays available at the same commit as the
app that ships it (ADR 0003, #36). tC Mobile's own code does not import
anything from this folder; the app is built from the npm package.

| Field                  | Value                                                                             |
| ---------------------- | --------------------------------------------------------------------------------- |
| npm package            | `@breezystack/lamejs`                                                             |
| npm version            | `1.2.7`                                                                           |
| npm tarball            | `https://registry.npmjs.org/@breezystack/lamejs/-/lamejs-1.2.7.tgz`               |
| npm `gitHead`          | `1fb0ef5fa177413107e2e107d054a9b994e3f79c`                                        |
| Upstream repository    | `https://github.com/gideonstele/lamejs`                                           |
| Upstream commit        | `1fb0ef5fa177413107e2e107d054a9b994e3f79c`                                        |
| Upstream commit URL    | `https://github.com/gideonstele/lamejs/commit/1fb0ef5fa177413107e2e107d054a9b994e3f79c` |
| Date fetched           | 2026-09-26                                                                        |
| Files modified         | None. Every file here is byte-for-byte the upstream file at that commit.          |

## Which repository

The package's `repository` field says `https://github.com/shijinyu/lamejs`.
GitHub resolves that name to `gideonstele/lamejs`: the GitHub API returns
`gideonstele/lamejs` for `shijinyu/lamejs`, and a clone of the old URL reaches
the same repository. That repository is a fork of `zhuker/lamejs`. The commit
above is on its `master` branch.

## What is included

The files the published `dist/` is built from, and the files that control
that build:

- `src/js/*.js` — the encoder source. `src/js/index.js` is the build entry.
- `vite.config.ts`, `tsconfig.json`, `package.json`, `pnpm-lock.yaml` — the
  build script, its configuration and its locked build dependencies
  (`npm run build` upstream is `vite build`).
- `type.d.ts` — the type declarations the npm package ships.
- `LICENSE`, `README.md` — as upstream has them.

## What is left out

These upstream files are not needed to build `dist/`. Only the diagram image
is also in the npm package:

- `src/js/Tests.js` — the upstream test script (`npm test`).
- `testdata/*.wav` — binary audio fixtures for that test.
- `worker-example/` — example pages.
- `src/main/` and `pom.xml` — the separate Java port of LAME, which the
  JavaScript build does not use.
- `doc/1000px-Mp3filestructure.svg.png` — a diagram image.
- `.gitignore`.

All of them are at the upstream commit above.

## How to rebuild

From a copy of this folder: `pnpm install --frozen-lockfile`, then
`npx vite build`. The npm 1.2.7 tarball's `dist/` files have these SHA-256
digests, to compare a rebuild against:

- `dist/lamejs.js` — `1c5f944911ccf2f6e29ab36c2e568363210ab16f50c0d76077060f40ecf91d28`
- `dist/lamejs.iife.js` — `0be202ec162aa3042d5c5c4e6288ad326cff8cec7312c2894a0a91ad2f9aeda1`

## Tooling

This folder is third-party code kept as it was fetched. It is excluded from
tC Mobile's lint, format, typecheck, knip and build. `tests/vendored-lamejs.test.ts`
pins its version to `package-lock.json`.
