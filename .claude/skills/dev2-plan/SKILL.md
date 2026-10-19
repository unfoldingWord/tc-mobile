---
name: dev2-plan
description: Stage dev2 of the tC Mobile issue pipeline. Turn a scope contract into PR-sized tasks, each covering done-when rows, with the failing test planned before the implementation, a risk tier, and the review it needs. Use after dev1 and before any code.
---

# dev2 · Plan

Read the scope contract. If there is none, stop and run dev1-scope. If an
open decision of the always-stop kind has no ruling, stop: planning around an
unruled value builds a guess. Every comment starts `**[dev2 · Plan]**`.

## 1. Number the rows

Number the contract's done-when rows R1, R2, … in order. Every task names the
rows it covers (`Covers: R1, R2`), and every row must be covered by a task. A
task that covers no row is a row dev1 missed (go back, add it with a source) or
scope creep (drop it).

## 2. Break it into tasks

Each task is PR-sized and has a title, the files it touches, and a `Task done
when:` that can be checked. Use a numbered list, not checkboxes, so the plan is
not read as a second copy of the contract.

**Behaviour changes are planned as a pair, the failing test first.** Task A
writes the failing test (done when: it runs and fails for the stated reason,
not for an import error), task B implements (done when: A passes and nothing
else regressed). Name the suite: Node unit, the `tests/render.ts` render
harness, Playwright against `dist/`, or on-device. For T1 code, name the
mutation that proves the test (break the guard, watch a test die). A task with
no behaviour (docs, config, a pure refactor under existing tests) says so in
one clause: "no test pair: docs only".

## 3. Tier and architecture

Take the strictest tier any task touches (AGENTS.md "Risk tiers"). Then ask,
even for T3: does `lib/` stay free of DOM? Do new sentences go in
`lib/strings.ts`? Does every new failure path reach `reportFailure` with a
context name? Is a migration append-only, with get-or-create in one
transaction? Does a control go busy before its first `await`? Does an async
re-read keep a known value? Which of the seven Collateral surfaces will this
touch (`npm run collateral` after the build; guess now)?

## 4. Size and review

If the work will exceed the size cap in `scripts/check-pr-body.mjs`, plan the
slices now, each opening with its tests, so the cap is met by design rather than
by a late split. State the review: both bench lenses for code and for process
artifacts; an on-device check on Android and iOS for T2.

## 5. Post the plan

One comment: tier and why, branch name, the tasks with `Covers:`, architecture
notes (or "none"), review requirements, slices if any. End with the session
link.

Exit: the plan is posted, every row is covered, the first task is named. Next:
dev3-build.
