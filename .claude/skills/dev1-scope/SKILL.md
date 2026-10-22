---
name: dev1-scope
description: Stage dev1 of the tC Mobile issue pipeline. Pick and sharpen an issue before any code, then post a scope contract on it with checkable done-when rows, risks, and open decisions routed to their owner. Use when starting an issue in tc-mobile.
---

# dev1 · Scope

Select the work and question it until it is sharp enough to plan. Ask one
question at a time and push back on vague answers. Read AGENTS.md first, in
full. Every comment this stage posts starts `**[dev1 · Scope]**`.

## 1. Pull context

The issue body and every comment, every linked issue or PR, `git log` for the
files it names. If the issue is unassigned, assign it to the DRI and say "picked
up by the pipeline".

## 2. Question the scope

Ask, in order: what problem does this solve (one sentence; what breaks without
it)? Who is affected (a role or workflow, not "everyone")? What is in scope?
What is explicitly not? What does done look like, in behaviour?

**Premise check.** Re-read the code at every file:line the issue cites, at the
current `develop` SHA. Say what is stale.

## 3. Write the done-when rows

Each row is one observable behaviour, with a target path and a `Check:` in one
of four shapes:

- a command and its result: `Check: run <command> → <output or exit>`
- a named test: `Check: test "<name>" in <file>`
- a UI state: `Check: UI — <screen>: <action> → <what is visible>`
- a durable record: `Check: <store or log> — <what is written>`

A row that cannot be checked is rewritten: `works`, `correctly`, `as expected`,
`handles errors`, `improved`, `faster`, `no regressions` need a number, a state
or a named test. Every row gets a `Source:` line with a verbatim quote and its
URL (an issue or comment link), or `Source: inference — <why>`. Write the quote
to a file and check it with `grep -F -f`; never paste thread text inside shell
quotes.

## 4. Flag risks and record the target

Risks to ask about: data loss or recordings in the field, a `DB_VERSION` bump
(T1, and the rollback text), both platforms, the bench's cost. Name the tier
(AGENTS.md "Risk tiers") and the sprint milestone. Check each target path exists
at `origin/develop` or is marked new.

## 5. Route open decisions

Anything the thread cannot answer is an open decision with an owner: product
and requirements to the requirements owner, delivery and strategy to the DRI. These always block
the plan until ruled: user-visible copy and values, data meaning (ordering,
retention, migrations), who may do what, and which option ships. Write each as
a question ending `?` with its owner. A ruling is a separate comment from the
owner: `Ruling: <the question, verbatim> → <the answer>`. Tactical calls you may
make yourself, with the reason written in the contract. Never name testers or
places in a comment.

## 6. Post the contract

One comment: Problem, Outcome, In scope, Out of scope, Premise check (SHA),
Risks, Tier, Target, the done-when rows (with `Check:` and `Source:`), Open
decisions.

Exit: the contract is posted and every open decision is routed. If a decision
blocks everything, stop with `BLOCKED-ON <owner> <question>`. Next: dev2-plan, unless blocked.
