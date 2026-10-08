# Dual review — Frank and George

Two independent reviewers run on every PR before merge, with **deliberately
different lenses** so they do not both find the same class of defect.

|       | Reviewer   | Backed by | Lens                                                                                     |
| ----- | ---------- | --------- | ---------------------------------------------------------------------------------------- |
| **A** | **Frank**  | Codex     | **Diff-local** — defects inside the change itself                                        |
| **B** | **George** | Grok      | **Deep-tree** — defects in the interaction between changed code and the _unchanged_ tree |

The split is the point. Reviewer A reads the diff closely; Reviewer B chases
every changed symbol out into the rest of the repository — call sites,
invariants defined elsewhere, lifecycle and cache interactions, contract
mismatches. A single reviewer doing both does neither well.

## Who runs the reviews

**The uwreview bench runs both lenses**, on the review VM, and posts its rounds
on the PR (retired 2026-10-08: the local `scripts/review/*` harness, #1343;
since 2026-09-28 the bench has been the review path). **Nobody runs a reviewer
locally — not the author, not a lane, not the coordinator.** A lane builds,
runs `npm run verify` and `npm run check:prepush`, marks the PR ready, and
stops; the review happens on the PR.

What the bench's comments look like, as observed on PRs #1346 and #1351
(2026-10-08):

- One comment per lens per round, authored by `uwreview`, headed with the head
  SHA and ending in a `VERDICT:` line and a machine marker such as
  `<!-- uw:review frank round=1 verdict=clean sha=<short> -->`.
- A combined verdict review (`uw:review verdict=approve sha=<short> tier=<T>
builders=<who> frank=<verdict> george=<verdict> checks=<pass|…>`) quoting
  both lenses, with the tier it derived.

What this file does **not** know, because the repo does not say: how the bench
words a non-clean round, how it decides a round number after a push, and how it
treats an exempted tier. Do not describe those from memory; read the PR.

## Severity, and the merge bar

|        | Meaning               | Blocks merge?                 |
| ------ | --------------------- | ----------------------------- |
| **P1** | Must fix before merge | Yes                           |
| **P2** | Should fix            | Yes — medium and above blocks |
| **P3** | Nit                   | No; may become an issue       |

A finding worth acting on carries `file:line`, a **concrete failure scenario**,
and a minimal fix. A lens that finds nothing at a severity should say so
rather than stay silent.

After fixing review findings, **push and wait for the bench to review the new
head.** Repeat until both lenses are clean with no P1 or P2 outstanding. A
stale review is not a review: a push voids the round for **both** lenses.

## Merge policy

Frank and George _are_ the review. Once both are clean at the current head SHA
and CI is green, the DRI merges with `--admin` (the branch ruleset requires it;
a pinned command carries the full head SHA).

| Change                                                                          | Bar to merge                                                                                                                                                          |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application code                                                                | **Both reviewers clean @ the current head SHA**, CI green, then admin merge                                                                                           |
| Documentation and content                                                       | CI green, then admin merge                                                                                                                                            |
| Process/meta artifacts — `ci.yml`, `AGENTS.md`, `docs/review/**`, deploy config | Normally both reviewers, because these are _executed as instructions_. Exempting them is allowed but the **decision must be recorded on the PR**, never a silent skip |

**A test-only PR takes the tier of the code it covers, not a tier of its
own.** The tier sets _how many reviewers and rounds_ apply (the mapping at the
end of this rule). Which tier a test-only PR lands on is decided here. Classify in this order, and
stop at the first match:

1. A **gate test** — one that enforces a repo-wide rule, such as the drift
   guard, the dist gate, lint-boundary or the precache manifest — is Harness,
   regardless of which files it happens to touch.
2. Otherwise it takes the **strictest** tier (T1 over T2 over T3) of every
   surface it covers, using the "Risk tiers" table in `AGENTS.md` as the set —
   that table is total over `src/` (#864): every path resolves to a tier, by
   an explicit row or one of that table's own defaults, so this step never
   runs out of table to consult. The named globs are that table's own
   strings. For example: `hooks/*` (the product hooks, not the git hooks of
   the Harness row) or `lib/export/*` is T2; `lib/audio/*`, or
   `lib/storage/*` including the schema in `lib/storage/db.ts`, is T1;
   `components/*` or `app/*` is T3. An unlisted `lib/*` path — `lib/nav/*` and
   `lib/view/*` are the ones #864 named — is T1 by that table's default, and
   `src/types/*`, an ambient `*.d.ts` or `src/data/*` takes the strictest
   tier of its non-test importers (T1 if that set can't be determined); any
   other unlisted `src/**` path is T1. A test covering `hooks/*` and
   `lib/storage/*` is T1.

**The tier sets which reviewers run and how many rounds — not T2's on-device
check.** `AGENTS.md`'s "Risk tiers" table gives T2 a bar of "tests where
possible + on-device check on both Android and iOS"; that on-device check
verifies a change to the hook _code_ running on a device, and does not apply
to a PR that only adds or changes tests — there is no new code path for a
device to exercise. A test-only PR classified T2 gets T2's reviewer bar, not
the device check.

**The tier maps onto the table above.** A Harness test takes the process/meta
row, because a gate test is executed as an instruction. A T1, T2 or T3 test takes the
application-code row.

Added 2026-09-24 after the #839 audit found six test-only PRs (#797, #796,
#792, #790, #786, #784) merged on George only; a retroactive Frank pass found
real P2s on two of them (#845).

**P1 and P2 block. P3 goes to an issue** unless the fix is trivial enough to
just do.

**Capped is not clean.** Hitting the round cap with findings open is an
escalation: it blocks merge until the residual findings are named and
explicitly accepted, recorded on the PR.

## Freeze budget — expired

The freeze budget (decided 2026-09-21) was written to expire 2026-10-04, at
the v1.0.0 handoff. That date has passed and the section is removed: the
merge-policy table above applies unchanged, with no reduced-round tiers. A
future freeze needs a new DRI decision and a new section with its own dates.

## Gate comment template

Added 2026-09-28 after the #839 audit (#840 R2). Auditing 40 merged PRs found
the freeze exemption (since expired) recorded on some T3 gate comments (#803, #819) and
missing on others (#769, #762, #759, #768, #785, #794, #787) — same bar,
inconsistent record — and found gate comments citing `docs/review-policy.md`
and "RULINGS D6–D16", neither of which exists anywhere in this repo.

Every gate comment — the comment on a PR that records which tier and review
bar it was assigned — states, in one place, on one comment:

1. **The tier**: T1, T2, T3, or Harness/meta, per the "Risk tiers" table in
   `AGENTS.md` and the classify order in "Merge policy" above.
2. **The bar that applies**, naming the section of this file it comes from —
   "Merge policy" — by heading, not
   only by line number. A bare line number drifts: the exemption line quoted
   in #839 cited `dual-review.md:77`, and at this file's current head that
   line falls inside the "Merge policy" classify list, not the freeze table
   that existed then, because the file has been edited since. Cite the heading first; a line
   number may be added alongside it as a same-day convenience, never as the
   only anchor.
3. **Any exemption taken**, in the same comment, never a silent skip — for
   example: "Docs-only: merges on green CI, no reviewer round ("Merge policy"
   table, `docs/review/dual-review.md`)."

A gate comment may cite only a document that is either committed in this repo
(this file, `AGENTS.md`, `CONTRIBUTING.md`) or linked by URL. Naming a policy
document or a ruling series that is not in the tree and not linked — a
`review-policy.md`, a "RULINGS Dn" this repo has no record of — is itself a
defect in the gate comment, on the same footing as a missing tier or a missing
exemption line.

## Merging multiple lanes

When several lanes are in flight, **merge them one at a time, in a deliberate
order, pre-flighting each.**

The reason is mechanical: a reviewer's clean statement names a head SHA, and
merging lane A moves lane B's base. B's green checks and both its sign-offs now
describe a commit that is no longer what would land.

The loop, per lane:

1. Pick the next lane — prefer the one others depend on, and lanes touching
   shared files before lanes that do not.
2. **Pre-flight:** mergeable, CI green, both lenses clean @ the _current_
   head, as posted by the bench.
3. Merge.
4. **Re-base and re-check every remaining lane.** If a lane's diff changed
   materially, its reviews are stale — the bench re-reviews the new head.

Lanes that touch the same files should not be in flight simultaneously in the
first place; the lane brief is where that is prevented (see the
`batch-pipeline` skill's file-ownership check).

## The triage comment — mandatory, every round

**One triage comment per round, on the PR.** No exceptions, including a round
where both lenses found nothing. The bench posts the reviews; the triage
comment is the **PR author's (or the coordinator's) disposition of them**, and
the bench does not write it. It is written by hand, since the script that
drafted it is gone: list each finding under the lens that raised it, with the
head SHA, and give each a disposition — **FIXED** with a commit, **REFUTED**
with file:line evidence, or **DEFERRED** with a tracking issue.

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
<sha>`, which may simply point at the bench's clean verdict. Silence is not sign-off.
- **Never write "Frank + George" when only one lens has posted.** Say so per
  lens. A one-lens round is a deviation, never clean.
- **Low-severity findings are deferred to an issue, not dropped** — unless the
  fix is trivial enough to just do, in which case it is FIXED like any other.

### Convergences are worth calling out

Findings both lenses raise independently are historically the highest-confidence
class in a round. Call them out in the triage comment.

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

## Rules that outlived the local scripts

### A push voids the round

A clean statement names a head SHA. Any push after it, including a rebase or a
base merge into the PR branch, voids **both** lenses until the bench posts
again at the new head. Re-read the head SHA right before handing a merge
command over.

### Knowing when to stop looping

Frank tends to return roughly one finding per round, each a refinement of the
previous round's fix — a chain. George returns more, and deeper. When rounds
keep surfacing **new siblings of the same defect class**, that is the signal to
stop fixing case by case and open a follow-up issue for a systematic pass.

### Why both, always

The two lenses have already diverged in practice: the diff-local pass has come
back clean where the deep-tree pass found a real authorization gap in untouched
code. **The asymmetry is the point — never treat one as a fallback for the
other.**

### Failed local runs are gone, the lesson is not

A non-review ("could not inspect", narration only, no verdict) is a failed run,
never an approval. That was learned on the local scripts; if a bench comment
ever reads that way, treat it the same.
