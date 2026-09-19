# 0010 — Icon recognition: which glyphs a non-reader recognises without instruction

**Status:** Proposed · **Date:** 2026-09-19 · **DRI:** the dev lead drafts; the requirements owner owns and runs the check · **Issue:** [#249](https://github.com/unfoldingWord/tc-mobile/issues/249)

This ADR is **Proposed** because the evidence it needs does not exist yet. It
states a claim, the observation that would confirm or refute it, and what each
outcome changes. It moves to **Accepted** or **Rejected** when the protocol in
[`docs/training/icon-recognition-protocol.md`](../training/icon-recognition-protocol.md)
has been run and its sheets are in the evidence table below. Until then,
nothing here is a finding.

## Context

The app is icon-only by design: every control is a hand-rolled glyph
(`src/components/icon.tsx`, 26 of them), and the only text on screen is the
`strings.ts` table that A5 permits. A5 (requirements owner, 22 Aug) says
"zero-text is an aspiration to test, not a constraint to design against" — and
the test has never been scheduled. `docs/research/ui-patterns.md` records that
**not one of twelve reviewed products is navigable without reading**, so there
is no precedent to borrow: whether these glyphs carry their meaning to a
translator who does not read is an open question that only observation can
close.

`docs/design/pivot-plan.md` ("Also carried in their batches") proposed exactly
this: an ADR with a ten-minute recognition check at the October training as its
evidence. Several open decisions are parked on that evidence:

- **Q7** — spoken prompts instead of icons. Decided 2026-09-15 by the
  requirements owner: deferred past October, icons only for v1; #249 is what
  decides it later.
- **#91** — a non-reader affordance for select / cut / paste / zoom, "once real
  non-reader testing shows where people actually get stuck".
- **#178** and **#491** — share-outcome glyphs (partial / nothing / failed, and
  the success and in-progress halves). #178 names this check as its acceptance
  evidence.
- **#490** — the platform-native share glyph. **Decided 2026-09-19 by the dev
  lead:** the Android build draws Android's share glyph, other builds keep the
  tray, chosen at runtime from the platform; lands through the #491 lane. This
  decision was taken on one tester's report, ahead of the protocol; the
  protocol is what says whether it was right.

The training in the first week of October is the one time in this phase that
the app's audience is in a room with the people building it. Without a
protocol written in advance, what comes back is anecdote, and the icon-versus-
prompt decision gets made from opinion again.

## The claim under test

> **Hardware-derived or object-derived glyphs are recognised without
> instruction; software-convention glyphs are not.**

The two groups, as drawn in `src/components/icon.tsx`:

| Group                           | Glyphs                                                                                                                                            | Why the group is expected to behave this way                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hardware- or object-derived** | `record` (red disc), `play` (triangle), `pause` (two bars), `stop` (square), `zoom-in` / `zoom-out` (magnifier), `trash`                          | The shape is a thing in the world — a tape deck's buttons, a magnifying glass, a bin. Cassette players, radios and phones have carried them for decades.   |
| **Software convention**         | `selection` (brackets), `scissors`, `paste` (arrow onto a line), `menu` (≡), `share` (tray), `check` (Finished), `undo` / `redo`, `edit` (pencil) | The shape stands for an operation that exists only in software — a span, a clipboard, an overflow menu, a share sheet, a done state. It has to be learned. |

Two glyphs sit on the line, and the table places them deliberately:
`scissors` is an object, but the operation (removing a span of sound) has no
physical counterpart, so it is grouped with the conventions; `trash` is a
convention too in a strict sense, but a bin is a bin, so it is grouped with
the objects. If the results split those two the other way, that is a finding,
not a defect in the table.

**What "recognised" means.** A participant, shown a control on a live phone
and asked in their own language "what do you think this does?", answers with
the control's function (or a close paraphrase of it) before touching it. The
protocol records three outcomes per control per participant:

- **recognised unprompted** — named correctly before any tap;
- **recognised after one try** — not named, but after one tap the participant
  could say what it did and then do the task with it;
- **not recognised** — neither.

## What would confirm it, what would refute it

The protocol asks for **ten controls, eight or more participants across two
sites**. The eight is a judgement, not a power calculation (#249 says so);
two sites is so that one room's shared convention does not decide it.

**Confirms** (status → Accepted): for the object-derived controls, a clear
majority of participants at both sites are _recognised unprompted_; for the
convention controls, a clear majority are _after one try_ or _not recognised_.
The gap between the groups is visible on the summary sheet without a
statistic.

**Refutes** (status → Rejected), in either direction:

- **The conventions are recognised too.** A clear majority _unprompted_ on the
  convention glyphs as well. Then the claim's premise — that the software half
  of the app is where a non-reader is stuck — is wrong, and the icon-only path
  is closer to working than the plan assumed.
- **The objects are not recognised either.** No clear majority _unprompted_ on
  the object glyphs. Then the problem is not convention versus object, and
  glyph choice alone will not fix it.

**Cannot tell:** fewer than eight participants, one site only, or a sheet
returned without the site code and date. The ADR stays Proposed and the check
is re-run at the next opportunity. A result from one site is recorded in the
table but does not move the status.

A per-glyph split — most objects recognised, most conventions not, but one or
two glyphs on the wrong side of the line — **confirms** the claim and moves
those glyphs individually (see the next section). That is the expected shape
of a real result.

## What each outcome changes

| Outcome                                     | Q7 (spoken prompts)                                                                                                                                                         | #91 (select / cut / paste / zoom)                                                                                                                                 | #178 / #491 (share outcome glyphs)                                                                                                                                                                               | #490 (platform share glyph)                                                                                                                                           |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Confirmed**                               | Q7 reopens with a **scope**: prompts for the convention controls only, attached at `strings.ts`, not for the transport. The default (no prompt recorder) stands until then. | #91 gets its shape: a first-use disclosure for select / cut / paste; zoom drops out of #91 if the magnifier is recognised (the one data point so far says it is). | The outcome glyphs are designed as objects, not conventions — a state a person has seen (an empty container, a torn sheet), not a symbol — and each one goes through the same protocol before it is called done. | Stands, and is expected to help: a platform's own glyph is a learned convention the participant has already learned. Re-checked on the Android build at the next run. |
| **Refuted — conventions recognised too**    | Q7 closes as **no**: icons carry the load; a prompt layer would be sprawl.                                                                                                  | #91 narrows to whichever glyphs, if any, were _not recognised_, or closes.                                                                                        | Design freely from convention; the protocol still gates each new glyph.                                                                                                                                          | Stands on its own merits (one tester asked for it); no longer a recognition question.                                                                                 |
| **Refuted — objects not recognised either** | Q7 reopens **wide**: glyph choice alone is not the fix, and a spoken or facilitator-led first run is on the table for the whole app.                                        | #91 is subsumed by the wider question.                                                                                                                            | Paused until the wider question is answered.                                                                                                                                                                     | Stands; irrelevant to the wider question.                                                                                                                             |
| **Cannot tell**                             | Unchanged (deferred past October).                                                                                                                                          | Unchanged.                                                                                                                                                        | Unchanged.                                                                                                                                                                                                       | Unchanged.                                                                                                                                                            |

In every row the per-glyph detail matters more than the headline: a glyph on
the wrong side of its group's result is redrawn or given a disclosure on its
own, whatever the status line says.

## Evidence

One row per source. A row is **protocol** only when it comes from a sheet
filled in under `docs/training/icon-recognition-protocol.md`; anything else is
labelled for what it is. Nothing in this table is a protocol result yet.

| Date       | Source                                                                                                       | Kind                                                                        | Platform / build                                     | Glyph                  | Observation                                                                                                                                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-17 | [#249, comment of 2026-09-18](https://github.com/unfoldingWord/tc-mobile/issues/249#issuecomment-5731186151) | **Not the protocol.** One tester, self-reported after the fact, unprompted. | Android, `android-release-v0.2.4`, staging `8167a1d` | `paste`                | "the **paste** icon was not recognised as such until tapped to find out" — would record as _recognised after one try_.                                                                                                                       |
| 2026-09-17 | same                                                                                                         | same                                                                        | same                                                 | `zoom-in` / `zoom-out` | "the **zoom in/out** icons were called out as very clear" — would record as _recognised unprompted_.                                                                                                                                         |
| 2026-09-17 | same                                                                                                         | same                                                                        | same                                                 | `share`                | "the **share** icon did not convey in advance what it would do, and the tester later suggested Android's own share glyph (three joined dots) for the Android build" — would record as _not recognised_ before the tap. Led to #488 and #490. |

That one row set is consistent with the claim (an object recognised, two
conventions not), from one person who can read, on one platform, describing
their own experience afterwards. It is the reason the claim is worth testing,
not evidence for it.

## What is verified, and what is not

- **Nothing in this ADR has been run.** No participant has been shown a
  control under this protocol; the sheet has not been printed from a phone; the
  tasks have not been read aloud by a facilitator. The protocol is a plan.
- The glyph list and their groups are **code-read** from
  `src/components/icon.tsx` at `develop`. `stop` is in the icon set but no
  component renders it at `develop` (the record control shows `pause` while
  recording), so it is in the claim's table and not in the protocol's ten.
- The pivot plan and #249 write the row menu as `⋮`; the tree draws it with the
  `menu` glyph (three rules), the same glyph as the screen-level `≡`. The
  protocol tests the glyph as drawn.

## Consequences

- The training gets a ten-minute structured observation with a sheet, in
  place of anecdote. The requirements owner owns the protocol and runs it.
- The result lands **here first** — the evidence table and the status line —
  and only then in #91, Q7 (the register in `docs/design/pivot-plan.md`),
  #178 / #491 and #490. Issues cite the ADR; the ADR does not cite issue
  comments for its result.
- No code changes on this ADR. A glyph redrawn on the strength of a result is
  a T3 change in its own PR, citing the row that justified it.
- Privacy: the sheet carries a site code, a date and a participant count. No
  names, no photographs of participants, no recordings of participants, per
  `CONTRIBUTING.md`. A photograph of the **filled sheet** is how it travels.
