---
name: dev6-validate
description: Stage dev6 of the tC Mobile issue pipeline. A different agent from the builder checks a merged PR against the base it merged into and gives a verdict (PASS, FAIL or NEEDS-DEVICE) on the issue. Use after the DRI merges.
---

# dev6 · Validate

The builder does not validate their own work. Run this as a different agent,
from a fresh checkout. Never merge anything.

## 1. Confirm the merge

`gh pr view <n> --repo unfoldingWord/tc-mobile --json mergeCommit,baseRefName,mergedAt`.
If `mergedAt` is empty, stop: the PR is not merged. Record the merge commit and
the base it went into.

## 2. Say which build the check ran against

A merge to `develop` reaches a preview build only. Staging needs a promotion,
and a merged promotion PR is not a deployed build: after one, run
`npm run check:deploy` (or `check:deploy:prod` for production) and quote its
PASS line. State plainly which of these the validation used.

## 3. Test the plan's criteria on the merged base

Check out the merge commit in a fresh worktree, `npm ci`, and take the plan's
done-when rows, instructions and edge cases one by one: the relevant tests, and
for UI the built app in Playwright. Do not trust the builder's evidence; produce
your own, and quote it.

## 4. Give a verdict on the issue

Post `**[dev6 · Validate]**` with one of:

- **PASS**: every row held on the merged base, with the evidence.
- **FAIL**: which row failed, how to reproduce it, on which commit.
- **NEEDS-DEVICE**: what a human must run, on which phone (Android, iOS), and
  what to look for. Browser-boundary code (the worker, the share sheet, audio
  capture) needs a device run; do not call it PASS from Node alone.

Exit: a verdict is posted on the issue with evidence. A FAIL reopens the work at
dev3 and never goes to dev7-close. Next: dev3-build on a FAIL, dev7-close on a
PASS or NEEDS-DEVICE.
