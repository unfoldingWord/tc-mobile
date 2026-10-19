# 0012 — Recordings belong to the community that made them

**Status:** Proposed · **Date:** 2026-10-14 (the debrief; this file written 2026-10-19) · **Source:** the October 2026 training debrief, a principle stated by the team and recorded by role · **Issue:** [#1436](https://github.com/unfoldingWord/tc-mobile/issues/1436)

This ADR is **Proposed**, not Accepted. The requirements owner has not yet
confirmed the wording below or said what "the community" means. It moves to
Accepted when the requirements owner does, and a later amendment can sharpen the term. Until then
the principle is the team's stated position, written down so that future work
meets it first.

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

"The community" is deliberately **left undefined** here. Whether it means the
team that recorded or the wider language community is the requirements owner's
call, and this ADR does not make it in a paraphrase.

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

**Not changed by this ADR.** `PRIVACY.md` is untouched. Whether the principle
should also appear there as a public promise is a separate policy call for the
DRI and the requirements owner. No code, flag or storage is added.
