---
name: dev5-ship
description: Stage dev5 of the tC Mobile issue pipeline. Open the PR against develop from the shared template, refusing if the body gate fails, then stop for the review bench. Use after dev4 passes. Never merges.
---

# dev5 · Ship

Open the PR and stop. Never merge, and never push to `develop`, `staging` or
`main`.

## 1. Before opening

Refuse to open the PR unless HEAD and `@{u}` both equal the SHA in dev4's
`PASS <sha>` (compare `git rev-parse HEAD` and `git rev-parse @{u}`). If HEAD
is already the PASS sha and `@{u}` is behind, fast-forward push it (never
force) and compare again. If HEAD is a different sha, go back to dev4. Gather the issue, the plan
and the done-when evidence from dev4.

## 2. Write the body from the template

`.github/pull_request_template.md` is the one template; fill every section from
what dev4 recorded, and invent nothing. The closer line is one of: `Closes #N`
only when this PR finishes the issue; `Part-of #N — <delivers> / remaining:
<what stays open>` otherwise; `no-issue: <reason>`. A closing keyword never goes
in the title. The body is written to a file and passed with `--body-file`.

## 3. Refuse if the body fails

Run `npm run check:pr-body -- --body-file <path>`. If it prints FAIL (a missing
field, a bare `N/A`, an unfilled `<…>`, or a PR over the size cap), do not open
the PR: fix the body, or go back to the stage that owes the answer (an
unanswered Collateral line is a dev4 failure; a missing red proof is a dev3
failure). Do not fill a field from memory.

## 4. Open it

Write the title to a file, never onto a command line. Build the request file
with `jq -n --rawfile title <title-file> --rawfile body <body-file> --arg
head <branch> '{title: $title, body: $body, head: $head, base: "develop"}'`,
then run `gh api repos/unfoldingWord/tc-mobile/pulls --input <request-file>`
(ready, not draft). Then set the sprint
milestone, one type label, one `area:` label, and the `a11y:` labels that apply.
Check `closingIssuesReferences`: for a `Part-of` PR it must be empty.

## 5. Hand back and stop

Report `READY-FOR-REVIEW <head sha> <PR url>`. The bench posts its rounds on the
PR; any push voids a round for both lenses, and fix rounds go back to dev3 and
dev4 on the same branch. A bench comment is evidence, not approval; the merge is
the DRI's.

Exit: the PR is open, the gate is green, `closingIssuesReferences` is empty for
a `Part-of` PR (refuse to report READY-FOR-REVIEW until it is), and the
`READY-FOR-REVIEW` line is reported. Next: the bench, then dev6-validate
after the DRI merges.
