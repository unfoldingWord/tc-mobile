---
name: dev3-build
description: Stage dev3 of the tC Mobile issue pipeline. Implement the plan on a feature branch cut from develop, test first, within the repo's engineering bar, and push the branch. Use after dev2, when writing the code.
---

# dev3 · Build

Read the plan. If there is none, stop and run dev2-plan.

## 1. Branch from develop

A worktree's "fresh" base can be `main`, which is not `develop`. Do it by hand:
fetch `origin develop`, check out that exact SHA detached, then create
`<type>/<short-description>` (AGENTS.md "Conventions"). Run `npm ci` if
`node_modules` is missing or stale. Never commit to `develop`, `staging` or
`main`.

## 2. Test first

For each behaviour task: write the failing test, run it, and read the failure.
A red from a missing import or a typo proves nothing; it must fail on the
assertion you meant. Keep the raw failing output (trimmed) for the PR's
`Test-first:` field, then make it pass. Where the code already exists, get the
same signal by mutation: break the guard, confirm a test dies, restore it. For
T1 code, mutation is required. Never weaken a red test to make it pass; if the
assertion was wrong, change it on purpose and say so.

A gate or a guard is tested in both states: red on what it exists to catch,
green on every legitimate state, and its real entry path run, not only its
exported function (AGENTS.md "Engineering bar").

## 3. Guardrails

Follow AGENTS.md "Engineering bar" and the onion layers. Never suppress a lint
rule or add a type suppression without asking the DRI. Never `--no-verify`.
Never swallow an error silently. No new dependency without saying why (licence,
size, knip). A docblock or comment never claims a check that was not run, and
never carries a run's output.

## 4. Commit and push

Conventional Commits, subject and body, neither blank. End the message with the
session line the harness gives you. Keep each slice of a split plan to its own
branch. Push the branch; the pre-push hook runs the checks. Never force-push,
and never push to `develop`, `staging` or `main`.

Exit: the branch is pushed with every task the plan assigns to this PR done,
or `BLOCKED <reason>`. Next: dev4-check.
