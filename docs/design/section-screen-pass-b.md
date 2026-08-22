# Section-by-section screen — Pass B (UI)

> Process: `ux-then-ui`, composed against `ui-craft`. Pass A and its Gate 1
> approval are in [`section-screen.md`](section-screen.md).
> **Gate 2 artifact:** <https://claude.ai/code/artifact/fd71a5a1-a3a2-40f7-ba56-11dfb7a48890>

## B1 — Identity: skipped, with the deviation stated

`ux-then-ui` skips identity derivation for **product** surfaces, because
product identity is already settled. Here nothing was settled — this is the
app's first real screen and there was no design system.

Resolution taken: skip the identity-derivation ritual (naming "the moment the
product owns" is a brand exercise, and this screen is a tool), but establish
the minimal token system Pass B needs to compose in real tokens. **B3, the swap
test, is genuinely inapplicable** — it is marketing-only.

## B0 — The token system

The app commits to a **single dark theme**. It is used in low light, on
battery, often outdoors, and a theme switch is a decision nobody in a workshop
should have to make.

| Token                         | Value                             | Job                                                   |
| ----------------------------- | --------------------------------- | ----------------------------------------------------- |
| `floor`                       | `#0b1016`                         | The page. Darkest thing on screen.                    |
| `surf`                        | `#141b24`                         | A row at rest.                                        |
| `surf-up`                     | `#1d2632`                         | The row in play. Steps **lighter** toward the viewer. |
| `surf-top`                    | `#263141`                         | Sheets and raised controls.                           |
| `edge`                        | `#222c39`                         | Hairlines.                                            |
| `tx` / `tx-mute` / `tx-faint` | `#e7ecf3` / `#93a0b1` / `#5f6b7a` | Three ink roles. None pure white.                     |
| `voice`                       | `#e6a444`                         | **The one accent.** Recorded audio, and only that.    |
| `live`                        | `#e2564a`                         | Semantic only: the recording moment.                  |
| `warn`                        | `#d98b3a`                         | Storage pressure.                                     |

Spacing levels: `L1 6` parts · `L2 14` items · `L3 28` blocks · `L4 56`
sections. Row radius 14. Controls 44px (52px for the focal record control),
above the 44px touch floor.

### Three decisions worth naming

1. **Every dark surface carries the same cool hue** at a different lightness,
   and forward surfaces step lighter. A neutral grey reads as a default theme;
   one quiet hue through every surface reads as chosen.
2. **Amber is the voice.** The accent is spent on exactly one thing — audio
   that exists. Warm against a cool ground, so a recorded row reads warm and an
   empty one reads cold before any shape is parsed. That is the fastest read on
   the screen and it requires no literacy.
3. **Red is never decorative.** It appears on the record control and the live
   recording state and nowhere else, so it never competes with amber.

### The type system is a numeral system

There is no text on the primary path, so the only type is **digits** —
ordinals, durations, the progress count. The entire typographic brief reduces
to one decision: tabular figures, so a column of durations reads as a column.
IBM Plex Sans, two weights.

**No platform emoji anywhere.** Every icon is drawn SVG — emoji render
differently on every device, clash with the palette, and read as a template.

## B2 — Composition

Row anatomy, decided:

| Part          | Decision                                        | Why this weight                                                   |
| ------------- | ----------------------------------------------- | ----------------------------------------------------------------- |
| Art + ordinal | 48px tile, ordinal in the corner at 11px        | The picture identifies; the digit only disambiguates.             |
| Waveform      | 26px tall, amber when recorded, hollow when not | It is the row's face.                                             |
| Duration      | 12px, muted, tabular                            | Support, not a deciding fact.                                     |
| Control       | 44px circle; 52px and red on the next-up row    | One control per row.                                              |
| Row surface   | Rest `surf`; in-play `surf-up`                  | Separation by fill, not borders — ten bordered rows is ten edges. |

**Blur test.** What survives a squint is the amber waveforms, the red control,
and the progress fill — which is exactly the answer the screen owes: what is
done, what is next, how much is left.

### What Pass B decided that Pass A did not

**The next unrecorded section is the screen's focal object.** Gate 1's
wireframe drew a uniform list. Which row leads is a composition decision, not a
job change — and a uniform list makes the translator find their place, where
this composition offers it.

### States composed

Primary (partly-recorded OBS chapter), recording, empty chapter, and storage
nearly full. The remaining states from Pass A's inventory are variations on
these and are not separately composed.

## B4 — Motion

**Almost none, deliberately.** Two pieces, each with a named job:

- **Feedback** — the record dot pulses while capturing, because a recording
  that looks identical to a stopped one is how a take gets lost.
- **Causality** — the playhead traverses the waveform of the row that is
  sounding, so which row is playing is never ambiguous.

No page transitions, no staggered entrances, no personality animation. Both
honour `prefers-reduced-motion`.

## Still unsolved

**Confirming a destructive action without words.** Delete is not on this screen
at all — it sits behind the row, one step away. An undo beats a confirmation,
and a wordless undo beats both. It needs its own gate.

## ▸ GATE 2 REDIRECT — resolved 22 Aug 2026

48px tiles were rejected as too small. Three options were composed at real
phone width; the resolution went further than a size change.

### One rule, governing two questions

> **A chapter with artwork is browsed by picture; a chapter without one is
> browsed by sound.**

|                     | Artwork (OBS)                 | No artwork (user-made)               |
| ------------------- | ----------------------------- | ------------------------------------ |
| Layout              | 2-column picture grid, ~150px | List, 48px tile, full-width waveform |
| Tap a section       | Enters the section view       | Plays in place                       |
| Identity carried by | The picture                   | The waveform and its position        |

Layout and tap behaviour are the same conditional, so this costs one branch,
not two designs. Both render the same row data.

### The section view — tap to enter

Reframed during review: tapping a frame is **navigation into the work surface**,
not an enlarge gesture competing with play. That removes the choice-load
objection entirely — one tap, one meaning.

Three states: not-yet-recorded (the only bright thing is record), recorded (play
takes the amber, re-record demotes beside it), and recording (everything but the
frame, the timer and stop is gone, **including the stepper** — nothing to press
by accident mid-take). Prev/next stepping means a translator never returns to
the list between frames, matching Shema Studio's pattern.

This also relaxes the tile-size problem: if a tap opens the frame full-width,
the list tile only has to narrow it down, not confirm it.

### Reference audio — in v1, and story-level only

**Verified before designing it:** unfoldingWord publishes no frame-level OBS
audio and no timing data. Per-frame MP3s 404; narration exists only as one file
per story, several minutes long; `en_obs` contains no VTT, cue or timing files.

So the reference control plays **the whole story**. Useful — a translator can
hear the story before working — but **not record-along**, because reaching frame
7's narration means scrubbing past six. Estimating frame boundaries from text
length would put a plausible-looking wrong marker on scripture audio, so it is
not done.

**Worth raising with Tim and Benjamin Wright:** Scripture Burrito already
defines exactly the format this needs — a timing file mapping VTT timecodes to
references (`docs/research/prior-art.md` §4). uW simply does not publish one for
OBS audio. If one existed, frame-aligned reference playback becomes a small
change rather than a new feature.

### What this costs

- The grid drops **duration** from the cell — no room beside a waveform and a
  control at that width. It survives in the section view. Real information loss,
  flagged rather than absorbed.
- The grid's waveform narrows from ~190px to ~150px.
- Reference audio widens v1 scope: a second audio path and a per-story download.

## ▸ GATE 2 — approved, 22 Aug 2026

**Recorded decision: APPROVED.** Composition, tokens and the four states
accepted as shown.

## ▸ GATE 3 — the A0 re-read

Gate 3 exists to ask one question: **is the A0 sentence still true of the
result?** If it is, nothing was fixed. The honest answer is _mostly not, but
not entirely_ — recorded clause by clause rather than claimed as a clean pass.

> "This will be for a translator who cannot read, and the way it fails is by
> being built as though it has never met one — (a) a list whose rows are told
> apart by text, (b) whose progress is announced in words, and (c) whose
> destructive moments are confirmed with a sentence."

| Clause                                                | Verdict                       | Evidence                                                                                                  |
| ----------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| **(a)** rows told apart by text                       | **False of the result**       | Rows are told apart by artwork (OBS) or waveform shape and position (user-created). No labels, no titles. |
| **(b)** progress announced in words                   | **False of the result**       | Progress is a filled track; the count is digits. No sentence anywhere.                                    |
| **(c)** destructive moments confirmed with a sentence | **STILL TRUE of the product** | Delete was moved off this screen rather than solved. The failure is avoided here, not fixed.              |

### Residual 1 — deferred, not solved

Clause (c) is not fixed. Nothing on this screen destroys anything, so the
screen passes — but the product still has no wordless way to confirm a
destructive action. **It needs its own pass through this process**, and it
should happen before delete ships anywhere.

### Residual 2 — "no text" is not "no reading"

The composed screen still asks the translator to read **digits**: ordinals,
`0:34` durations, `4 / 16`. Digits travel across scripts far better than words,
which is why they were chosen — but numeracy and literacy are not the same
skill, and a fully non-numerate user gets less from this screen than the A0
sentence implies we intended.

Not a blocker, and not a reason to remove the digits — they help most users.
But **the claim is "no words", not "no reading"**, and the difference should be
stated plainly rather than quietly enjoyed. Worth a question to Tim about what
the Nukak workshop actually observed.

### Residual 3 — the invisible text layer

A zero-text UI still needs a **complete text layer for screen readers**. Every
control in the composition carries an accessible label, and those labels are
shipped strings that the visible design review never sees. They need a voice
owner and a localisation path exactly as visible copy would.

This is easy to miss precisely because the screen has no visible words.

## Handoff

| What                                                 | To whom                                  |
| ---------------------------------------------------- | ---------------------------------------- |
| Numbers — spacing levels, control sizes, radii, type | Settled in B0 above, per `ui-craft`      |
| Strings — accessible labels only                     | **Unowned.** Needs a voice owner.        |
| The build                                            | Code. See the risk tiers in `AGENTS.md`. |
