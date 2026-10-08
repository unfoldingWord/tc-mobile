/**
 * The wide guide button's `className`, for `SaveFailed`'s terminal
 * (`downgrade`) Restart arm (#1088 S9).
 *
 * O4's `.o4-err-wide` fills the button with `--s-guide` (blue) — the wide
 * guide button's own colour, `docs/design/o4-design-system.md` §3. Arming it
 * used to add the `text-live` Tailwind utility ON TOP of that fill, painting
 * the retry glyph red on blue (S9: "reads red on blue", flagged on #948's
 * 2026-09-25 thread and carried to #1088). Neither the design record's colour
 * table nor its geometry table names an armed variant for this button at all
 * — a real gap, not a choice this fix is overriding; a follow-up note for the
 * design record is in this PR's own body, since `docs/design/o4-design-system.md`
 * is owned by a different lane this batch.
 *
 * The fix swaps the WHOLE fill to `--s-live`/`--s-live-ink` instead
 * (`.o4-err-wide--armed`, `src/app/styles/o4/errors.css`) rather than
 * choosing a different text colour on the still-blue fill: `--s-live` +
 * `--s-live-ink` is the same solid-red-circle pairing `.control--record`
 * already uses for "this is live" (`3-components.css`), so the glyph stays
 * legible AND the colour still reads "irreversible", the same signal every
 * OTHER armed control in this app gives (the Discard button below this one)
 * — just carried by the fill instead of the text, because this button's fill
 * is already spoken for by `--s-guide`. `tests/contrast.test.ts` gates
 * `--s-live-ink` on `--s-live`.
 *
 * Pure and exported so the fix is behaviour a test calls directly:
 * `restartArmed` is derived component state, set by a tap, which
 * `tests/render.ts`'s static markup cannot reach (`tests/save-failed.test.ts`'s
 * own docblock says the same about this screen's Send-log control) —
 * `tests/save-failed-armed.test.ts` is the only place a red-first test for
 * this fix could live.
 */
export function restartWideButtonClass(armed: boolean): string {
  return armed ? "o4-err-wide o4-err-wide--armed" : "o4-err-wide";
}
