---
name: dev4-check
description: Stage dev4 of the tC Mobile issue pipeline. The quality gate before a PR opens, not a review: verify, prepush, architecture and observability checks, a look at changed UI, every done-when with evidence, and the seven Collateral surfaces. Use after dev3, before opening the PR.
---

# dev4 · Check

**dev4 is a gate, not a review.** It blocks the PR if anything fails. It does
not read the diff for quality, and its report is never called independent or
clean: the uwreview bench (Frank and George) reviews, on the PR.

## 1. Run the suites

`npm run verify`, then `npm run check:prepush` (and the `tc-prepush` skill's
judgment list). Run both even if the first fails, and record real results. If
`package.json` or the lockfile changed: `npm audit --omit=dev` and the licence
of any new package; a high or critical advisory blocks.

## 2. Architecture and observability

- `lib/` has no DOM: lint and `typecheck:lib` are green, and grep the diff for
  `window` and `document` under `src/lib/`.
- New sentences are in `lib/strings.ts`, not beside the code.
- T2 and up: every new failure path reaches `reportFailure` with a context name,
  or the PR says why not. Say which paths still end at `console.error`.
- A control goes busy before its first `await`; an async re-read never
  overwrites a known value with an unknown one.

## 3. Look at changed UI

If the diff touches `src/components`, `src/app` or styles: build, open the
changed screen at 360 px wide in light and dark with Playwright against
`dist/`, and look at it. A state you could not reach is a gap, said plainly.
An edit made here voids steps 1 and 2: rerun them on the final tree.

## 4. Verify every done-when

For each row of the plan: run it, read the output, name the evidence. "I think
so" is not evidence.

## 5. Walk the seven Collateral surfaces

Run `npm run collateral` for the hint, then answer all seven (meanings in
AGENTS.md "Issue pipeline"): release-notes (add the line to
`RELEASE_NOTES_UNRELEASED.md` now), legal-content, help-articles, feature-doc,
schema-doc, service-catalog, mobile-parity. Each answer is what changed, or
`N/A — <reason>`. A bare `N/A`, `TBD` or `later` is not an answer. A doc edit
made here voids steps 1 and 2.

## 6. Draft the body and gate it

Write the PR body from the template, then run
`npm run check:pr-body -- --body-file <path>`. It also counts production lines
against the cap, so a PR that needs splitting is found here, not in CI.

## 7. Report

PASS or FAIL, one line per check with its real result. Never write a result you
did not observe.

Exit: PASS, with the body gate green on the drafted body, or FAIL with the list.
Do not suggest dev5 on a FAIL. Next: dev5-ship.
