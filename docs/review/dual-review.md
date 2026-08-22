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

## Traps, each of which cost a dead run on bt-servant-admin-portal

These are not theoretical. They were paid for across 13 review rounds there and
are handled in the scripts.

### Codex (Frank)

- **`-c sandbox_mode="danger-full-access"` is required.** Codex's bubblewrap
  sandbox cannot create a namespace in this container (no unprivileged userns).
  A sandboxed run cannot read the diff at all and returns a _"could not
  inspect"_ non-review — which **reads like a clean pass if you only skim the
  verdict**. Treat any such output as a FAILED run, never as approval. The
  container is the isolation boundary, and the tree is verified unchanged after.
- **`codex exec review --base` and a custom prompt are mutually exclusive.**
  Passing `--base` silently discards the persona and the lens and runs Codex's
  generic review. Frank therefore goes through plain `codex exec`.
- Codex reviews the **committed** diff, so uncommitted edits do not affect it.

### Grok (George)

- **The default permission mode silently cancels** the session the moment the
  model reaches for a terminal command. Grant `--allow read_file --allow grep
--allow list_dir` explicitly _and_ state in the prompt that terminal is
  forbidden.
- **Prompts over ~14KB are offloaded to a file** the model must read back — so
  never tell it "you have no tools", or it cannot recover its own prompt.
- **Output ending on narration is a stalled run, not a pass.** Require that the
  final message be the complete report, and treat narration-only output as a
  retry.
- George reads **files from disk** via `--cwd`, not the committed diff.

### The loop rule

> **Wait for BOTH reviewers to finish before applying any fix, and commit
> before launching the next round.**

Frank reads the committed diff; George reads the worktree. Editing files while
George is running corrupts its review — it sees the diff and the disk disagree.
Frank usually finishes first and tempts an immediate edit. Don't.

### Knowing when to stop looping

Frank tends to return roughly one finding per round, each a refinement of the
previous round's fix — a chain. George returns more, and deeper. When rounds
keep surfacing **new siblings of the same defect class**, that is the signal to
stop fixing case by case and open a follow-up issue for a systematic pass.

### Why both, always

On bt-servant-admin-portal, Codex posted clean four times where Grok found a
real authorization gap in untouched code. **The asymmetry is the point — never
run one as a fallback for the other.**

## Guard design notes

Two guards exist, and both were wrong on the first attempt:

1. **Read-only verification** compares content hashes, not `--stat`. Frank's
   own review of this pipeline caught that a stat comparison misses an edit
   preserving insertion/deletion counts, and misses content changes to
   untracked files entirely.
2. **Failed-run detection** keys on the report's _shape_ (no verdict, or
   "P1: Not assessed"), never on scanning for error strings. The transcript
   echoes the diff, so when the review scripts are themselves under review a
   substring match finds its own source and reports a false failure.

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
