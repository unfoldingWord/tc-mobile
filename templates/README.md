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
when both hold:

- `TC_BAKE_PROVISIONAL_TEMPLATES=1` is set, and
- the build names a branch other than `main`: `WORKERS_CI_BRANCH` (Cloudflare
  Workers Builds) or `GITHUB_REF_NAME` (GitHub Actions) is non-empty, and none
  of them is `main`.

Anything else fails closed: the package is left out, the build goes on, and
the build log says why. That covers no branch variable, an empty one, `main`
in any of them, and a tag build (`GITHUB_REF_TYPE=tag`, or `GITHUB_REF`
starting with `refs/tags/`).

Every `file` in the manifest must be a relative path inside this directory.
An absolute path or one that climbs out with `..` stops the build.

### Baking locally

A local build has no CI branch variable, so name the branch yourself with
`TC_BAKE_BRANCH`:

```bash
TC_BAKE_PROVISIONAL_TEMPLATES=1 TC_BAKE_BRANCH=my-branch npm run build
TC_BAKE_PROVISIONAL_TEMPLATES=1 TC_BAKE_BRANCH=my-branch node scripts/bake-template-packages.mjs
```

`TC_BAKE_BRANCH=main` leaves provisional packages out, like a CI build of
`main`. The override is ignored in CI (when `CI`, `WORKERS_CI` or
`GITHUB_ACTIONS` is set), so it cannot stand in for a branch variable a CI
build did not provide.

## `bible-passages/TIT.json`

The Bible Passages dataset's Titus package, `dist/tc-mobile/TIT.json` at
`main` `ce92d4a1ffd6377cb5636c28c6b92328da5ed2b4`, provisional. It is the same
bytes as `tests/fixtures/templates/bible-passages-TIT.json` (#1791). Licence:
CC BY-SA 4.0 (the dataset's `LICENSE`; the package's own `dataLicence` and
`attribution` fields say the same). When the dataset tags v0.1.0, the copy is
replaced from the tag, the entry is pinned to the tag, and `provisional`
becomes `false`.
