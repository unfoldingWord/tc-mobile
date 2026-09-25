# O4 design system (from the workbench, round 4)

Status: **proposed**. Extracted 2026-09-25 from the "tC Mobile O4 Workbench"
artifact (O4 Polish current, round 4). The workbench says its colour table
"becomes the colour section of the design system once you approve it". This
branch does not record that approval; treat every value here as awaiting it.

What this branch changes, and what it does not:

- **Changed:** layer 1 (`1-primitives.css`) gains the O4 colour primitives;
  layer 2 (`2-semantic.css`) gains the O4 roles in both themes; the Tailwind
  bridge (`globals.css`) aliases them; `tests/contrast.test.ts` gates the
  pairs that carry an icon or text.
- **Not changed:** `3-components.css`, any component, `icon.tsx`. Nothing in
  the app reads a new role yet, so the UI renders exactly as before. Geometry,
  type, motion and icons below are the reference for that adaptation work.

Evidence class: every value was read from the workbench's CSS and JS source.
Contrast ratios are computed from token values with the WCAG 2.x formula, not
measured on a device.

## 1. Colour roles

Existing roles are unchanged and not repeated here (see `2-semantic.css`).
The workbench's table confirms their values match O4.

| Role             | Used for                               | Dark                   | Light                  | Primitive (dark / light)                                  |
| ---------------- | -------------------------------------- | ---------------------- | ---------------------- | --------------------------------------------------------- |
| `--s-well`       | Chips, small round buttons, empty dots | `#1d2632`              | `#eef1f5`              | `cool-800` / `cool-100`                                   |
| `--s-mark-empty` | Empty progress dots and bars           | `#384454`              | `#b9c2ce`              | `cool-600` / `cool-300`                                   |
| `--s-card-edge`  | Card hairline (light only)             | `transparent`          | `#d7dde5`              | — / `cool-200`                                            |
| `--s-dim`        | Behind a sheet or dialog               | `rgba(6,9,13,.72)`     | `rgba(16,24,33,.45)`   | literal                                                   |
| `--s-voice-dim`  | Waveform past the playhead             | `rgba(230,164,68,.34)` | `rgba(184,124,34,.32)` | literal                                                   |
| `--s-playhead`   | Playhead line                          | `#ffffff`              | `#101821`              | `cool-000` / `cool-900`                                   |
| `--s-live-quiet` | Erase tiles, recording chip            | `#3a1512`              | `#f8d6d2`              | `red-950` / `red-100`                                     |
| `--s-warn-quiet` | Storage banner, crash icon ground      | `#3a2810`              | `#fbe9d3`              | `warn-950` / **`warn-100` (new)**                         |
| `--s-warn-text`  | Warning words and icons                | `#f0bb6e`              | `#8a4f0f`              | `amber-400` / **`warn-700` (new)**                        |
| `--s-hear`       | Every "hear this" speaker icon         | `#4f93f8`              | `#1f66d6`              | **`blue-400` / `blue-600` (new)**                         |
| `--s-tile-ink`   | Icons on coloured tiles                | `#ffffff`              | `#ffffff`              | `cool-000`                                                |
| `--s-edit`       | Edit tile                              | `#2458d8`              | `#1f4fc4`              | **`blue-700` / `blue-800` (new)**                         |
| `--s-name`       | Name tile, naming pencil               | `#7c4ddb`              | `#6b35d0`              | **`violet-600` / `violet-700`**                           |
| `--s-send`       | Share tile and share button            | `#11796d`              | `#0e7468`              | **`teal-700` / `teal-750`**                               |
| `--s-send-ring`  | Share progress ring                    | `#2bd4bf`              | `#14a898`              | **`teal-300` / `teal-500`**                               |
| `--s-cover-*`    | Book covers: amber, teal, plum, blue   | same both themes       | same both themes       | `amber-600`, `teal-700`, **`plum-700`**, **`blue-cover`** |

Tailwind aliases: `--color-<role>` for each row above, plus the existing
`voice-quiet`, `done-quiet` and `guide` roles, which had no alias before.

### Contrast (computed)

| Pair                                      | Dark                  | Light           | Gate in this branch   |
| ----------------------------------------- | --------------------- | --------------- | --------------------- |
| tile-ink on edit / name / send            | 6.1 / 5.3 / 5.3       | 7.1 / 6.9 / 5.7 | ≥ 5:1 (G9's claim)    |
| white on cover amber / teal / plum / blue | 3.5 / 5.3 / 8.2 / 6.4 | same            | ≥ 3:1 non-text        |
| hear on surface / well                    | 5.7 / 5.0             | 5.3 / 4.7       | ≥ 3:1 non-text        |
| warn-text on warn-quiet                   | 8.1                   | 5.5             | ≥ 4.5:1 text          |
| live on live-quiet                        | 4.4                   | 3.6             | not gated (see §6)    |
| done on done-quiet                        | 5.5                   | 3.3             | not gated (see §6)    |
| send-ring on its ground                   | 10.3                  | **2.96**        | not gated (see §6)    |
| mark-empty on surface                     | 1.8                   | 1.8             | decorative, not gated |

## 2. Typography

O4 uses the system UI stack (`system-ui, ui-sans-serif, -apple-system, "Segoe
UI", Roboto, sans-serif`), matching `--p-font-ui`. Mono is
`ui-monospace, SFMono-Regular, Menlo, monospace` for the version stamp and the
recorder timestamp. Base is 16px / 1.3.

O4's sizes and weights do **not** fit today's type primitives
(`--p-text-*` 11/12/13/21/34, weights up to 600):

| O4 use                                      | Size | Weight |
| ------------------------------------------- | ---- | ------ |
| Recorder timer (tabular numerals)           | 32px | 800    |
| Dialog title                                | 22px | 800    |
| Book name, "teach" prompt                   | 21px | 700    |
| Sheet title                                 | 20px | 700    |
| Warning banner text                         | 19px | 700    |
| Chapter number badge                        | 18px | 800    |
| Name input                                  | 18px | 400    |
| Segment number badge, edit pill             | 17px | 800    |
| Big buttons (Done, pill buttons), file name | 17px | 700    |
| Chips, breadcrumbs                          | 16px | 700    |
| Recorder timestamp (mono)                   | 15px | 500    |
| Chapter name                                | 15px | 600    |
| Tile labels, system-sheet meta              | 14px | 400    |
| Version stamp (mono)                        | 12px | 400    |

Decision needed before layer 1 changes: add O4's sizes and 700/800 weights
as primitives, or map O4 onto the existing five sizes. This branch does
neither.

## 3. Geometry

Radii O4 uses: 3, 5, 7, 9, 10, 12, 14, 15, 16, 18, 20, 22, 26, 30, 42, 50%.
Today's primitives are 8/10/14/18/full. The recurring ones that match:
10 (chips, crumbs), 14 (square buttons, previews), 18 (book card).
New recurring values: 12 (chapter rows, inputs), 16 (segment rows), 20
(tile buttons, recorder stage), 22 (dialog), 26 (bottom sheets).

Hit targets and controls:

| Part                | Size                       | Shape / fill                                                                                      |
| ------------------- | -------------------------- | ------------------------------------------------------------------------------------------------- |
| Header              | 56px tall                  | inset 10px left, 12px right, top 14                                                               |
| Header ghost button | 44 × 48                    | radius 12, `--s-ink-muted`                                                                        |
| Chip / breadcrumb   | 40px tall                  | radius 10, `--s-well`; live/voice/done variants on their quiet roles; crumbs chevron-clipped 13px |
| Book card           | —                          | radius 18, pad 10, `--s-surface`, `--s-card-edge` border                                          |
| Book cover          | 72 × 90 (sm 52 × 64)       | radius 9 (sm 7), inset 7px spine shadow `rgba(0,0,0,.16)`                                         |
| Chapter row         | 68px tall                  | radius 12, `--s-floor`                                                                            |
| Chapter number      | 44 × 44                    | radius 10, `--s-well`, 18/800                                                                     |
| Progress dot        | 13px                       | circle                                                                                            |
| Segment row         | 90px tall                  | radius 16, `--s-surface`; selected = 2px `--s-guide` outline                                      |
| Segment badge       | 44 × 44                    | circle, `--s-well`; done = `--s-done`                                                             |
| Row transport       | 72 × 72                    | circle; play `--s-voice`, record `--s-live`                                                       |
| Speaker button      | 52 × 52                    | circle, `--s-well`, glyph `--s-hear`                                                              |
| Square button       | 56 × 56                    | radius 14, `--s-well`                                                                             |
| Menu tile           | 76 × 76                    | radius 20, label 14px below, gap 8                                                                |
| Bottom sheet        | inset 8                    | radius 26, pad 12/16/20, handle 56 × 5                                                            |
| Dialog              | inset 18, top 230          | radius 22, shadow `0 24px 48px rgba(0,0,0,.35)`; buttons 76 tall, radius 14, 2-col                |
| Recorder stage      | top 80, 632 tall           | radius 20, `--s-surface`                                                                          |
| Recorder transport  | 64 (secondary), big button | circles                                                                                           |
| Trim handle         | 30 × 56                    | radius 15, `--s-voice`                                                                            |
| Big mic / OK        | 80 × 80                    | `--s-live` / `--s-done`                                                                           |
| Share button        | 140 core in 176            | `--s-send`, ring `--s-send-ring`                                                                  |
| Error circle        | 136 (warn 170)             | `--s-raised` (light `--s-well`)                                                                   |
| Wide guide button   | 280 × 84                   | radius 42, `--s-guide`                                                                            |
| Pill button         | 60 tall                    | radius 30, `--s-well`, 17/700                                                                     |

Guide ring: `box-shadow: 0 0 0 5px var(--s-floor), 0 0 0 8px var(--s-guide)`
(outset, matching the existing rule in `3-components.css`).

## 4. Motion

| Name       | Duration  | Use                                 |
| ---------- | --------- | ----------------------------------- |
| micPulse   | 1.3s loop | Big mic while recording a name      |
| liveEdge   | 1.2s loop | Recorder stage edge while recording |
| blink      | 1s steps  | Recording dot beside the timer      |
| armed      | 1.6s loop | Share ring when ready to send       |
| guidePulse | 1.8s loop | Guide ring on the next action       |
| aud        | 0.9s ×2   | "Audible" ping on the waveform      |
| shake      | 0.35s ×2  | Refused action                      |

All are disabled under `prefers-reduced-motion`. Today's primitives allow two
durations (60ms, 140ms) and say "anything else is noise". These are ambient
loops, not transitions, so they may need a separate rule rather than new
`--p-dur-*` steps.

## 5. Icons

`docs/design/o4/o4-icons.svg` is a sprite of the workbench's full set (24-unit
grid, stroke 2.2 unless noted, `currentColor`). `icon.tsx` draws on a
22-unit grid with ~1.8 strokes, so these are reference drawings, not drop-ins.

- **Already in `icon.tsx`** (sprite id ends in `--o4`): play, pause, scissors,
  check, trash, share, back, more, plus, undo, redo, sun, moon, chevron-down,
  chevron-right, alert, zoom-in, paste.
- **New to the app:** hear, hear-large, mic, mic-off, book, book-open, pencil,
  restart (compare `retry`), forward, open, phone, tap-hand, file-zip,
  file-audio, flag, tag, person, earlier, later.

## 6. Open decisions

1. **Blue is overloaded.** `1-primitives.css` reserves blue for "the next
   required action, and nothing else". O4 adds blue for the Edit tile, the
   speaker icon and a book cover. O4's gap note G9 raises this; nothing
   settles it. Until it is settled, only `--s-hear`, `--s-edit` and
   `--s-cover-blue` read the new blues.
2. **Light share ring** is 2.96:1 on white, just under the 3:1 non-text floor.
3. **Light quiet washes** (`live` on `live-quiet` 3.6, `done` on `done-quiet`
   3.3) are fine as fills with icons but below AA if used as small text.
4. **Type scale and weights** (§2) and **radii** (§3) need a layer-1 decision.
5. **Covers.** The workbench's JS also carries an older five-colour gradient
   cover set (amber, green, blue, purple, red). The screens and colour table
   use the four flat covers above; this branch follows those.

## 7. Screen map (reference)

O4 states: 01 Books empty · 02 New book · 03 Books list · 04 Book menu ·
05 Chapter empty · 06 Chapter with segments · 07 Segment menu · 08 Recorder
idle · 09 Recording · 10 Recorded · 11 Playing · 12 Editing / trim · 13 Erase
confirm · 14 Share chapter · 15 Share progress · 16 Mic denied · 17 Storage
warning · 18 Crash / recovery.

Gaps the workbench filled: G1 Books menu · G2 Chapter menu · G3 Recorder menu
· G4 Name sheet · G5 Record again asks first · G6 Delete book asks first ·
G7 Share a whole book · G8 Marking done · G9 New colours · G10 Adding a segment.
