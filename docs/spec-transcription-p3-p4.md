# translationCore Mobile — screen mockups, notebook pages 3–4 (transcription)

> Source: four screenshots of Tim Jore's notebook, pages **3** and **4**, received
> 22 Aug 2026 and stored in `docs/design/mockup-1..5-*.png`. Black ink is the drawing; blue ink is
> Tim's annotation. This file is a manual transcription so the content is greppable.
> **Verify against the images before relying on any detail.** Items marked `[?]`
> were ambiguous.
>
> Companion to [`spec-transcription.md`](./spec-transcription.md), which transcribes
> page 1 (inception + design criteria, 19 Aug 2026). Tim has confirmed there are no
> further pages: pages 1, 3 and 4 are the whole of the source material.

## Page 3 — Content Mgmt ("Manage Books + their chapters")

Taxonomy, drawn as an indented tree and annotated **"taxonomy"**:

```
Book
└─ Chapter
   └─ Segment
      └─ (Takes)        ← drawn in parentheses
```

Note: page 3 shows **no "Section" level**. Page 1 has `Chapter = collection of
Sections (stories, pericopes)` with `Segment` beneath it. Settled: ADR 0004
rejects the Section layer, and removing it is batch B1 (#27).

Screen — a single phone frame:

```
┌────────────────────────────────────┐
│                        ( + )   ≡   │   + = New Book;  ≡ = menu
├────────────────────────────────────┤
│  ▽ Book 001            ( + )   <   │   + = New Chapter in Book 001
│  ─────────────────────────────────  │   < = Share Book
│     1 – Chapter 1          19/21   │   segments complete / total in chapter
│     2 – Chapter 2                  │
│     3 – Chapter 3                  │
│                                     │
│  ▷ Book 002                        │   collapsed
└────────────────────────────────────┘
```

- Books are collapsible rows (`▽` expanded, `▷` collapsed); chapters are numbered
  children.
- The per-chapter counter is annotated **"Segments Complete / Total Segments in
  Ch."** — it counts completion, not recordings. See C1 in
  [`design/pivot-plan.md`](./design/pivot-plan.md).

Tim's own "need:" list at the bottom of the page:

- **"Share Book" function — UI**
- **"Template Library"** — from the menu, e.g. **OBS**, **Book of the Bible**
  (+ chapter format)

## Page 4 — Segments Mgmt

Screen:

```
┌────────────────────────────────────┐
│  Book 001 > Chapter 1              │
├────────────────────────────────────┤
│  ☑  1   ●╫╫╫╫╫╫╫╫╫╫╫╫╫    (▶)  ⋮   │
│  ☐  2   ╫╫╫●╫╫╫╫╫╫╫       (⏸)  ⋮   │
│  ⬚  3   ─────────────      (⏺)  ⋮   │
└────────────────────────────────────┘
```

Annotated states, verbatim:

| Row | Checkbox      | Waveform  | Annotation                                                     |
| --- | ------------- | --------- | -------------------------------------------------------------- |
| 1   | checked       | present   | "Segment toggled to **Complete**"                              |
| 2   | empty square  | present   | "Segment recorded, **not** toggled to Complete"                |
| 3   | dashed square | flat line | "Segment not yet recorded — check box greyed out, no waveform" |

Other annotations:

- **Segment #** — the ordinal beside the checkbox.
- **"Simplified waveform represented for recorded segments."**
- **Playback % indicator** — the filled dot sitting on the waveform; "user can
  slide to desired location". Scrubbing happens on the row, not only in the editor.
- Transport button: "Play segment, fr/ indicator position — changes to 'Pause'
  button when pressed (toggle)."
- Record button (row 3): "**Toggles on-screen recording UI**."
- `⋮` per-row overflow menu, contents not drawn.

## Page 4 (continued) — On-Screen Recording UI

Drawn as a sheet over the dimmed Segments list. Two variants were drawn: the
base state, and the same screen with a selection active.

```
┌────────────────────────────────────┐
│ ▒▒ Segments list, dimmed ▒▒        │
├────────────────────────────────────┤
│  Book 001 > Chapter 1 > 3     ☐    │   ☐ = "Finished" toggle for segment
├────────────────────────────────────┤
│                    │                │
│      ╫╫╫╫╫╫╫╫╫╫    │                │   centerline (fixed)
│  ──────────────────┼──────────────  │
│                    │                │
├────────────────────────────────────┤
│  ▓▓▓▓▓▓▓▓▓▓▓▓│▓▓▓▓│▓▓▓             │   VU meter: green | yellow | red
├────────────────────────────────────┤
│  ↔    ⌐¬    ( ● )    ↶    ≡        │
└────────────────────────────────────┘
```

- **Centerline** — "is where the recording + playback + insertion (paste, new
  recording) occur." The waveform moves under a fixed line; the line does not
  travel across the waveform.
- **"Swipe to move waveform relative to centerline"** (left/right arrows drawn).
- **"Finished" toggle for segment** — top right; the same completion flag the
  page-3 counter counts.
- **VU meter** — green/yellow/red strip, "show/hide in menu".
- Toolbar, left to right:
  - **↔ / →← zoom toggle** — "toggles view of waveform: 100% in view / 25% in view".
  - **⌐¬ selection frame** — "Toggles selection frame when pressed."
  - **● record**
  - **↶ undo**
  - **≡ menu** — "Redo", "VU Meter (hide/show)", "Erase Segment (confirm first)".
- **Record button, when pressed:**
  1. "Begins recording @ the centerline — **inserts** new recording if in the
     middle of the waveform, **appends** new recording if @ the end of the waveform."
  2. "Button toggles to **Pause** — pauses recording when pressed (toggles to
     [record])."
- **Selection frame, when pressed** (second variant):
  1. "Shows depressed button + on-screen selector + **'Cut' icon**" — the drawn
     selection is a shaded region with drag handles, with a scissors icon beneath.
  2. "Cuts selection to **clipboard**."
  3. "Toggles selection frame off."
  4. "Toggles **'Paste' icon** on @ centerline."
  - Selection is annotated "manually select waveform section".

## What these pages do not show

Stated so the absence is not read as a decision:

- No **reference audio** / narration playback, and no record-along.
- No **OBS artwork** on rows — identity is the ordinal plus the waveform.
- No **take list** — one waveform per segment; `Takes` appears only in the page-3
  taxonomy, in parentheses.
- No **export** screen (page 1 lists MP3 export as a Phase-1 function).
- No **empty / first-run / permission-denied / storage-full** states.
- No type or spacing system. **Colour is present and is semantic** — corrected
  2026-08-23 after reading the images directly, against an earlier claim here that
  only the VU meter was coloured. In mockups 3–5 the play control is green, the
  record control is red, the selection is blue and the paste arrow is blue. That
  agrees with the existing token split of amber for voice and red for live.
