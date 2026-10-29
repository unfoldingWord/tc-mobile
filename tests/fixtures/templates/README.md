# Template package fixtures

Every `*.json` here is a template package (format v0,
`docs/contracts/template-package-v0.md`) or a title table for one
(`titles-*.json`). All of them are small and invented, except one.

## `bible-passages-TIT.json`: a pinned copy of a real dataset package

|             |                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------ |
| Source repo | <https://github.com/unfoldingWord/bible-passages>                                                                  |
| Commit      | `ce92d4a1ffd6377cb5636c28c6b92328da5ed2b4` (`main`)                                                                |
| Path        | `dist/tc-mobile/TIT.json`                                                                                          |
| Size        | 7,442 bytes                                                                                                        |
| SHA-256     | `4509c28951531b41e16b7c9ae08e523b050ab26e2570cc0e952eabc3d78feeb6`                                                 |
| Licence     | CC BY-SA 4.0 (the dataset repo's `LICENSE`; the package's own `dataLicence` and `attribution` fields say the same) |

It is copied byte for byte and must not be edited in place: prettier skips it
(`.prettierignore`), and `tests/template-bible-passages-fixture.test.ts`
refuses any other bytes by checking the SHA-256 above.

It is **provisional**. The package is not a release: its `version` is `0.0.0`
and its `source.revision` is `unreleased`, and its keys and id may change
before the dataset's v0.1.0 tag. When that tag exists, the file is re-copied
from it, the commit and hash above and in the test are updated together, and
every Titus-specific count in the tests is re-derived from the new file
(#1450, plan task 1).

The dataset publishes no title table in `dist/` at this commit, so there is
no title-table fixture from it here.
