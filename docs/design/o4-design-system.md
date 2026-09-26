# O4 design system (from the workbench, round 4)

Status: **decided**. Extracted 2026-09-25 from the "tC Mobile O4 Workbench"
artifact (O4 Polish current, round 4), refreshed the same day for Tim's update
(see §8), and brought in line with the #937 answers and the #967 primitives
(#968). Every value that changed from the workbench's proposal cites the issue
comment that decided it; the decisions themselves are in §6.

Where the values live:

- **Colour:** layer 1 (`1-primitives.css`) holds the primitives, layer 2
  (`2-semantic.css`) the roles in both themes, and the Tailwind bridge
  (`globals.css`) aliases them. `tests/contrast.test.ts` gates the pairs that
  carry an icon, text or a control's boundary, and pins the two colour values
  #937 changed (`--s-edit`, the light `--s-send-ring`).
- **Type, radius, ambient motion:** layer 1, added by #967 (#939);
  `tests/o4-primitives.test.ts` pins them.
- **Geometry, icons, screen states:** this file and the workbench; they are
  not primitives.

Evidence class: every value was read from the workbench's CSS and JS source,
from a #937 / #947 / #949 decision comment, or from the two stylesheets named
above. Contrast ratios are computed from token values with the WCAG 2.x
formula, not measured on a device.

## 1. Colour roles

Existing roles are unchanged and not repeated here (see `2-semantic.css`).
The workbench's table confirms their values match O4.

| Role             | Used for                                     | Dark                   | Light                  | Primitive (dark / light)                          |
| ---------------- | -------------------------------------------- | ---------------------- | ---------------------- | ------------------------------------------------- |
| `--s-well`       | Chips, small round buttons, empty dots       | `#1d2632`              | `#eef1f5`              | `cool-800` / `cool-100`                           |
| `--s-mark-empty` | Empty progress dots and bars                 | `#384454`              | `#b9c2ce`              | `cool-600` / `cool-300`                           |
| `--s-card-edge`  | Card hairline (light only)                   | `transparent`          | `#d7dde5`              | — / `cool-200`                                    |
| `--s-dim`        | Behind a sheet or dialog                     | `rgba(6,9,13,.72)`     | `rgba(16,24,33,.45)`   | literal                                           |
| `--s-voice-dim`  | Waveform past the playhead                   | `rgba(230,164,68,.34)` | `rgba(184,124,34,.32)` | literal                                           |
| `--s-playhead`   | Playhead line                                | `#ffffff`              | `#101821`              | `cool-000` / `cool-900`                           |
| `--s-live-quiet` | Erase tiles, recording chip                  | `#3a1512`              | `#f8d6d2`              | `red-950` / `red-100`                             |
| `--s-live-text`  | Words on the live wash (D3)                  | `#ec7a70`              | `#a8322a`              | `red-400` / `red-700`                             |
| `--s-done-text`  | Words on the done wash (D3)                  | `#3fb968`              | `#1f6e3a`              | `green-500` / `green-700`                         |
| `--s-warn-quiet` | Storage banner, crash icon ground            | `#3a2810`              | `#fbe9d3`              | `warn-950` / `warn-100`                           |
| `--s-warn-text`  | Warning words and icons                      | `#f0bb6e`              | `#8a4f0f`              | `amber-400` / `warn-700`                          |
| `--s-hear`       | Every "hear this" speaker icon (blue, D1)    | `#4f93f8`              | `#1f66d6`              | `blue-400` / `blue-600`                           |
| `--s-tile-ink`   | Icons on coloured tiles                      | `#ffffff`              | `#ffffff`              | `cool-000`                                        |
| `--s-edit`       | Edit tile (Slate, D1b)                       | `#475569`              | `#475569`              | `slate-600` / `slate-600`                         |
| `--s-name`       | Name tile, naming pencil                     | `#7c4ddb`              | `#6b35d0`              | `violet-600` / `violet-700`                       |
| `--s-send`       | Share tile and share button                  | `#11796d`              | `#0e7468`              | `teal-700` / `teal-750`                           |
| `--s-send-ring`  | Share progress ring (D2 in light)            | `#2bd4bf`              | `#12a090`              | `teal-300` / `teal-600`                           |
| `--s-cover-*`    | Book covers, interim set: see "Covers" below | same both themes       | same both themes       | `amber-600`, `teal-700`, `plum-700`, `blue-cover` |

`--s-live-text` and `--s-done-text` are the words that sit on a live or done
wash (chips, crumbs, the clip pill), the way `--s-warn-text` is on the warn
wash. They are not `--s-live-ink` / `--s-done-ink`, which are the ink on the
solid fill.

Blue marks the next action (`--s-guide`), the speaker (`--s-hear`) and, until
#957 lands, the `--s-cover-blue` cover.

**Covers.** A book stores a cover colour its owner picks (D7), from a
**10-colour palette: amber, teal, plum, forest, brick, slate, rose, olive,
rust, cocoa** (D8b, amended from 12 by dropping pine and mulberry,
[#937 palette comment][937-palette]). #957 builds the stored field, the
palette and the picker, and holds the colour values; this file names the
keys. The four `--s-cover-*` roles above are the interim set until #957
replaces them; D1 takes covers off blue.

Tailwind aliases: `--color-<role>` for each row above except the two D3 text
roles, which have none, plus the existing `voice-quiet`, `done-quiet` and
`guide` roles, which had no alias before.

### Contrast (computed)

| Pair                                      | Dark                  | Light           | Gate                  |
| ----------------------------------------- | --------------------- | --------------- | --------------------- |
| tile-ink on edit / name / send            | 7.6 / 5.3 / 5.3       | 7.6 / 6.9 / 5.7 | ≥ 5:1 (G9's claim)    |
| white on cover amber / teal / plum / blue | 3.5 / 5.3 / 8.2 / 6.4 | same            | ≥ 3:1 non-text        |
| hear on surface / well                    | 5.7 / 5.0             | 5.3 / 4.7       | ≥ 3:1 non-text        |
| warn-text on warn-quiet                   | 8.1                   | 5.5             | ≥ 4.5:1 text          |
| live-text on live-quiet                   | 5.9                   | 4.9             | ≥ 4.5:1 text (D3)     |
| done-text on done-quiet                   | 5.5                   | 4.9             | ≥ 4.5:1 text (D3)     |
| send-ring on floor / surface              | 10.3 / 9.3            | 3.06 / 3.25     | ≥ 3:1 non-text (D2)   |
| live on live-quiet                        | 4.4                   | 3.6             | icons only, not gated |
| done on done-quiet                        | 5.5                   | 3.3             | icons only, not gated |
| mark-empty on surface                     | 1.8                   | 1.8             | decorative, not gated |

The solid live and done accents stay below AA on their light washes. That is
why D3 added the two text roles: words on a wash use `--s-live-text` /
`--s-done-text`, never the accent.

## 2. Typography

O4 uses the system UI stack (`system-ui, ui-sans-serif, -apple-system, "Segoe
UI", Roboto, sans-serif`), matching `--p-font-ui`. Mono is
`ui-monospace, SFMono-Regular, Menlo, monospace` for the version stamp and the
recorder timestamp. Base is 16px / 1.3.

O4's sizes and the 700/800 weights are layer-1 primitives (D4, added by #967).
Sizes are named by value; 12 and 21 reuse the existing `--p-text-sm` and
`--p-text-lg`. Weights: 400 `--p-weight-normal`, 500 `--p-weight-medium`, 600
`--p-weight-strong`, 700 `--p-weight-bold`, 800 `--p-weight-heavy`.

| O4 use                                      | Size | Size token    | Weight |
| ------------------------------------------- | ---- | ------------- | ------ |
| Recorder timer (tabular numerals)           | 32px | `--p-text-32` | 800    |
| Chapter title, chapter screen header        | 22px | `--p-text-22` | 800    |
| Dialog title                                | 22px | `--p-text-22` | 800    |
| Book name, "teach" prompt                   | 21px | `--p-text-lg` | 700    |
| Sheet title                                 | 20px | `--p-text-20` | 700    |
| Warning banner text                         | 19px | `--p-text-19` | 700    |
| Chapter title in a Books row                | 17px | `--p-text-17` | 800    |
| Chapter number badge                        | 18px | `--p-text-18` | 800    |
| Name input                                  | 18px | `--p-text-18` | 400    |
| Segment number badge, edit pill             | 17px | `--p-text-17` | 800    |
| Big buttons (Done, pill buttons), file name | 17px | `--p-text-17` | 700    |
| Segment title in a row                      | 16px | `--p-text-16` | 800    |
| Chips, breadcrumbs                          | 16px | `--p-text-16` | 700    |
| Recorder timestamp (mono)                   | 15px | `--p-text-15` | 500    |
| Chapter name                                | 15px | `--p-text-15` | 600    |
| Tile labels, system-sheet meta              | 14px | `--p-text-14` | 400    |
| Version stamp (mono)                        | 12px | `--p-text-sm` | 400    |

## 3. Geometry

Radii O4 uses: 3, 5, 7, 9, 10, 12, 14, 15, 16, 18, 20, 22, 26, 30, 42, 50%.
The existing primitives cover 8/10/14/18/full; the recurring ones that match
are 10 (chips, crumbs), 14 (square buttons, previews) and 18 (book card).
#967 adds O4's five recurring radii as primitives (D5), named by value:
`--p-radius-12` (chapter rows, inputs), `--p-radius-16` (segment rows),
`--p-radius-20` (tile buttons, recorder stage), `--p-radius-22` (dialog) and
`--p-radius-26` (bottom sheets). The one-off radii stay literal.

Hit targets and controls:

| Part                 | Size                       | Shape / fill                                                                                                                         |
| -------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Header               | 56px tall                  | inset 10px left, 12px right, top 14                                                                                                  |
| Header ghost button  | 44 × 48                    | radius 12, `--s-ink-muted`                                                                                                           |
| Chip / breadcrumb    | 40px tall                  | radius 10, `--s-well`; live/voice/done variants on their quiet roles; crumbs chevron-clipped 13px                                    |
| Book card            | —                          | radius 18, pad 10, `--s-surface`, `--s-card-edge` border                                                                             |
| Book cover           | 72 × 90 (sm 52 × 64)       | radius 9 (sm 7), inset 7px spine shadow `rgba(0,0,0,.16)`                                                                            |
| Chapter row          | 68px tall                  | radius 12, `--s-floor`; middle column 44px tall = optional 20px title + dots, gap 5                                                  |
| Chapter number       | 44 × 44                    | radius 10, `--s-well`, 18/800; when the chapter has a title it dims: transparent, `--s-ink-faint`, 2px inset `--s-well` ring         |
| Progress dot         | 13 → 5px                   | circle; wraps, and shrinks to fit (13/6, 11/5, 9/4, 7/3, 5/2 size/gap) in a 206px column, 44px tall without a title or 19px with one |
| Segment row          | 90px tall                  | radius 16, `--s-surface`; selected = 2px `--s-guide` outline; with a title: 22px title line over a 36px wave (56px without)          |
| Chapter header       | top 76, 46 tall, inset 22  | title 22/800 or a 120 × 30 spoken-name wave, then a 44px speaker; pushes the progress bar from top 80 to 130                         |
| Spoken-name wave     | 76 × 20 (header 120 × 30)  | `--s-voice` bars; stands in for a title that was only spoken                                                                         |
| Lifted row (reorder) | —                          | scale 1.03, z 8, shadow `0 14px 30px rgba(0,0,0,.38)`; a lifted chapter row takes `--s-raised`                                       |
| Segment badge        | 44 × 44                    | circle, `--s-well`; done = `--s-done-quiet` with `--s-done-text` (D19)                                                               |
| Row transport        | 72 × 72                    | circle; play `--s-voice`, record `--s-live`                                                                                          |
| Speaker button       | 52 × 52                    | circle, `--s-well`, glyph `--s-hear`                                                                                                 |
| Square button        | 56 × 56                    | radius 14, `--s-well`                                                                                                                |
| Menu tile            | 76 × 76                    | radius 20, label 14px below, gap 8                                                                                                   |
| Bottom sheet         | inset 8                    | radius 26, pad 12/16/20, handle 56 × 5                                                                                               |
| Dialog               | inset 18, top 230          | radius 22, shadow `0 24px 48px rgba(0,0,0,.35)`; buttons 76 tall, radius 14, 2-col                                                   |
| Recorder stage       | top 80, 632 tall           | radius 20, `--s-surface`                                                                                                             |
| Recorder transport   | 64 (secondary), big button | circles                                                                                                                              |
| Trim handle          | 30 × 56                    | radius 15, `--s-voice`                                                                                                               |
| Big mic / OK         | 80 × 80                    | `--s-live` / `--s-done`                                                                                                              |
| Share button         | 140 core in 176            | `--s-send`, ring `--s-send-ring`; outcome looks in §6 (D14–D16)                                                                      |
| Error circle         | 136 (warn 170)             | `--s-raised` (light `--s-well`)                                                                                                      |
| Wide guide button    | 280 × 84                   | radius 42, `--s-guide`                                                                                                               |
| Pill button          | 60 tall                    | radius 30, `--s-well`, 17/700                                                                                                        |

Guide ring: `box-shadow: 0 0 0 5px var(--s-floor), 0 0 0 8px var(--s-guide)`
(outset, matching the existing rule in `3-components.css`).

## 4. Motion

The seven ambient animations are a layer-1 group of their own (D6, added by
#967), separate from the two `--p-dur-*` transition steps. Under
`prefers-reduced-motion: reduce` every `--p-ambient-*` duration is `0s`, and a
rule that runs one still guards itself as well. Iteration counts belong to the
rule, not the token.

| Name       | Duration                     | Token                     | Use                                                                                                                                                                                                   |
| ---------- | ---------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| micPulse   | 1.3s loop                    | `--p-ambient-mic-pulse`   | Big mic while recording a name                                                                                                                                                                        |
| liveEdge   | 1.2s loop                    | `--p-ambient-live-edge`   | Recorder stage edge while recording                                                                                                                                                                   |
| blink      | 1s steps                     | `--p-ambient-blink`       | Recording dot beside the timer                                                                                                                                                                        |
| armed      | 1.6s loop                    | `--p-ambient-armed`       | Share ring when ready to send                                                                                                                                                                         |
| guidePulse | 1.8s loop                    | `--p-ambient-guide-pulse` | Guide ring on the next action                                                                                                                                                                         |
| aud        | 0.9s ×2                      | `--p-ambient-audible`     | "Audible" ping on the waveform                                                                                                                                                                        |
| shake      | 0.35s ×2                     | `--p-ambient-shake`       | Refused action                                                                                                                                                                                        |
| reorder    | 450ms hold, then 160ms shift | none (a gesture)          | Press-and-hold lifts a chapter or segment row; neighbours slide with `transform .16s ease`; 15ms haptic on lift; list auto-scrolls within 64px of an edge; moving 8px before the hold ends cancels it |

Reorder is a transition on a gesture, not an ambient animation, so it has no
`--p-ambient-*` token. It is tier 2 and drag only for the training (D10, D11).

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

D9: only the 13 new icons the screens use go into `icon.tsx`.

## 6. Decisions

Every decision below is final. The first two rounds were answered on #937
(closed); D12–D20 were answered on the #947 and #949 threads. Each entry links
the comment that holds the answer.

### Round 1 and 2 (#937)

Round 1 was answered by the requirements owner
([#937 round 1][937-r1]); round 2 and the palette by the DRI
([#937 round 2][937-r2], [#937 palette][937-palette]).

- **D1, blue.** The Edit tile and the blue book cover move off blue; the guide
  ring (`--s-guide`) and the speaker (`--s-hear`) stay blue. The requirements
  owner will review blue's use in O4 once the first APK with the new UI lands,
  against the #604 rule that blue marks the next required action
  ([#937 D1 note][937-d1]).
- **D1b, Edit tile:** Slate `#475569` in both themes, 7.58:1 under white tile
  ink ([#937 round 2][937-r2]).
- **D2, light share ring:** `#12a090` (`--p-teal-600`), 3.25:1 on white, gated
  at the 3:1 non-text floor on `--s-floor` and `--s-surface`
  ([#937 round 1][937-r1]).
- **D3, words on the quiet washes:** allowed, with darker text roles in light:
  `--s-live-text` and `--s-done-text` (values in §1), gated at 4.5:1 on their
  washes in both themes ([#937 round 1][937-r1]).
- **D4, type:** add O4's sizes and weights (§2) ([#937 round 1][937-r1]).
- **D5, radii:** add the five O4 radii (§3) ([#937 round 1][937-r1]).
- **D6, ambient motion:** allowed, off under reduced motion (§4)
  ([#937 round 1][937-r1]).
- **D7, covers:** people choose a cover colour, stored on the book; #957
  builds it ([#937 round 1][937-r1]). The book menu (04 / G1) gets a "Cover
  colour" tile that opens the picker ([#949 D7 note][949-d7]).
- **D8 / D8b, palette:** the 10 colours in §1 ([#937 palette][937-palette]).
- **D9, icons:** only the 13 the screens use ([#937 round 1][937-r1]).
- **D10, tier 2:** spoken titles (#952) after the training; reorder (#953)
  only if the restyle is done by 2026-09-29 ([#937 round 1][937-r1]).
- **D11, reorder:** drag only for the training. The workbench has no keyboard
  or switch-control path to move a row; that path is post-training
  ([#937 round 1][937-r1]).

### Share (#947)

- **D12, the Share control:** Share opens the O4 **share sheet** with the
  140-in-176 button, reusing #941's bottom-sheet and big-button pieces. It
  replaces the inline ≡-menu row ([#947 round 3][947-r3]).
- **D13, progress:** the **filling ring and per-item dots**, driven by real
  progress, not a static approximation ([#947 round 3][947-r3]). They are
  drawn after #996 lands, which covers the MP3 encode and adds a `skipped`
  count; skipped items draw as hollow dots ([#947 #996 note][947-996]).
- **D14, handed over:** the workbench's plain `check`, white on the `--s-send`
  core with the `--s-send-ring` ring. Not #850's ringed tick (`share-sent`),
  which the current look keeps ([#947 round 4][947-r4]).
- **D15, busy:** the workbench state: the share glyph, white on the `--s-send`
  core, with the filling ring. It waits on real progress (D13), with no
  interim look: no teal dots and no static ring ([#947 round 4][947-r4]).
- **D16, the six outcomes the workbench never drew:** each keeps its #850
  glyph inside the O4 140-in-176 circle, with the core coloured by the
  outcome's tone. These six are not in the workbench's G1–G10, so this table
  is their design of record ([#947 round 4][947-r4]):

  | Outcome   | Glyph (unchanged)              | Core       | Glyph ink       | Ring            |
  | --------- | ------------------------------ | ---------- | --------------- | --------------- |
  | partial   | `share-partial`                | `--s-send` | `--s-tile-ink`  | `--s-warn`, 3px |
  | nothing   | `share-empty`                  | `--s-live` | `--s-live-ink`  | none            |
  | failed    | `alert`                        | `--s-live` | `--s-live-ink`  | none            |
  | encoder   | `alert` (via failed)           | `--s-live` | `--s-live-ink`  | none            |
  | dismissed | `share-closed`                 | `--s-well` | `--s-ink-muted` | none            |
  | unproven  | `share-closed` (via dismissed) | `--s-well` | `--s-ink-muted` | none            |

### Menus (#949)

- **Book delete asks in place (G6).** The book menu sheet's actions swap to
  Keep and Delete, with the book's small cover and name in the header
  (`o4-book-delete-ask.tsx`, #980). Under O4 the book-delete path no longer
  uses the floating `EraseConfirm` card; with the switch off it still does.
  The resting sheet's tiles are G1's work. That comment labels
  this answer "D16 → B", a different question from #947's D16 above
  ([#949 round 3][949-r3]).
- **D17, marking done:** the tile caption is the workbench's "Done". The
  spoken label is "Mark segment N done" / "Mark segment N not done" in **both
  looks**, so the label contains the caption ([#949 D17–D20][949-d17]).
- **D18, recorder menu (G3):** no Edit tile. Edit stays on the recorder
  toolbar ([#949 D17–D20][949-d17]).
- **D19, finished crumb and badge:** the pale wash, `--s-done-quiet` with
  `--s-done-text`, not the solid fill ([#949 D17–D20][949-d17]).
- **D20, segment menu (07):** as the workbench draws it. The Rename pencil
  sits in the sheet header, not in a tile; Play sits in the preview row; an
  empty segment shows Edit and Done greyed. First focus under O4 goes where
  the workbench puts it; focus return to the ⋮ holds in both looks
  ([#949 D17–D20][949-d17]).
  The workbench's **"Remove this segment"** tile is deferred to after the
  training by the DRI: the app has no single-segment delete, and #997 builds
  the action and the tile together ([#997][997]).

[937-d1]: https://github.com/unfoldingWord/tc-mobile/issues/937#issuecomment-5836825393
[937-r1]: https://github.com/unfoldingWord/tc-mobile/issues/937#issuecomment-5837137316
[937-r2]: https://github.com/unfoldingWord/tc-mobile/issues/937#issuecomment-5837851193
[937-palette]: https://github.com/unfoldingWord/tc-mobile/issues/937#issuecomment-5837859829
[947-r3]: https://github.com/unfoldingWord/tc-mobile/issues/947#issuecomment-5839614964
[947-r4]: https://github.com/unfoldingWord/tc-mobile/issues/947#issuecomment-5839642889
[947-996]: https://github.com/unfoldingWord/tc-mobile/issues/947#issuecomment-5840318561
[949-d7]: https://github.com/unfoldingWord/tc-mobile/issues/949#issuecomment-5837276890
[949-r3]: https://github.com/unfoldingWord/tc-mobile/issues/949#issuecomment-5839615892
[949-d17]: https://github.com/unfoldingWord/tc-mobile/issues/949#issuecomment-5840320510
[997]: https://github.com/unfoldingWord/tc-mobile/issues/997

## 7. Titles and reordering (added in Tim's update)

- **Titles.** A chapter or segment "has a title" when it has a typed name or a
  spoken one. A typed name shows as text; a name that was only spoken shows as
  a short amber wave. Segment rows with a spoken name prefix the title with a
  16px `--s-hear` speaker glyph. The chapter screen gets a header with the
  title and a "hear the chapter name" button. Untitled rows look as before.
- **Sheet headers.** The name sheet now shows what is being named: the book's
  small cover and name, or the chapter/segment breadcrumbs. The segment menu
  header uses the same breadcrumbs, and the segment's name moves from the
  header into the preview row.
- **Reorder.** Press and hold, then drag, to move a chapter (Books list) or a
  segment (chapter screen). Chapters renumber after a move. Screen hints now
  say so.

No new colour roles: titles, headers and lifted rows use roles already in
§1 and `2-semantic.css`.

## 8. Change log

- **2026-09-25, first export.** Colour roles, contrast gate, geometry, type,
  motion, icons, open decisions.
- **2026-09-25, Tim's update.** Diffed against the first export: the colour
  table, gap notes (G1–G10) and icon set are unchanged, so layers 1 and 2 are
  unchanged. Added the titled chapter and segment rows, the chapter header,
  auto-fitting progress dots, the new name-sheet and segment-menu headers,
  and press-and-hold reordering (§2, §3, §4, §7). The sample data gains a
  26-segment "Mark 3" chapter to exercise dot fitting.
- **2026-09-25, #968.** The #937 answers and the #967 primitives: Edit tile
  Slate (D1b), light share ring `#12a090` (D2), the D3 text roles, the type,
  radius and ambient tokens (D4–D6), and the 10-colour cover palette (D8b). §6
  turns from open decisions into the decision record, adding D12–D20 from
  #947 and #949.

## 9. Screen map (reference)

O4 states: 01 Books empty · 02 New book · 03 Books list · 04 Book menu ·
05 Chapter empty · 06 Chapter with segments · 07 Segment menu · 08 Recorder
idle · 09 Recording · 10 Recorded · 11 Playing · 12 Editing / trim · 13 Erase
confirm · 14 Share chapter · 15 Share progress · 16 Mic denied · 17 Storage
warning · 18 Crash / recovery.

Gaps the workbench filled: G1 Books menu · G2 Chapter menu · G3 Recorder menu
· G4 Name sheet · G5 Record again asks first · G6 Delete book asks first ·
G7 Share a whole book · G8 Marking done · G9 New colours · G10 Adding a segment.
