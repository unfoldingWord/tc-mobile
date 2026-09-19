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

`base` defaults to `origin/develop` — work is cut from `develop`, so an omitted
base reviews only the branch's own change rather than its whole divergence from
`main`. Reports are written to `.review/` (git-ignored).

## Merge policy

This repo is **solo** — there is no second human reviewer to wait on, so Frank
and George _are_ the review. Once they are clean, merge is an admin merge.

| Change                                                                             | Bar to merge                                                                                                                                                          |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application code                                                                   | **Both reviewers clean @ the current head SHA**, CI green, then admin merge                                                                                           |
| Documentation and content                                                          | CI green, then admin merge                                                                                                                                            |
| Process/meta artifacts — `ci.yml`, `AGENTS.md`, `scripts/review/**`, deploy config | Normally both reviewers, because these are _executed as instructions_. Exempting them is allowed but the **decision must be recorded on the PR**, never a silent skip |

**P1 and P2 block. P3 goes to an issue** unless the fix is trivial enough to
just do.

**Capped is not clean.** Hitting the round cap with findings open is an
escalation: it blocks merge until the residual findings are named and
explicitly accepted, recorded on the PR.

## Merging multiple lanes

When several lanes are in flight, **merge them one at a time, in a deliberate
order, pre-flighting each.**

The reason is mechanical: a reviewer's clean statement names a head SHA, and
merging lane A moves lane B's base. B's green checks and both its sign-offs now
describe a commit that is no longer what would land.

The loop, per lane:

1. Pick the next lane — prefer the one others depend on, and lanes touching
   shared files before lanes that do not.
2. **Pre-flight:** mergeable, CI green, both reviewers clean @ the _current_
   head.
3. Merge.
4. **Re-base and re-check every remaining lane.** If a lane's diff changed
   materially, its reviews are stale — re-run both.

Lanes that touch the same files should not be in flight simultaneously in the
first place; the lane brief is where that is prevented (see the
`batch-pipeline` skill's file-ownership check).

## The triage comment — mandatory, every round

**One triage comment per round, on the PR.** No exceptions, including a round
where both reviewers found nothing.

```bash
scripts/review/both.sh <base>        # run both reviewers
scripts/review/triage.sh <round> <pr>  # build the comment, then post it
```

`triage.sh` extracts every finding from both reports, attributes each to the
lens that raised it, pulls both verdicts, and stamps the head SHA. You fill in
the disposition for each — **FIXED** with a commit, **REFUTED** with file:line
evidence, or **DEFERRED** with a tracking issue — and post it.

Why it is not optional: _"the agent addressed it"_ with nothing posted on the
PR is not verifiable later. The comment is the audit trail. **Never silently
ignored, never silently fixed.**

### Rules the comment has to satisfy

- **Every finding gets a disposition.** Not a summary — a line per finding.
- **Attribute each to its source**, so the trail shows which lens caught what.
- **Name the head SHA.** Dual sign-off is defined against the current head:
  any push after a clean statement invalidates **both** reviewers until each
  re-posts.
- **A clean round still gets a comment** — `round N clean (Frank + George) @
<sha>`. Silence is not sign-off.
- **Never write "Frank + George" when only one has posted.** Say so per
  reviewer.
- **Low-severity findings are deferred to an issue, not dropped** — unless the
  fix is trivial enough to just do, in which case it is FIXED like any other.

### Convergences are worth calling out

Findings both lenses raise independently are historically the highest-confidence
class in a round. The triage template has a section for them; use it.

### Capped is not clean

**The cap is 4 rounds.** Hitting it with findings still open is an
**escalation, not an approval**. It blocks merge until the residual findings are
named and explicitly accepted. "We ran out of rounds" is never sign-off.

**At the cap, ask rather than stop.** Report which shape the round has, using
the distinction the section above already draws: a **chain** (Frank's pattern —
roughly one finding per round, each a refinement of the previous fix) is
converging and often deserves one more round; **siblings** (George's pattern —
new instances of the same defect class) mean the fix approach is wrong and
another round will not help. The round number cannot tell those apart. A person
reading the last round's findings can, so the decision is theirs.

### Decompose before the DRI picks

Decided 2026-09-18, after #474 capped on a chain that reversed itself twice.
The coordinator posts a **judgment sheet** on the PR before asking for the
pick, and the pick is made from the sheet. The method is borrowed from the
TypeSafe skill's guidance on typed judgments; no external service is involved —
every answer comes from the tree, the spec, a device, or an issue.

1. **Name the action.** The options on the table (typically: reduce, one more
   round, close), stated as what would ship.
2. **Work backward to the judgments.** Each is one narrow question with a
   typed answer — yes/no, or one of a fixed set — never "is the PR right?".
   Split independently useful dimensions: what each unguarded path costs; what
   state each fix's correctness depends on; whether that state has been
   observed on a device; whether the suite can simulate it; whether an
   evidence path exists. Include a "cannot tell" outcome.
3. **Answer each from the strongest evidence**, one line of evidence per
   answer: file:line at the head SHA, the primary spec's algorithm text (not a
   secondary summary), the issue comment, the device log. A judgment answered
   only from the PR's own comments is marked inferred.
4. **Compose as rules**, not narrative: "shippable if independent of the
   unobservable state, or the state is observed, or simulable" is a rule that
   reads the answers; a paragraph is not.
5. **State confidence per judgment** and what would change it.

The sheet goes in the round's triage comment or a decision comment stamped
with the head SHA, with the pick and its stop rule under it. What it produced
the first time: the question no round had asked (which guard's correctness
depended on the unobserved state), a false spec claim in two docblocks, and
the cost of "close" that the escalation had left implicit.

## Traps, each of which cost a dead run

These are not theoretical. They were paid for across many review rounds on an
earlier project and are handled in the scripts.

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
- **The verdict is read from `--output-format json`'s completion object, not
  from live-streamed stdout** (#348 round 3). Confirmed directly (round 2,
  and again round 3 via a live smoke call): `--output-format json` prints
  exactly one JSON object, once, at genuine completion, whose own `"text"`
  field is the model's final answer — grok's equivalent of Codex's
  `-o/--output-last-message`. `george.sh` captures that object to its own
  file, cleared before every run, extracts `"text"`, and `verdict_token()`
  reads **only** that extracted text — never the report file (which may also
  carry diagnostic stderr) and never a window over a live transcript. See
  `scripts/review/_verdict.sh` for the full history of why the file's
  previous distance-based tail-window approach was replaced.
- **Losing live-streamed stdout costs nothing.** The runners that watch a
  George run for a stall watch `~/.grok/logs/unified.jsonl` for a quiet PID,
  not stdout — grok goes quiet on stdout for 5-10 minutes at a stretch between
  tool loops regardless of output format, so no liveness signal this harness
  depends on was lost by moving off streamed stdout.
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

The two lenses have already diverged in practice: the diff-local pass has come
back clean where the deep-tree pass found a real authorization gap in untouched
code. **The asymmetry is the point — never run one as a fallback for the
other.**

## Guard design notes

Two guards exist, and both were wrong on the first attempt:

1. **Read-only verification** compares content hashes, not `--stat`. Frank's
   own review of this pipeline caught that a stat comparison misses an edit
   preserving insertion/deletion counts, and misses content changes to
   untracked files entirely.
2. **Failed-run detection** keys on the completion artifact's _shape_ (no
   verdict line in it, or "P1: Not assessed"), never on scanning for error
   strings, and — as of #348 round 3 — never on a window over a live
   transcript either. The transcript echoes the diff, so when the review
   scripts are themselves under review a substring match finds its own
   source and reports a false failure; a distance-based tail window has its
   own failure mode (a draft verdict close enough to a stall still passes).
   Both reviewers now read a verdict only from a completion artifact cleared
   before the run — Frank's `-o/--output-last-message` file, George's
   extracted `--output-format json` "text" field — never from `$REPORT`
   itself.

## Provenance

The George preamble carries over the prompt an earlier project used. Frank's was
reconstructed from the lens description inside George's prompt ("Reviewer A
covers the diff-local lens; do not spend your effort on style or diff-local
nits") and adapted to this repo. Treat Frank's as a faithful reconstruction
rather than an exact copy.

## A known review-noise item

Each agent reads its **own** instruction file — Claude reads `CLAUDE.md`, Codex
reads `AGENTS.md`. Where those two files disagree, Frank flags the mismatch on
review. Declining, with an explicit reference to the instruction file the
authoring agent follows, is the correct response. This repo's `CLAUDE.md` simply
defers to `AGENTS.md`, so the conflict should not arise here.
