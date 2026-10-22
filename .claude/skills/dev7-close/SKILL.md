---
name: dev7-close
description: Stage dev7 of the tC Mobile issue pipeline. Update the issues and milestones, capture what was learned, add a progress-tracker entry, and write the session summary. Use at the end of an issue, or at the end of a session even when the work is mid-stream.
---

# dev7 · Close

## 1. Update the issues

- **Close an issue only when** every plan task has merged and dev6 passed, or
  its only open item is a recorded NEEDS-DEVICE check. Add `needs-device` first,
  confirm it with `gh issue view <n> --json labels`, and only then close, so a
  filter finds every closed but unchecked item. If the add fails or the label
  is missing, stop and leave the issue open. The label exists in the repo.
  Never close on a FAIL. Otherwise update the checklist and leave it open.
- A PR that said `Part-of #N` never closed it; check before saying "done".
- Milestones: every closed issue and merged PR is in the milestone of the sprint
  it closed or merged in; anything still open moves to the next sprint or
  Backlog explicitly, never silently (AGENTS.md "Versions and milestones").
- A blocked issue gets a comment naming what blocks it and what would unblock it.

## 2. Capture learnings

Ask: did anything surprise us, did a pattern emerge, did guidance mislead, did
the plan miss something? A learning a future lane needs goes in a short note to
the coordinator, who decides what is kept. Correct a false claim where you find
it in a living document (AGENTS.md "Engineering bar"); prefer deleting it to
restating it. Never write a run's output into a docblock or instruction file.

## 3. Progress tracker

One dated entry for the session in `docs/progress_tracker.md`: append-only,
newest first, dated with the user's local date, never the container clock. It
goes through its own docs PR, batched by the coordinator.

## 4. Session summary

Completed, in progress (at which stage), blocked (and on what), learnings
captured, next priority. Say what was not verified.

Exit: issues and milestones are current, learnings are handed to the
coordinator, the tracker entry is queued, and the summary is written.
