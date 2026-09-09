# Contributing to tC Mobile

The working agreement. Read this once before your first PR, then use it as the
front door — the depth lives in the documents it links to.

## Start here

tC Mobile is an offline-first PWA for oral Bible translation: record a passage,
edit the waveform, manage the segments of a chapter, share MP3. It runs on
Android and iOS phones, often with no network, and is used by people who may not
read.

The deadline that shapes every decision is the **training in the first week of
October 2026**, with production readiness targeted for the end of September.

| Read                                                       | For                                                             |
| ---------------------------------------------------------- | --------------------------------------------------------------- |
| [`AGENTS.md`](AGENTS.md)                                   | architecture, the engineering bar, risk tiers, full conventions |
| [`docs/design/pivot-plan.md`](docs/design/pivot-plan.md)   | the plan of record for the current design                       |
| [`docs/progress_tracker.md`](docs/progress_tracker.md)     | the session log — what happened, newest first                   |
| [`docs/review/dual-review.md`](docs/review/dual-review.md) | how review actually runs, and the traps in it                   |
| [`docs/decisions/`](docs/decisions)                        | ADRs — decisions already made, with their reasons               |

`AGENTS.md` is long and doubles as history: where it disagrees with the tree,
the tree wins, and the disagreement is worth an issue.

## Setup and commands

Node **22.12 or newer** (`engines` in `package.json`).

```bash
npm ci
npm run dev        # dev server
npm run verify     # format, lint, knip, typecheck, typecheck:lib, tests, build
```

`npm run verify` is the gate — what CI runs, in the same order. Husky runs a
fast subset on commit (lint-staged, typecheck) and tests plus build on push.

**Phone testing needs HTTPS.** `getUserMedia` needs a secure context;
`localhost` qualifies and `http://192.168.x.x` does not, so `npm run dev:lan`
alone will not let a phone record. Use a tunnel, a preview Worker, or staging:

**<https://tc-mobile-staging.unfoldingword.workers.dev>**

Detail — the onion layers, the DOM ban in `lib/`, the CSS layering, knip's
blind spots — is in [`AGENTS.md`](AGENTS.md).

## Branches and pull requests

- Cut from `develop` (the default branch) and merge back to `develop` by PR.
- Branch names are `<type>/<short-description>` — `feat/waveform-selection`,
  `fix/decode-failure`, `docs/contributing`.
- **Conventional Commits, subject and body, neither blank.** Say what changed
  and why in the body.
- **Never commit to `staging` or `main`.** They are promoted to, not worked on.
- **Never `--no-verify`.** Never suppress a lint rule or add a type suppression
  without asking first.
- **Open the PR as a draft** and mark it ready when it is review-clean.
- **One change per PR.** A PR that is easy to review is easy to merge.
- **Do not touch `version` in `package.json`.** The release PR owns it; a bump
  in a feature PR is a guaranteed conflict and records nothing.
- Link the issue. Use `Closes #N` **only when the PR closes the whole issue**;
  otherwise reference it plainly (`part of #N`).

## Lanes and ownership

Work is split into three lanes by file ownership, so contributors rarely touch
the same file in the same week.

| Lane                            | Owns                                                          |
| ------------------------------- | ------------------------------------------------------------- |
| **Recorder and audio**          | the recorder screen, `src/hooks/use-recorder*`, `audio-io.ts` |
| **Storage, app shell, release** | `src/lib/storage/*`, app shell, docs, releases and deploys    |
| **Export, provenance, archive** | share and zip paths, provenance on the data model, archive    |

Shared files, where collisions actually happen:

- `src/components/recorder.tsx`
- `src/components/strings.ts`
- `src/hooks/use-audio-session.ts`
- `src/components/icon.tsx`
- `AGENTS.md`

- **Every issue has one assignee and one milestone.** Check the assignee before
  you start; if it is someone else's, ask on the issue first.
- **If you must touch another lane's file, say so on the PR.** Expect to rebase
  when the other lane merges first.
- **Merge order is decided on the PR thread**, one lane at a time. Each merge
  moves the next lane's base and staleness its sign-offs.

## Review

Two independent reviewers run on every code PR: **Frank** (codex, diff-local)
and **George** (grok, deep-tree) — two lenses, never a primary and a fallback.

```bash
scripts/review/both.sh                    # both reviewers; base defaults to origin/develop
scripts/review/triage.sh <round> <pr>    # build the round's triage comment
```

- **A non-author runs the review.** The author never reviews their own PR.
- **A PR is clean only when both reviewers are clean at the current head SHA.**
  A push voids the round — both reviewers must re-post.
- **After a conflict-free rebase, post `git range-diff`.** If the patch is
  unchanged apart from context, the reviewer records acceptance instead of
  running a fresh round. A rebase that changes the patch gets a confirming
  round.
- **One triage comment per round**, including clean rounds. Every finding gets a
  disposition — **FIXED** with a commit, **REFUTED** with file:line evidence, or
  **DEFERRED** with a tracking issue — attributed to the reviewer that raised it
  and stamped with the head SHA.
- **P1 and P2 block merge. P3** goes to an issue unless the fix is trivial.
- **The four-round cap is a decision point, not a stop.** At round 4, say which
  shape the round has — a _chain_ (each finding a refinement of the last fix:
  converging, often worth one more round) or _siblings_ (new instances of one
  defect class: the fix approach is wrong) — and ask. Hitting the cap with
  findings open is an escalation, not an approval.
- **A one-reviewer round is recorded as a deviation**, never as clean.
- When both are clean, the reviewer posts a **GitHub approval**. The **author
  merges** (squash) after that approval and green CI.
- **Process artifacts** — `ci.yml`, `AGENTS.md`, `scripts/review/**`, deploy
  config — need both reviewers, because they are executed as instructions.
  Exempting them is allowed; the decision is recorded on the PR, never skipped
  silently.
- **Documentation and content merge on green CI.**

## The engineering bar, short version

The full version, with the incident behind each rule, is in
[`AGENTS.md`](AGENTS.md).

- **Red first.** A test never observed failing is a comment that costs CI time.
- **Mutation proves coverage on T1.** Break the guard, run the suite, confirm a
  test dies. Line coverage does not prove anything here.
- **Never claim verification you did not perform.** No comment, docblock or PR
  body says tested, verified or checked on-device unless it was. **Android and
  iOS are separate claims** — name the platform, the OS version and the build.
- **Idempotent writes.** Get-or-create in one transaction, clips never deleted
  while another segment still references them, append-only migrations.
- **Errors have a channel before they have copy.** An unhandled rejection
  reaches an error boundary and one sink; `console.error` is not a channel on a
  phone in a village. Prefer state-in-place over a message bubble.
- **No stubs, no sprawl, no duplicates.** knip runs in `verify` and in CI. An
  unused export gets deleted, not tagged, unless a tracking issue backs it.
- **`lib/` stays free of DOM, Web Audio and MediaRecorder.** Enforced by ESLint
  and `npm run typecheck:lib`. If you want `window` in `lib/`, the code belongs
  in `hooks/`.

## Issues

Every issue carries a **milestone**, **labels** from the existing set, and an
**assignee**. File into a milestone; do not leave one unset.

| Milestone                        | Means                                                             |
| -------------------------------- | ----------------------------------------------------------------- |
| `v0.2.0 — Sept: production gate` | must be true before production. Due 2026-09-30                    |
| `v0.3.0 — Oct: training`         | matters for the training, can land after the gate. Due 2026-10-09 |
| `v1.0.0 — Post-training`         | deliberately parked until after October. No due date              |

Body shape — four headings, in this order:

- **Observed** — what is true in the tree today, with `file:line`.
- **Why it matters** — the consequence for a translator or a contributor.
- **Fix shape** — the direction, not the patch. Options are fine.
- **Evidence class** — how you know. Code-read, device-verified, or inference,
  labelled as such. "Not device-verified" is a complete and acceptable answer.

Severity, as used here:

- **P1** — loses audio, or blocks the training. Fix before anything else.
- **P2** — degrades the work materially, or is a data risk with a workaround.
- **P3** — nit, polish, cleanup. Real, but it waits.

## Privacy and public readiness

**This repository will be public.** Everything in the tree, the issues, the PRs
and the commit history is written for that.

- **Never write another person's name, device, chat-channel sourcing, or
  design-material provenance** into commits, issues, PRs or docs, unless they
  are a contributor who chose to be.
- **Use roles instead:** the maintainer, the requirements owner, the project
  manager, a contributor.
- Contributors may use and sign their own names and handles as they wish.
- **No secrets and no account identifiers in the tree** — no API tokens, no
  account IDs, no deployment credentials.
- Security disclosures go to <security@unfoldingword.org>, never to a public
  issue. See [`SECURITY.md`](SECURITY.md).
- Never commit real recordings — they may carry identifying speech from
  vulnerable communities.

## Releases and deployment

Promotion is `develop` → `staging` → `main`, each by PR. The `staging` → `main`
PR is the production gate.

- **One `chore(release)` PR per staging promotion bumps the patch**, and its
  body lists the PRs it carries.
- **The milestone's `staging` → `main` promotion bumps the minor and tags
  `main`.** The minor is the milestone.
- **Cloudflare Workers Builds deploys on merge** — there are no deploy
  workflows in `.github/`; only `ci.yml` lives there.
- **Confirm a deploy by the served bundle's version string, not by the merge.**
  `npm run check:deploy` (or `node scripts/check-deploy.mjs <origin>`) does
  this by fetching `/version.json` from the deployed origin — see AGENTS.md,
  "Confirming a deploy and rolling one back", for the check and the rollback
  path.

## Working with an AI coding agent

Most work here is done with an agent, at speed. The rules that keep that safe:

- **The agent reads `AGENTS.md`** (`CLAUDE.md` defers to it). Point it there
  rather than re-explaining the repo.
- **Keep a session in one lane.** A session that wanders across lanes produces
  a PR nobody can review and a rebase everybody pays for.
- **Do not let an agent write names or unverified claims.** Privacy and the
  verification rule apply to generated text exactly as they apply to yours; a
  confident "verified on device" from an agent is a failure mode this repo has
  already hit.
- **Every agent-authored PR body and comment ends with the session link the
  agent provides**, so the work is traceable.
- **A QA pass by an agent is review input, not the dual review.** It does not
  substitute for Frank and George, and it does not satisfy the non-author rule.

**Questions:** open an issue, or bring it to
[forum.door43.org](https://forum.door43.org).
