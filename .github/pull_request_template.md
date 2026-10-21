<!--
Every section is required. The "PR Body" check (scripts/check-pr-body.mjs)
reads the filled body, and text inside comments like this one does not count.
Dependabot, `chore(release):` bumps into develop and promotion PRs (base
staging or main) are exempt. Check a draft before opening:
  node scripts/check-pr-body.mjs --body-file <path>
-->

## Summary

<!-- What this PR does and why, in a paragraph. The title carries the type; no closing keyword in the title. -->

<!-- Then ONE closer line, replacing the line below:
  Closes #N
  Part-of #N — <what this PR delivers> / remaining: <what stays open>
  no-issue: <reason>
Use Closes only when this PR finishes the issue. -->

Closes #

## Risk

<!-- One token on the line: T1, T2 or T3 (AGENTS.md "Risk tiers"). A process artifact (CI, AGENTS.md, skills) says so below the line. -->

Tier:

## Changes

-

## Testing

<!-- Test-first: the red test, its command and failing output (trimmed), then green, and what the mutation run killed. For a change with nothing to test, "N/A — <reason>". The line may continue on indented lines below it. -->

Test-first:

## Done when

<!-- One item per criterion, each with how it was checked. -->

- [ ] <one observable behaviour, and where it lives> — Check: <command and result, test name, or UI state>

## Collateral

<!-- Every line answered: what changed, or "N/A — <reason>". A bare N/A, TBD or "later" is not an answer. Meanings are in AGENTS.md "Issue pipeline (dev1–dev7)". -->

- release-notes: <the line added to RELEASE_NOTES_UNRELEASED.md | N/A — reason>
- legal-content: <PRIVACY.md, licence notice or store disclosure touched | N/A — reason>
- help-articles: <runbook or tester note updated | N/A — reason>
- feature-doc: <AGENTS.md, ADR, design doc or docblock updated | N/A — reason>
- schema-doc: <migration and rollback text updated | N/A — reason>
- service-catalog: <origin, native lane or store config changed | N/A — reason>
- mobile-parity: <what the other shells adopt, or the parity issue filed | N/A — reason>

## Taste

<!-- One line, one state. -->

Taste impact: <none | follows pattern (citation) | changes taste (link to the DRI's answer)>

## Definition of done

- Reuse: <what you reused, or what you searched for and found nothing>
- Production lines: <added, removed and net, tests and docs not counted>
- File size: <no file already over 800 lines grows, or which one does and why>

## Review evidence

<!-- Bench rounds at a head SHA, for example "Frank R1 clean at <sha>". A bench comment is evidence, not approval; the merge is the DRI's. Before the bench has run: "not yet reviewed". -->

## Device checks

<!-- Needed on Android and iOS? Say what has and has not run. "Not run yet" is an honest answer. -->
