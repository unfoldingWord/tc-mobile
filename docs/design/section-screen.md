# Section-by-section screen — Pass A (UX)

> Process: `ux-then-ui`. This document is the **Gate 1 artifact**: the job list
> and state inventory, as words and plain boxes, with **zero styling**.
> Nothing here decides how anything looks.

## The three reads

| Read          | Answer                     | Consequence                          |
| ------------- | -------------------------- | ------------------------------------ |
| Design system | **none**                   | B1 would normally derive one         |
| Surface class | **product**                | B1 and B3 are skipped                |
| Origin        | **greenfield, pre-commit** | A0 pre-commits rather than diagnoses |

**Deviation, stated rather than silently taken.** "Product" and "no design
system" pull opposite ways. The reason a product surface skips B1 is that its
identity is already settled — here nothing is settled, because this is the
first real screen of the app. Resolution: skip the **identity-derivation
ritual** (naming "the moment the product owns" is a brand exercise and this
screen is a tool), but B2 must still establish a minimal visual vocabulary,
with every number deferred to `ui-craft`. B3 (swap test) is genuinely
inapplicable — it is marketing-only.

## Premise check

Three claims verified against artifacts before designing, not taken from the brief:

1. **The screen does not exist.** `src/app/App.tsx` is a 296-line single-clip
   scratchpad — one waveform, six labelled buttons. There is no list, no
   sections, no chapter. Hence pre-commit, not diagnose.
2. **The defect is already present in our own code.** That screen carries six
   English text labels and an English `<h1>`.
3. **The spec is explicit:** "low/no text (icon driven)",
   "Section-by-section (UX), vertical scroll", "granular to section: editing,
   re-recording" (`docs/spec-transcription.md` lines 21, 33–34).

### The correction the premise check produced

The brief assumed OBS artwork could carry row identity. **It cannot, in Phase 1.**
Tim's own scoping says tC Mobile "initially wants to be only a simple audio
editor" and that "later phases may include resources and pre-structured content
(e.g., OBS)." So Phase 1 ships a **blank** notebook: no stories, no artwork, no
pre-made sections.

That removes the one non-textual identifier we thought we had, and it changes
the central design question of this screen.

## A0 — The sentence

> **This will be for a translator who cannot read, and the way it fails is by
> being built as though it has never met one — a list whose rows are told apart
> by text, whose progress is announced in words, and whose destructive moments
> are confirmed with a sentence.**

**X, from evidence:** an oral communicator in a church network like the Nukak —
"functionally monolingual and almost entirely oral" (Tim Jore, Zulip) — holding
a shared Android phone in a workshop, recording their own translation.

**Why this failure and not another:** it is the one the whole field commits.
All twelve reference screens reviewed on Mobbin are navigable **only by
reading** (`docs/research/ui-patterns.md`). It is also the failure already
present in our scaffold. This is the default outcome, not a hypothetical one.

Gate 3 re-reads this sentence.

## The central question, and the answer

**In a blank audio notebook with no artwork and no text, what tells section 3
apart from section 4?**

Three candidates, and only one survives:

| Candidate                | Verdict                                                           |
| ------------------------ | ----------------------------------------------------------------- |
| Artwork                  | Not available in Phase 1. Available later; leave a slot for it.   |
| Words / titles           | Excluded by the brief. This is the defect being designed against. |
| **The recording itself** | **The only universal identifier available.**                      |

**A section is identified by its own sound, its own shape, and its position.**
Therefore:

- **Tapping a row plays it.** Playback is not a secondary action behind a
  control — it is how a person navigates. It must be the cheapest thing on the
  screen.
- **The waveform is the row's face**, not decoration. Two recordings of
  different passages look different; that difference is the label.
- **Position in the list is load-bearing** and must never reorder on its own.
- Digits appear as a secondary aid. Digits travel across scripts far better
  than words, and are not a substitute for the above.

A picture slot exists in the row from day one so Phase 2 content drops in
without a redesign.

## ▸ REVISION after Gate 1 feedback — OBS content is in

**Decision:** bundle Open Bible Stories as beta content (ADR 0006). The premise
correction above is therefore **partly reversed**, and this is what changes.

**Artwork is available after all — for OBS chapters.** 50 stories, 598 frames,
each with its own illustration. OBS maps onto the model with no translation:
story → Chapter, frame → Section. So the picture slot in the row is filled, not
empty, whenever the chapter came from OBS.

**But it is not available for user-created chapters**, which Phase 1 still
supports and which is what a translator working on a Bible pericope will have.

So the design does not change; its emphasis does:

| Chapter kind             | Row identity                                                             |
| ------------------------ | ------------------------------------------------------------------------ |
| **OBS chapter**          | Artwork carries it. Sound and position reinforce.                        |
| **User-created chapter** | Sound, waveform shape and position carry it — exactly as reasoned above. |

**The conclusion that survives, and matters more now:** artwork is an
**enhancement, not a dependency**. A design that only worked once artwork
existed would fail every user-created chapter and every Bible pericope forever.
Tapping a row to hear it stays the primary means of navigation in both cases; it
is simply needed less often when there is a picture.

That is a better outcome than either premise alone, and it is why the picture
slot was specified before we knew we would have pictures.

**Two things this adds to the screen:**

1. **~~Per-story download state.~~ Superseded.** Artwork was going to be fetched
   per story, adding a "picture not downloaded" row state. It has since been
   bundled instead — all 598 thumbnails are 2.5 MB (ADR 0006) — so that state
   **cannot occur and has been removed** from A2. A state deleted beats a state
   handled well.
2. **Reference audio.** OBS ships narration MP3s, so a section can now have
   something to _listen to_ before recording — Shema Studio's "pinned reference"
   pattern (`docs/research/prior-art.md` §1). **Deliberately not added to this
   screen's job list**: it changes the recording surface, not the list, and
   folding it in here would widen the gate mid-review.

**Also flagged by ADR 0006 and not resolved:** a recorded translation of an OBS
story is arguably a derivative work, making it CC BY-SA. The data model cannot
distinguish an OBS-derived recording from a user-authored one. That is a
licensing decision for Tim, not an engineering one.

## A1 — The job list

Ordered top to bottom. Each job stated without pointing at where it came from.

| #   | Region               | Its job, in one line                                                                           |
| --- | -------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | **Where am I**       | Say which chapter this is, and offer the way back out.                                         |
| 2   | **How much is left** | Show at a glance whether there is more to do.                                                  |
| 3   | **The section list** | Every section of this chapter, in fixed canonical order, scrolling vertically.                 |
| 4   | **The row**          | Identify one section, reveal whether it holds audio, play it on tap, and open it to re-record. |
| 5   | **Add / hand off**   | Add the next section, and turn the finished chapter into one file that leaves the device.      |

Region 2 earns its place only once the list is longer than one screen — real
for a 50-frame story, marginal for a 3-section chapter. Kept, with that noted.

### Plain boxes

```
┌──────────────────────────────────┐
│  [←]        ( chapter mark )     │   1  where am I
│         ▓▓▓▓▓▓▓░░░░░   6 / 10    │   2  how much is left
├──────────────────────────────────┤
│  ┌────────────────────────────┐  │
│  │ 1   ~~~~~~~~~~~~~    0:34  │  │   4  a recorded row
│  │  ▢                    [▶]  │  │      ▢ = picture slot (empty in v1)
│  └────────────────────────────┘  │
│  ┌────────────────────────────┐  │
│  │ 2   ~~~~~~~~~~       0:28  │  │
│  │  ▢                    [▶]  │  │
│  └────────────────────────────┘  │   3  the list, vertical scroll
│  ┌────────────────────────────┐  │
│  │ 3   · · · · · · ·      —   │  │   4  an empty row
│  │  ▢                    [●]  │  │
│  └────────────────────────────┘  │
│               ⋮                  │
├──────────────────────────────────┤
│   [ + ]                    [ ⇪ ] │   5  add / hand off
└──────────────────────────────────┘
```

Row anatomy, as jobs rather than parts:

| Part           | Its job                                                          |
| -------------- | ---------------------------------------------------------------- |
| Ordinal        | Fix this section's place in the sequence.                        |
| Picture slot   | Carry content artwork when there is any. Empty and inert in v1.  |
| Waveform       | Be the row's face — the thing that differs between two sections. |
| Duration       | Say how much audio is here, in digits.                           |
| Single control | Play when there is audio; record when there is not.              |

**The row has exactly one control.** A row that holds audio plays; a row that
does not, records. Two controls per row would double the decision on every row
of a fifty-row list for a person who cannot read either of them.

## A2 — The states

The happy state is the one that gets designed by default. These are the rest.

| State                                | What the screen must do                                                                                                            |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Empty** — new chapter, no sections | Most people's first experience. One obvious way to start; the list is not the subject yet.                                         |
| **First run** vs **returning**       | First run has never granted microphone permission. Returning must land on the first unrecorded section, not the top.               |
| **Recording**                        | The screen changes character: the list recedes, one section is the subject, stopping is the only thing that can be done.           |
| **Playing**                          | Which row is sounding must be unmistakable, and tapping elsewhere stops it.                                                        |
| **Row: never recorded**              | Distinguishable from "recorded silence" — not just an absent waveform.                                                             |
| **Row: recorded**                    | Waveform, duration, playable.                                                                                                      |
| **Row: mid-record**                  | The row currently being captured, live.                                                                                            |
| **Long chapter** — 50 sections       | The list scrolls; region 2 becomes load-bearing; position must survive scrolling.                                                  |
| **Short chapter** — 1 section        | Must not look broken or empty.                                                                                                     |
| **No microphone permission**         | The recording control cannot silently do nothing. Recovery without reading a paragraph.                                            |
| **Storage full**                     | **Real, not theoretical: ~5.3 MB/min, ~660 MB for 50 OBS stories** (ADR 0002). Must fail before a recording is lost, never during. |
| **Decode failed**                    | iOS produces mp4/aac; a decode failure must not present as a silent empty row.                                                     |
| **Exporting**                        | MP3 encoding is main-thread today (ADR 0003) and will block. The screen must show it is working and must not look frozen.          |

Two states carry disproportionate risk and are called out deliberately:
**storage full**, because it destroys work in the field with no recovery, and
**recording**, because it is the only moment where a mistake costs a take.

## A3 — The ask

What this screen asks of a person:

1. Attention — find your place in a list you cannot read.
2. A decision — which section to work on.
3. A performance — record, live, usually in front of others.
4. A judgment — was that take good enough.
5. A decision — keep it or do it again.
6. ~~A classification — mark this as draft / refined / affirmed.~~
7. A decision — the chapter is finished, hand it off.

### The thing cut: #6, explicit status marking

`RecordingStatus` has five values (`not-started`, `partly-recorded`, `draft`,
`refined`, `affirmed`) and **stays in the data model** — Phase 2 needs it and
retrofitting a status onto existing records is a migration (`src/types/domain.ts`).

But v1 **does not ask the person to set it.** It is derived: audio, or no
audio. Asking someone who cannot read to sort their own work into five
categories via five icons they must first learn is a large ask returning
nothing in Phase 1.

The screen still works without it. That is the test, and it passes.

## Not decided here

Deliberately left open rather than quietly resolved:

- **How a non-reader tells two takes of the same section apart.** Deferred with
  the section screen; takes are stored but not surfaced in v1.
- **How a destructive action is confirmed without words.** Real and unsolved.
- **Whether spoken prompts, recorded once by a facilitator in the local
  language, should carry the instructional load instead of icons.** Floated as
  "O1" in the Zulip thread; not decided; would change this screen.
- **Bible pericopes have no non-textual identity.** OBS eventually has artwork;
  pericopes never will. Unsolved, and it does not block Phase 1.

## ▸ GATE 1 — awaiting human decision

Approve, redirect, or reject the job list and state inventory above.
No visual work starts until this is answered.

**Recorded decision: APPROVED, 22 Aug 2026.** Approved with the OBS content
decision folded in (see the revision above). Pass B is recorded in
[`section-screen-pass-b.md`](section-screen-pass-b.md).
