# UI pattern research — audio capture and section lists

> Source: Mobbin, 2026-08-22. Twelve iOS screens reviewed across two searches:
> voice-recorder screens, and vertical lists of audio items with per-row state.
> Screens are linked so the actual images can be re-examined.

## The headline finding

**Not one of the twelve screens is navigable without reading.** Every single
one leans on text for identity or action: "Save", "Done", "Continue", "Press
and hold while speaking", episode titles, timestamps, category chips.

That matters more than any individual pattern below. Mobbin gives us solid
precedent for **layout and affordance**, and **no precedent at all for a
text-free primary path**. The zero-text constraint — the single hardest thing
Tim is asking for, and the entire reason the Nukak situation triggered this
project — is genuinely novel territory. We will be inventing it, not adapting
it, and should budget accordingly rather than assuming a reference exists.

## Patterns worth taking

### Row identity without text

- **[Nibble](https://mobbin.com/screens/787bdd31-84c9-4c97-bf9c-10cb589246d8)**
  — a large coloured illustration tile carries each row's identity; the text is
  secondary. **This is the closest analogue to what we need**: OBS already ships
  numbered art for all 50 stories, so the illustration can _be_ the label.
  Nibble also runs an inline progress bar per row.
- **[TIDE](https://mobbin.com/screens/763df547-c848-48ed-9694-eafd0a4e4596)**
  — a per-row mini waveform thumbnail. A waveform is recognisable without
  reading and doubles as "this one has audio, this one doesn't."

### Per-row state

- **[Nibble](https://mobbin.com/screens/787bdd31-84c9-4c97-bf9c-10cb589246d8)**
  and **[Headspace](https://mobbin.com/screens/00addfdd-0878-4fdb-be2f-c1d3cbc78c5c)**
  — the play control itself encodes state: plain play vs. resume-with-progress.
  One glyph, two meanings, no label.
- Maps directly onto the `RecordingStatus` enum already in the data model
  (`not-started / partly-recorded / draft / refined / affirmed`,
  `src/types/domain.ts`). Each needs a distinct non-textual treatment — a ring,
  a fill level, a colour — decided deliberately rather than by default.
- **[Pillow](https://mobbin.com/screens/468c98ef-a83e-4877-b92c-6f793736fb42)**
  — swipe-to-delete on a dense row list; per-row state chips.

### The recording state should shed all chrome

- **[OpenPhone](https://mobbin.com/screens/c013bfea-bb98-4e7b-9d63-6b8bf8735128)**
  and **[Quo](https://mobbin.com/screens/60735723-eb81-40e8-a1b0-bccec827fa9e)**
  — while recording, almost nothing on screen: one centred stop control, a
  small duration pill, a thin waveform ribbon. This is the closest existing
  thing to "world's simplest," and it is the state where a text-free UI is
  easiest to achieve because there is only one thing to do.
- **[ElevenLabs](https://mobbin.com/screens/8cae62f8-a59e-4423-901a-8d3e49fa32de)**
  — bar waveform with a fixed centre playhead and the audio scrolling past it,
  rather than a travelling playhead across a static waveform. Worth considering:
  it keeps the point of interest in one predictable place.

### Touch targets

- **[Perplexity](https://mobbin.com/screens/c343a912-29df-4a9f-88da-916fc04802e6)**
  — press-and-hold on a wide pill rather than a small circle. Better for a
  device held one-handed in a field setting, and the wide target forgives an
  imprecise press.
- **[Journal](https://mobbin.com/screens/fb8e2aae-a965-40ca-add0-2604b87f1e6b)**
  (Apple) — scrubbable timeline with ±15s skip flanking a centred transport.
  Conventional and legible, but note it still labels "Done" in text.

## Implications for tC Mobile

1. **Section rows = art + waveform thumbnail + status ring.** No required text.
   OBS art solves identity for stories; Bible pericopes have no equivalent
   artwork and will need a different answer — an open question.
2. **Status must be visual per row**, mapping to the existing enum.
3. **Recording is a distinct, near-empty state**, not a control bar bolted onto
   the list.
4. **The current scaffold screen labels every icon in text.** That is
   development scaffolding, not the design — it must not survive into what
   goes to East Africa.

## Still unanswered

- How a non-reader distinguishes **takes** of the same section from each other.
- How to convey **destructive actions** (delete a take) without words.
- Whether spoken audio prompts, recorded once by a facilitator in the local
  language, should carry the instructional load instead of icons — floated as
  "O1" in the Zulip thread and not yet decided.
