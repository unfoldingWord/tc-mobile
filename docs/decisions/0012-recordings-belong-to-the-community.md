# 0012 — Recordings belong to the community that made them

**Status:** Accepted 2026-10-19 (S15) · **Date:** 2026-10-14 (the debrief; this file written 2026-10-19) · **Source:** the October 2026 training debrief, a principle stated by the team and recorded by role · **Issue:** [#1436](https://github.com/unfoldingWord/tc-mobile/issues/1436)

This ADR is **Accepted**. On 2026-10-19 the requirements owner answered three
questions about it: R14 (who "the community" is), R15 (whether `PRIVACY.md`
carries it), both recorded below, and S15 (whether to mark it Accepted).
S15-consent-wording, option `accept`: "Yes, mark it Accepted". The answer
carries no note. It was recorded in
[`v2-plan.md`](../design/v2-plan.md#round-3-decisions-recorded-2026-10-19).

What the acceptance covers is the wording the requirements owner was asked
about. The author's reading under Consequences is the author's inference, and
no recorded answer says it was separately reviewed; read it as a reading, not as
a further decision.

## Context

What the app does today is stated elsewhere, and this ADR cites those places
rather than restating them, so it cannot go stale beside them:

- [`PRIVACY.md`](../../PRIVACY.md), "What leaves your device", for what leaves
  the phone and when.
- [ADR 0005](0005-no-backend-in-phase-1.md), for the decision to ship no
  backend, no accounts and no API.
- AGENTS.md, "Errors have a channel before they have copy", for the one other
  thing that leaves the phone through the OS share sheet (the failure log).

Nothing in the repo recorded a rule for the _next_ kind of feature: one that
uses recordings beyond the community's own work. Without one, such a feature
starts from what can be built and adds consent afterwards. How that maps onto
leaving the phone is only the author's reading, under Consequences.

## Decision

The principle, quoted verbatim from #1436:

> Recordings belong to the language community that made them. Any future use of
> recordings beyond the community's own work, such as training a language model
> or other data collection, must be **opt-in** and clearly explained to the
> people recording.

### Who "the community" is (R14)

The requirements owner's answer to R14, recorded 2026-10-19, verbatim:

> The team that made the recording

with the note:

> But give the opportunity to clarify/specify where appropriate

So "the community" means the team that made the recording. **The following is
inference, not the requirements owner's words:** the note implies that a feature
which uses this principle should let the team state or refine who the community
is where that matters, rather than assume it from who holds the phone. What that
looks like for any one feature is that feature's design, not decided here.

### Whether this is a public promise (R15)

The requirements owner's answer to R15, recorded 2026-10-19, verbatim:

> Not yet: keep it internal until a sharing feature needs it

So `PRIVACY.md` does not carry the principle as a public promise, and this ADR
and the PR that adds it leave `PRIVACY.md` untouched. The question comes back
when a sharing feature needs it.

## Consequences

**The following is the author's reading of the principle, not the requirements
owner's words.** It is offered so a reviewer can accept, narrow or strike each
line.

- A feature that moves recordings off the phone, other than through the
  person's own Share, starts with the consent design and the explanation shown
  to the person recording, before any capability is built.
- Consent is asked of the person recording, in words they can follow. The UI is
  for people who may not read (AGENTS.md, "Purpose" and the state-in-place
  rule), so audio or visual explanation is the starting point, not a text
  dialog.
- Declining leaves the app fully usable.
- Nothing is opt-out or on by default.

**Relation to ADR 0006.** [ADR 0006](0006-obs-content.md) records OBS-derived
recordings as CC BY-SA. This ADR adds a consent step for further use of the recordings and does **not** change
ADR 0006's licence position.

**Not changed by this ADR.** `PRIVACY.md` is untouched, by the requirements
owner's answer to R15 above. No code, flag or storage is added.
