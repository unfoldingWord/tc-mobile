# Moving tC Mobile into the unfoldingWord org

**Status:** plan, pending approval. Not yet executed.
**Date:** 2026-08-27 · **DRI:** Seth Stoll · **Requirements:** Tim Jore

## Bottom line

tC Mobile is **already cleaner than its uW siblings** on the things that
usually block a transfer. The three sibling repos (`bt-servant-admin-portal`,
`bt-servant-web-client`, `bt-servant-worker`) ship **no** LICENSE, SECURITY,
CONTRIBUTING, or CODEOWNERS; tC Mobile has the first three, its LICENSE is
already `MIT · Copyright (c) 2026 unfoldingWord`, and its CI is the most
hardened of the four (`permissions: {}`, gitleaks, `knip`, the DOM-free
`typecheck:lib` boundary).

So the move is **not** a bring-it-up-to-standard exercise. It gates on **one
human approval** and **two deliberate-architecture decisions** where tC Mobile
knowingly diverges from the sibling pattern, plus a small optional punch-list.
Nothing engineering-substantial is missing.

## The two governance sources, and why they disagree

- **De jure** — `dev-practices/new-project-checklist.md` and the
  `engineering-operating-system.md` (EOS). These are explicitly headed
  _"Proposal for the unfoldingWord dev team"_ (v1, 2026-05-06). They define a
  full checklist: `main`-default, dependabot, CODEOWNERS, PR/issue templates,
  branch protection, a tech-lead-group approval, a recorded DRI.
- **De facto** — what the actual org repos do. Minimal: single `main`,
  GitHub-Actions deploy, `AGENTS.md`/`CLAUDE.md` for ownership, almost none of
  the checklist's `.github/` files.

The proposal is the aspiration; the siblings are the practice. tC Mobile already
meets or beats the _practice_ on everything except repo location and two
architecture choices. Where the _proposal_ asks for more (dependabot, templates,
`main`-default), that is a choice to make with the approver, not a hard gate —
the siblings don't meet it either.

## The gate (human, before anything moves)

Per the EOS decision-rights table, _"new repo creation — anyone can propose; the
tech-lead group approves the name + ownership."_ There is no ratified transfer
runbook and no named tech-lead-group roster in the docs (the body is itself
listed as "currently absent from uW"), so honestly:

- **D1 — Approval + DRI.** Get a uW human acting as tech-lead-group approver to
  green-light `unfoldingWord/tc-mobile` and its ownership, and record the DRI
  (Seth) and a named **technical lead** (the EOS T2 merge-authority role — not
  currently named in `AGENTS.md`; the DRI section names builder/requirements/PM
  but no tech lead). Route via Birch (PM) / the uW eng leads.
- **D2 — Public vs private.** uW default is **public**; tC Mobile is private and
  `AGENTS.md` documents _why_ (it sidesteps the very approval gate this plan
  closes). Once approved, the private reason expires — decide public, or
  re-justify private and record it.

## What a GitHub _transfer_ carries — and what it doesn't

Use a **repo transfer**, not a re-create: it preserves issues (30 open), PRs,
Actions history, and auto-redirects old `sethstoll3/tc-mobile` URLs. What does
**not** carry and must be redone:

- **Repo secrets** — one exists, `CLOUDFLARE_ACCOUNT_ID`. Re-add after transfer,
  or confirm it's vestigial first (per `AGENTS.md`, Actions no longer deploys and
  the Cloudflare token lives in Cloudflare's build settings — check whether
  `ci.yml` still reads this secret before re-adding).
- **Cloudflare Workers Builds link** — currently bound to `sethstoll3/tc-mobile`.
  Re-authorize the GitHub App to `unfoldingWord/tc-mobile`. Deploy _targets_ are
  unchanged (the Cloudflare account is already unfoldingWord).
- **Local clones** — every `origin` remote re-points to the org URL.
- **`package.json` identity** — add `repository`/`homepage` to the org URL
  (`name: "tc-mobile"`, `private: true` are already correct).

## The two real decisions (where tC Mobile diverges on purpose)

- **D3 — Deploy: keep Cloudflare Workers Builds, or adopt the sibling
  Actions pattern?** The siblings deploy from **GitHub Actions**: a per-PR
  ephemeral worker (`…-pr-N`), staging-on-merge-to-main, manual prod
  `workflow_dispatch`, and a `cleanup-pr.yml`, with `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID` as GitHub Secrets. tC Mobile **deliberately deleted
    all deploy workflows** and uses Workers Builds, documented in `AGENTS.md` as
    intentional (to kill a double-deploy collision). This is the single biggest
    difference from the org norm. Keeping it is defensible — record it as a
    visible deviation per the EOS. Conforming means adding the four workflows and
    disconnecting Workers Builds. **Recommendation: keep Workers Builds** unless
    the org standardizes on the per-PR-worker pattern; the per-PR ephemeral worker
    is the one sibling feature worth considering adding later.
- **D4 — Branch model: keep `develop → staging → main`, or collapse to single
  `main`?** All three siblings use a single `main`; "staging"/"production" are
  Cloudflare deploy targets, not branches. The checklist's `main`-default rule is
  written _for new repos_; tC Mobile is an existing repo with a working
  promotion flow and staging Worker. **Recommendation: keep the three-branch
  model through October** (it's load-bearing for the current staging→main gate),
  record it as a deviation, and revisit post-launch. Note: `main` is not the
  default branch today (`develop` is) — branch protection below applies to
  whichever branches stay long-lived.

## Optional punch-list (small, cheap, do at prep)

None of these block the move; siblings mostly lack them too.

- **D5a — `dependabot.yml`.** Only `bt-servant-worker` has one (weekly npm,
  grouped dev/prod). Add it if the org wants dependabot standard; the worker's
  config is the template.
- **D5b — Branch protection** on the long-lived branch(es) after transfer:
  require PR + ≥1 review, require the CI checks, block force-push. tC Mobile's
  Frank/George review discipline is already stronger than the org minimum; this
  is just the mechanical setting, which can't be set until the repo is in the org.
- **D5c — Name the technical lead** in `AGENTS.md` (feeds D1).
- CODEOWNERS / PR / issue templates: **above** org norm (no sibling has them).
  Skip unless wanted.
- **lamejs LGPL attribution (#36)** — done: every bundled component's licence
  and notice ship reachable in-app under **Menu → About & licenses**. Unrelated
  to the org move; closes before a public release.

## Already done (don't redo)

MIT LICENSE with uW copyright · SECURITY.md with a private disclosure path ·
CONTRIBUTING.md · CHANGELOG.md · README + AGENTS.md + CLAUDE.md (`@AGENTS.md`) ·
ADRs in `docs/decisions/` · gitleaks in CI (pinned binary, more robust than the
sibling action) · `permissions: {}` least-privilege CI · Node 22 + npm matching
siblings.

## Ordered runbook

1. **Approve** (D1, D2) — human gate. Nothing moves before this.
2. **Prep on a branch** (cheap): record the D3/D4 deviations in `AGENTS.md`, name
   the tech lead (D5c), add `dependabot.yml` if chosen (D5a), set
   `package.json` `repository`/`homepage`.
3. **Transfer** `sethstoll3/tc-mobile` → `unfoldingWord/tc-mobile` (GitHub
   Settings → Transfer). Seth is an org admin, so this is executable once
   approved.
4. **Re-link:** re-add/confirm `CLOUDFLARE_ACCOUNT_ID`; re-authorize Workers
   Builds to the org repo (or, if D3 = Actions, add the workflows + secrets);
   set branch protection (D5b); re-point local remotes.
5. **Verify:** CI green on a PR; a deploy reaches staging; run the checklist's
   "is it real?" test — README in 60s, clone→green in 10min, PR triggers CI, the
   DRI is findable.

## Open for humans

- **D1/D2** — approval, DRI/tech-lead recording, public-vs-private. Route via
  Birch to the uW eng leads.
- **D3/D4** — the deploy and branch-model deviations: keep (record them) or
  conform. Recommendation is keep-and-record through October.
