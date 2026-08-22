# Dual review — Frank and George

Two independent reviewers run on every PR before merge, with **deliberately
different lenses** so they do not both find the same class of defect.

|       | Reviewer   | Runs as             | Lens                                                                                     |
| ----- | ---------- | ------------------- | ---------------------------------------------------------------------------------------- |
| **A** | **Frank**  | `codex` (Codex CLI) | **Diff-local** — defects inside the change itself                                        |
| **B** | **George** | `grok` (Grok CLI)   | **Deep-tree** — defects in the interaction between changed code and the _unchanged_ tree |

The split is the point. Reviewer A reads the diff closely; Reviewer B chases
every changed symbol out into the rest of the repository — call sites,
invariants defined elsewhere, lifecycle and cache interactions, contract
mismatches. A single reviewer doing both does neither well.

Both are read-only. Terminal commands are forbidden in the review prompt so a
reviewer cannot mutate the branch it is judging.

## Severity, and the merge bar

|        | Meaning               | Blocks merge?                 |
| ------ | --------------------- | ----------------------------- |
| **P1** | Must fix before merge | Yes                           |
| **P2** | Should fix            | Yes — medium and above blocks |
| **P3** | Nit                   | No; may become an issue       |

Every finding carries `file:line`, a **concrete failure scenario**, and a
minimal fix. A reviewer that finds nothing at a severity says so explicitly
rather than staying silent. Each run ends on a verdict line: `APPROVE` or
`REQUEST_CHANGES`.

After fixing review findings, **push and re-run both reviewers.** Repeat until
both approve with no P1 or P2 outstanding. A stale review is not a review.

## Running them

```bash
scripts/review/frank.sh [base]     # Reviewer A — diff-local
scripts/review/george.sh [base]    # Reviewer B — deep-tree
scripts/review/both.sh [base]      # both, sequentially
```

`base` defaults to `main`. Reports are written to `.review/` (git-ignored).

## Provenance

The George preamble is reproduced from the prompts bt-servant-admin-portal
actually used, recovered from the local Grok session store. Frank's was not
recoverable from the Codex session store, so it is reconstructed from the lens
description inside George's prompt ("Reviewer A covers the diff-local lens; do
not spend your effort on style or diff-local nits") and adapted to this repo.
Treat Frank's as a faithful reconstruction rather than a verbatim copy.

## A known review-noise item

Each agent reads its **own** instruction file — Claude reads `CLAUDE.md`, Codex
reads `AGENTS.md`. In bt-servant-admin-portal those files name different commit
authors, and Frank has flagged the mismatch on review. Declining, with an
explicit reference to the instruction file the authoring agent follows, is the
correct response. This repo's `CLAUDE.md` simply defers to `AGENTS.md`, so the
conflict should not arise here.
