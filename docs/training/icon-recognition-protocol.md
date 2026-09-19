# Icon recognition check — the ten-minute protocol

For the facilitator running it. One page; the sheet to fill in is
[`icon-recognition-sheet.html`](icon-recognition-sheet.html) (open it in any
browser and print it, or fill it on the screen and photograph it). The reason
for the check and what the result decides is
[ADR 0010](../decisions/0010-icon-recognition.md). **This is a plan; it has
not been run yet.**

## What you need

- One phone with the app installed and **one chapter already recorded** in a
  throwaway book: at least two segments with audio, one of them left
  unfinished. Set this up before the participant sits down.
- One printed sheet per participant (or the sheet open on a second screen),
  a pen, ten minutes.
- The participant does not need to read anything. You do all the talking, in
  their language.

## Before you start

Say, in their language: "I am going to show you some buttons and ask what you
think they do. There are no wrong answers — if a button is confusing, that is
the app's fault, not yours, and it is what we want to find out." Then fill in
the top of the sheet: **site code** (given to you by the dev lead — not the
town's name), the **date**, and later the **participant count** for the day.

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

## The ten controls and their tasks

| #   | Control (as drawn)               | Where it is                                               | Task, said in their language                                      |
| --- | -------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------- |
| 1   | **Record** — red disc            | Segments screen, on an empty segment row                  | "Make a recording of this sentence." (say any short sentence)     |
| 2   | **Play** — triangle              | Segments screen, on a recorded row                        | "Listen to what you just recorded."                               |
| 3   | **Zoom** — magnifier with a plus | Recorder, toolbar under the sound picture                 | "Look closer at one small part of the recording."                 |
| 4   | **Erase** — bin                  | Segment row's menu (open it for them), last entry         | "Throw this recording away." (use the throwaway segment)          |
| 5   | **Select** — two brackets        | Recorder, toolbar                                         | "Choose a piece of the recording to change."                      |
| 6   | **Cut** — scissors               | Recorder, under the sound picture, once a piece is chosen | "Take out the piece you chose."                                   |
| 7   | **Paste** — arrow onto a line    | Recorder, on the sound picture, once something is cut     | "Put the cut piece back."                                         |
| 8   | **Menu** — three lines           | Books or Segments screen, top corner                      | "Show me what else this screen can do."                           |
| 9   | **Finished** — tick              | Segment row's menu                                        | "Tell the app this recording is done."                            |
| 10  | **Share** — tray with an arrow   | Segments screen, in the menu (open it for them)           | "Send this chapter to another phone." (stop them before it sends) |

Controls 1–4 are drawn from things in the world (a tape deck, a lens, a bin);
5–10 are software conventions. ADR 0010's claim is that the first group is
recognised and the second is not — do not tell the participant that, and do
not skip a control because you expect the answer.

Pause (two bars) and Stop are not separate rows: they only appear while
something is recording or playing. If a participant remarks on them, put it
in Notes on the Record or Play row.

## Numbers

**Ten minutes per participant, eight or more participants across two sites.**
Fewer than eight, or one site only, is still worth sending — it is recorded —
but it does not decide the ADR on its own. Two sites is so that one room's
habits do not settle it.

## Privacy

- **No names on the sheet, anywhere.** Not the participant's, not yours.
  Site code only.
- **No recordings and no photographs of participants.** The only photograph is
  of the filled sheet.
- What the participant records during the tasks stays in the throwaway book
  on that phone. Do not share it from the app; erase it afterwards.

This follows the repo's privacy rule (`CONTRIBUTING.md`, "Privacy and public
readiness"): the repository is public, and nothing that identifies a person
goes into it.

## Returning the sheets

At the end of each day, **photograph every filled sheet** (flat, good light,
all ten rows readable) and **send the photographs to the dev lead** by
whatever channel you already use for problem reports. Write the site code and
date in the message too, in case a photograph is unreadable.

## What happens with the results

The dev lead copies each sheet's ticks into ADR 0010's evidence table, one row
per sheet, marked as a protocol result. When eight or more participants across
two sites are in, the ADR's status moves to **Accepted** or **Rejected** by the
rule written in it, with the per-glyph detail alongside. Then, from the ADR:
[#91](https://github.com/unfoldingWord/tc-mobile/issues/91) (the select / cut
/ paste / zoom affordance), **Q7** in `docs/design/pivot-plan.md` (spoken
prompts), [#178](https://github.com/unfoldingWord/tc-mobile/issues/178) and
[#491](https://github.com/unfoldingWord/tc-mobile/issues/491) (share outcome
glyphs) and [#490](https://github.com/unfoldingWord/tc-mobile/issues/490)
(the Android share glyph) are each updated with what the result means for
them.
