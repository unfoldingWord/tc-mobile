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

## ▸ GATE 2 — awaiting human decision

**Recorded decision:** _(pending)_
