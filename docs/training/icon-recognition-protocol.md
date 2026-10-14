# Icon recognition check — the ten-minute protocol

For the facilitator running it. One page; the sheet to fill in is
[`icon-recognition-sheet.html`](icon-recognition-sheet.html) — open it in any
browser and print it, or open it on a phone or tablet, tick the boxes and type
the notes on the screen, then screenshot it. The reason for the check and what
the result decides is [ADR 0010](../decisions/0010-icon-recognition.md).
**This is a plan; it has not been run yet.**

## What you need

- One phone with the app installed and a **throwaway book** set up before the
  participant sits down:
  - **Chapter 1** with three segment rows: **segment 1 recorded** and left
    unfinished (kept — it is the one marked Done in row 4),
    **segment 2 recorded** (expendable — it is cleared in row 5, then deleted
    in row 11), and
    **segment 3 empty** (tap `+` at the top of the Segments screen to add it)
    so the microphone is showing on a row.
  - **Chapter 2** with **one short segment recorded by you**, nothing else.
    Row 10 (Share) is run on this chapter, so nothing the participant records
    is ever on the phone's share screen.
- One printed sheet per participant (or the sheet open on a second screen),
  a pen, ten minutes.
- The participant does not need to read anything. You do all the talking, in
  their language.

## Before you start

Say, in their language: "I am going to show you some buttons and ask what you
think they do. There are no wrong answers — if a button is confusing, that is
the app's fault, not yours, and it is what we want to find out." Then fill in
the top of the sheet: **site code** (given to you by the dev lead — not the
town's name), the **date**, and **which participant of the day this is**
(1, 2, 3 …), and circle which phone.

## For each control, in order

1. **Show** the control on the phone — point at it, do not tap it. Make sure
   the screen it lives on is up (the sheet says which).
2. **Ask:** "What do you think this does?" Wait. Do not hint.
3. **Give the task** for that control (below), in their language, and let
   them try. Help only if they are stuck for a good while, and then say so in
   Notes.
4. **Tick one box** on the row:
   - **Knew it** — they said what it does (or close enough) **before** touching
     it.
   - **After one try** — they did not know, tapped it once, and could then say
     what it did and do the task.
   - **Did not know** — neither. Includes "they guessed something else and
     kept doing it".
5. **Notes** — one line, only if there is something to say: what they called
   it, what they tried instead, whether you had to help.

If they tap before answering, that counts as _After one try_ at best. If the
control is greyed out on the screen, get it enabled first (record something,
select something) and do not count the wait.

**The order matters.** The rows are arranged so that every control is asked
about before you or the participant first tap it in front of them: opening a
row's menu uses the same three-dots glyph as row 3, and the scissors in row 6
are the only way into the editing toolbar that rows 7–9 live on. Keep the
order. Where you have to tap something yourself to get to the next row, the
table says so, and it is never a control that has not been asked yet.

## The eleven controls and their tasks

| #   | Control (as drawn)               | Where it is, and how to get there                                                                                                                                                                                                                                                                                                                                                                                                                           | Task, said in their language                                                                                                                                                                                                                                                  |
| --- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Record** — microphone          | Segments screen (chapter 1), on the empty row (segment 3). The microphone opens the recorder; the **red disc** there is a second tap, which starts recording. While recording, the disc becomes a **square**, which ends and saves the take; then the **Back arrow** at the top left returns to the list.                                                                                                                                                   | "Make a recording of this sentence." (say any short sentence) — done when they are back on the list and the row shows a recording                                                                                                                                             |
| 2   | **Play** — triangle              | Segments screen, on the row they just recorded (segment 3)                                                                                                                                                                                                                                                                                                                                                                                                  | "Listen to what you just recorded."                                                                                                                                                                                                                                           |
| 3   | **Menu** — three dots (⋮)        | Segments screen, top corner                                                                                                                                                                                                                                                                                                                                                                                                                                 | "Show me what else this screen can do." Close it afterwards (the ✕ at its top right).                                                                                                                                                                                         |
| 4   | **Done** — tick                  | Segment 1's row menu: **you** open it (its glyph is the same three dots as row 3, already asked), then point at the tick                                                                                                                                                                                                                                                                                                                                    | "Tell the app this recording is done."                                                                                                                                                                                                                                        |
| 5   | **Reset** — eraser               | Segment 2's row menu (you open it), the tile before Delete. Reset asks once more on a small panel; the eraser there is the same control, so that second tap does not count against them                                                                                                                                                                                                                                                                     | "Throw this recording away."                                                                                                                                                                                                                                                  |
| 6   | **Edit** — scissors              | Recorder, on the participant's own recording: **you** open it by tapping segment 3's row (the sound picture, not a button). Ask on the **first** toolbar, the four under the sound picture (eraser, disc, triangle, scissors)                                                                                                                                                                                                                               | "Open the tool for changing part of this recording." — say it as **open editing**; "it lets me change/edit the recording" counts as **Knew it**; the tap opens the editing toolbar, where the same control sits in the same spot, now shown as ✕, and tapping the ✕ closes it |
| 7   | **Zoom** — magnifier with a plus | Recorder, editing toolbar (on screen after row 6)                                                                                                                                                                                                                                                                                                                                                                                                           | "Look closer at one small part of the recording."                                                                                                                                                                                                                             |
| 8   | **Cut** — scissors               | Recorder, under the sound picture, once a piece is chosen                                                                                                                                                                                                                                                                                                                                                                                                   | "Take out the piece you chose."                                                                                                                                                                                                                                               |
| 9   | **Paste** — arrow onto a line    | Recorder, just above the sound picture, once something is cut and no piece is chosen                                                                                                                                                                                                                                                                                                                                                                        | "Put the cut piece back."                                                                                                                                                                                                                                                     |
| 10  | **Share** — tray with an arrow   | Leave editing with the **✕** at the bottom right or Back; go back to the Books screen and open **chapter 2**; open the Segments screen's menu (row 3's glyph) and point at Share                                                                                                                                                                                                                                                                            | "Get the app ready to send this chapter to another phone." Done when the **phone's own share screen** appears; you cancel it yourself                                                                                                                                         |
| 11  | **Delete** — trash (a bin)       | Leave chapter 2 (Back to Books, then **chapter 1**'s Segments screen) and reopen **segment 2**'s row menu (⋮, already asked in row 3) — it closed when Reset was confirmed in row 5. Segment 2 now has no clip, so the menu drops to its 3-tile layout: an empty space takes the eraser's place, and Delete stays at the far end. Delete asks once more on a small panel; the bin there is the same control, so that second tap does not count against them | "Get rid of this segment completely." Done when segment 2 is gone from the list                                                                                                                                                                                               |

**Row 4 is named for the tile's caption.** The tick's tile in segment 1's
row menu is captioned **Done** in the app (`src/lib/strings.ts`
`tileFinished`, rendered in `src/components/segment-row.tsx`), so the row is
called Done here too and a facilitator reading the sheet sees the same word
the participant sees. The row still tests the **tick**, not the word: point
at the glyph and score what they say it does. If they answer by reading the
caption, write that in Notes.

**Rows 6 and 8 draw the same scissors glyph, in two different places doing two
different jobs.** This is the DRI pick on
[#999](https://github.com/unfoldingWord/tc-mobile/issues/999), after
[#955](https://github.com/unfoldingWord/tc-mobile/issues/955) replaced row 6's
old `[ ]` brackets with the app's existing scissors: rather than drop row 6 or
wait on a two-scissors product call, both rows stay and are asked as written.
Row 6 is the recorder's edit-mode toggle: on the first toolbar it opens
editing; the same control sits in the same spot on the editing toolbar,
now shown as a ✕ (#1252), and tapping the ✕ closes it
(`src/components/recorder-toolbars.tsx`, the `key="edit-toggle"` control in
both toolbar arms — it does not pick a piece, unlike the old brackets'
description). Row 8 is a separate control, the Cut command under the
waveform once a piece is selected. Ask row 6 on the first toolbar, where it
is the only icon way in.

Row 10 is two taps: the first prepares the chapter (the control shows busy for
a moment), then the same spot becomes a stronger "send" control, and that
second tap opens the phone's own share screen. Stop at the share screen — do
not pick anything on it — and cancel it. On an Android build that has landed
the Android share glyph (three joined dots, [#490](https://github.com/unfoldingWord/tc-mobile/issues/490)),
point at that glyph instead and write **which glyph the phone showed** in
Notes; the sheet draws the tray.

**Row 11 reuses segment 2's row menu**, already opened once for row 5. The
bin tile sits in that same menu next to the eraser, so it has been _visible_
since row 5 — but showing a control on screen is not the same as asking about
it, and nobody has tapped it or been asked what it does until now. Row 5's own
task ("throw this recording away") only removes the audio; row 11's removes
the segment itself, so word the two tasks so a participant does not think
they already did this.

Controls 1, 2, 5, 7 and 11 are drawn from things in the world (a microphone,
a tape deck, an eraser, a lens, a bin — ADR 0010 groups `trash` with the
objects: "a bin is a bin"); 3, 4, 6, 8, 9 and 10 are software conventions. ADR 0010's
claim is that the first group is recognised and the second is not — do not
tell the
participant that, and do not skip a control because you expect the answer.

While recording, the red disc becomes a square (Stop), which ends and saves the
take; Pause (two bars) replaces the triangle while playing. If a participant
remarks on the square or on Pause, note it on the Record or Play row.

## Numbers

**Ten minutes per participant, eight or more participants across two sites,
at least three at each site.** Fewer than that, or one site only, is still
worth sending — it is recorded — but it does not decide the ADR on its own.
Two sites is so that one room's habits do not settle it.

## Privacy

- **No names on the sheet, anywhere.** Not the participant's, not yours.
  Site code only.
- **No recordings and no photographs of participants.** The only photograph is
  of the filled sheet.
- What the participant records during the tasks stays in the throwaway book
  on that phone. Do not share it from the app (row 10 runs on chapter 2, which
  holds only your own recording); delete it afterwards.

This follows the repo's privacy rule (`CONTRIBUTING.md`, "Privacy and public
readiness"): the repository is public, and nothing that identifies a person
goes into it.

## Returning the sheets

At the end of each day, **photograph every filled sheet** (flat, good light,
all eleven rows readable) — or screenshot it, if you filled it on a screen — and
**send the images to the dev lead** by whatever channel you already use for
problem reports. Write the site code and date in the message too, in case an
image is unreadable.

## What happens with the results

The dev lead copies each sheet's ticks into ADR 0010's evidence table, one row
per sheet, marked as a protocol result, and totals them per site and per glyph
in the ADR's protocol summary table. When eight or more participants across
two sites (at least three per site) are in, the ADR's status moves to
**Accepted** or **Rejected** by the rule written in it, with the per-glyph
detail alongside. Then, from the ADR:
[#91](https://github.com/unfoldingWord/tc-mobile/issues/91) (the select / cut
/ paste / zoom affordance), **Q7** in `docs/design/pivot-plan.md` (spoken
prompts), [#178](https://github.com/unfoldingWord/tc-mobile/issues/178) and
[#491](https://github.com/unfoldingWord/tc-mobile/issues/491) (share outcome
glyphs) and [#490](https://github.com/unfoldingWord/tc-mobile/issues/490)
(the Android share glyph) are each updated with what the result means for
them.
