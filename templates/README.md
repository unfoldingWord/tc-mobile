# Baked template packages

`manifest.json` lists the template packages a build bakes into the app, and
each package's bytes are vendored here, so a build needs no network.
`scripts/bake-template-packages.mjs` checks every entry at the start of each
build and refuses the build on a mismatch (#1450, a child of #1451).

Each entry gives:

| Field         | Meaning                                                          |
| ------------- | ---------------------------------------------------------------- |
| `id`          | the package's own `id`                                           |
| `source`      | the dataset repo                                                 |
| `revision`    | a release tag `vX.Y.Z`, or a full commit for a provisional entry |
| `path`        | the file's path in the dataset repo at that revision             |
| `file`        | the vendored copy, relative to this directory                    |
| `sha256`      | the SHA-256 of those bytes                                       |
| `provisional` | `true` for test data that must never reach production            |
| `titles`      | title tables, each with its own `path`, `file` and `sha256`      |

## Provisional packages

A provisional entry may pin a commit, and its package may say
`source.revision: "unreleased"` and `version: "0.0.0"`. A build bakes it only
with `TC_BAKE_PROVISIONAL_TEMPLATES=1`, and a build with that set on `main`
(`WORKERS_CI_BRANCH` or `GITHUB_REF_NAME`) is refused. With nothing set it is
left out.

## `bible-passages/TIT.json`

The Bible Passages dataset's Titus package, `dist/tc-mobile/TIT.json` at
`main` `ce92d4a1ffd6377cb5636c28c6b92328da5ed2b4`, provisional. It is the same
bytes as `tests/fixtures/templates/bible-passages-TIT.json` (#1791). Licence:
CC BY-SA 4.0 (the dataset's `LICENSE`; the package's own `dataLicence` and
`attribution` fields say the same). When the dataset tags v0.1.0, the copy is
replaced from the tag, the entry is pinned to the tag, and `provisional`
becomes `false`.
