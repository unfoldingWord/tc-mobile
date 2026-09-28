import { expect, type Locator, type Page } from "@playwright/test";

/**
 * The toolbar's "Edit recording" control (`.recorder-toolbar`, not the
 * ≡-menu's own "Edit recording" row), clicked safely.
 *
 * #846/#848/#825: every spec that records a take, taps Stop, and then taps
 * this control raced it — "Selection start" never mounted, on
 * `recorder-selection.spec.ts:71,433,506` and `edit-history-cue.spec.ts:103`,
 * on PRs that touch none of that code. The shared cause is not the take
 * length or a missing wait for Stop's own button label — every one of those
 * specs already waited for `getByRole("button", { name: "Record" })` to
 * reappear, or clicked Edit immediately after Stop, and both raced the same
 * way.
 *
 * The real precondition is `commitTake`'s OWN async tail
 * (`src/components/recorder.tsx:1263-1433`), not the recorder's state
 * machine. `recording` (`recorder.tsx:489`, `state === "recording"`) — the
 * boolean the Record/Stop label reads (`recorder.tsx:3585`) — flips as soon
 * as `use-recorder.ts`'s `stop()` finishes its OWN decode and calls
 * `setState("idle")` (`src/hooks/use-recorder.ts:949,973,982` — the
 * empty-blob, decode-success and decode-throw exits, respectively).
 * `commitTake`
 * still has two more awaits after that: `saveRecording(...)` and
 * `reloadView()` (`recorder.tsx:1313-1349`), and `isClosing` — the flag that
 * actually gates the toolbar control — does not clear until `reloadView()`
 * resolves. `editor.working`, which `onEnterEdit` reads directly on a
 * non-recording tap (`recorder.tsx:1592-1596`), is stale until that same
 * `reloadView()` lands (the comment at `recorder.tsx:1340-1347` is explicit
 * about why the reload is awaited before anything else runs).
 *
 * So there is a real window — Record visible, `isClosing` still true — where
 * the toolbar's Edit control is only SOFT-blocked: `busy={isClosing}`
 * (`recorder.tsx:3690`) sets `aria-busy` and swallows `onClick`
 * (`src/components/control.tsx:143`) WITHOUT setting the native `disabled`
 * attribute (`control.tsx:149`, `!busy` in the expression). Playwright's
 * `click()` actionability only reads the native `disabled` DOM property,
 * never `aria-busy`/`aria-disabled`, so it clicks a control whose `onClick`
 * prop is `undefined` — the click "succeeds" and does nothing, and the next
 * assertion times out waiting for an effect that was never triggered. This
 * was reproduced locally (CPU-throttled, see the PR body) with the same
 * accessible-name snapshot every CI failure recorded: "Record" and
 * "Edit recording" both present, no selection frame, no error.
 *
 * `aria-busy` is the one attribute that tracks the real gate: it is set from
 * `isClosing` in the same render `editReason`/`committing` reads
 * (`recorder.tsx:2663`), so waiting for it to clear is waiting on the commit
 * itself, not on a proxy that can lag it.
 *
 * **#857 correction:** while a take is LIVE this control is `aria-disabled`
 * with the accessible name `"Edit recording. Stop recording to edit."`
 * (`recorder.tsx`'s `editToolbarHint`, which passes `strings.stopToEdit` only
 * while `recording`; the commit window after Stop keeps the plain name). An
 * `exact: true` locator would match NOTHING in the live-take frame, and
 * `not.toHaveAttribute` on zero elements is not the claim "found the control
 * and its `aria-busy` is gone". Matched by prefix instead, so the same
 * element is tracked through every name it wears.
 */
export function editRecordingButton(page: Page): Locator {
  return page
    .locator(".recorder-toolbar")
    .getByRole("button", { name: /^Edit recording/ });
}

/** Click the toolbar's Edit control once the commit it may be racing has
 * actually landed — see {@link editRecordingButton}'s docblock. */
export async function clickEditRecording(page: Page): Promise<void> {
  const button = editRecordingButton(page);
  // A negated assertion passes on its first sample when `aria-busy` is ABSENT,
  // which is also the pre-Stop frame. Pin the post-Stop (idle) render first so
  // the gate below cannot pass on the frame before the commit started. Every
  // caller is post-Stop; do not use this from a live take.
  await expect(
    page.getByRole("button", { name: "Record", exact: true })
  ).toBeVisible();
  await expect(button).not.toHaveAttribute("aria-busy", "true");
  await button.click();
}
