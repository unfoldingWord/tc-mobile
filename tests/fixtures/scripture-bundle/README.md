# Scripture Bundle schema gate (#1478)

`tests/bundle-schema-gate.test.ts` refuses any `metadata.json` that does not
meet the published Scripture Bundle schema, so a broken export cannot merge.
Nothing here ships to a phone; the validator is a dev dependency used by tests.

## Which version the gate checks

**Spec v1.0.0**, tag `v1.0.0`, commit `b4583610fca90cae6ef6a7b305903b315b772258`
of <https://github.com/bible-technology/scripture-burrito>. The reason for the
pin is ADR 0014, point 1 (`docs/decisions/0014-scripture-bundle-profile.md`).

**A version bump is a reviewed change**: new vendored directory
`schema-<version>/`, the `PINNED_BUNDLE_SCHEMA_VERSION` constant in
`tests/support/scripture-bundle-schema.ts`, the flavour rule and the worked
examples, together in one PR. Do not edit a vendored file in place.

## What is here

- `schema-1.0.0/` is the spec's `schema/` directory, byte-for-byte, minus its
  `index.js`, with the spec's MIT `LICENSE` beside it. The spec's docs are
  CC BY-SA 4.0; none are vendored except the one example below.
- `schema-1.0.0/scripture_flavor_type.schema.json` is not valid JSON upstream
  (trailing commas). It is left as fetched, and the loader in
  `tests/support/scripture-bundle-schema.ts` drops a comma that precedes a
  closing bracket. `tests/bundle-schema-gate.test.ts` tests that repair.
- `examples/referenced-audioTranslation.json` and
  `examples/custom-x-tcMobileAudio.json` are the two worked examples from
  ADR 0014, one per flavour path.
- `examples/spec-audioTranslation.json` is the spec's own
  `docs/examples/artifacts/audioTranslation.json` at the pinned commit, **modified
  from upstream** (it is not byte-for-byte): `meta.generator.userName` is
  `example-user` (upstream names a person), and `targetAreas[0]` is `code`
  `XX`, name `Example area` (upstream names a country). The repository keeps no
  personal names or places. Nothing else differs, and the gate still accepts it.

Prettier ignores the vendored schemas and the spec example (`.prettierignore`).

## The validator

ajv 8 with ajv-formats, both MIT, exact-pinned dev dependencies. The ajv 6
that is already in `node_modules` is transitive and ignores keywords written
beside `$ref`, so it is not the validator to rely on. The compile is not in
ajv's strict mode: the spec's schemas require properties inside `if`/`then`
that they do not declare there.

One rule is ours, on top of the schema: a `scripture` flavour must carry a
non-empty `languages`, because v1.0.0's own condition never requires it (ADR
0014, "What the spec is").
