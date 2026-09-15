# Facilitator runbook — tC Mobile

This is for the person running the room: setting up phones, answering the
first questions, and knowing what to do when something does not work. It is
not a developer guide. Plain language, short steps.

**Nothing leaves the phone.** tC Mobile has no server of any kind. Recordings
are stored only in the phone's own app storage and never travel anywhere
unless someone deliberately taps Share. <!-- source: docs/decisions/0005-no-backend-in-phase-1.md; grep -rn "fetch(\|XMLHttpRequest\|WebSocket" src/ returned no matches, checked 2026-09-15 --> Tell every participant this up front — it was the very first question the first outside tester asked. <!-- source: gh issue #248, comment 2026-09-14 -->

## 1. Before the training

1. Make sure you have the install link or invitation ready for every phone you
   will set up (see [`tester-install.md`](../tester-install.md) for the exact
   steps — do not retype them here, just follow that guide).
2. Know which kind of build each phone is getting: an Android phone installs
   an APK from a download link; an iPhone installs through TestFlight. <!-- source: docs/tester-install.md, "Android (download link)" and "iPhone or iPad (TestFlight)" sections -->
3. Bring a paper or digital "problem report" sheet (see [section 5](#5-reporting-a-problem))
   — there is no in-app way to send us a report yet. <!-- source: gh issue #205, open as of 2026-09-15; no reporting UI found in src/ during this pass -->
4. Charge every phone. Recording drains the battery faster than normal use.

## 2. Setting up a participant's phone

1. **Install the app.** Follow [`tester-install.md`](../tester-install.md) for
   the phone type. On Android, the phone will warn about installing from
   outside the Play Store — this is expected; the guide shows exactly what to
   tap.
2. **Allow the microphone when asked.** The first time someone taps record,
   the phone will ask for microphone access. Tap **Allow**. Without it,
   recording will not work at all.
3. **If the app never asks, or recording fails after allowing it:** open the
   phone's own settings — **Settings → Apps → tC Mobile → Permissions →
   Microphone** — and turn it on. (Standard Android path; wording varies by
   phone.) <!-- source: standard Android Settings path for a per-app permission; not app-specific code, phrasing varies by device --> On the Chrome web version, the same setting is under the
   padlock/"i" icon by the address bar → site settings → Microphone.
4. **A dismissed permission question can look like a real block.** If someone
   closes the microphone question without answering it, the app may show the
   same "allow it, or check your device settings" message it would for an
   actual block. Retry first — if the question does not come back, use the
   Settings path in step 3. <!-- source: src/lib/audio/mic-refusal.ts — a dismissed prompt and an unreadable permission state both map to the same indeterminate message; a confirmed device-level block gets its own distinct message (#203, closed) -->

## 3. During the training

- **Recording and editing work offline.** No signal is needed at any point.
- **Sharing a chapter** produces one MP3 file. **Sharing a book** produces a
  zip file of all its chapters. Both go out through the phone's normal share
  sheet (the same menu you'd use to share a photo). <!-- source: AGENTS.md "Known open items" #5, and docs/decisions/0009-transcode-on-finished.md -->
- **Known problem: Share may fail on the installed Android app right now**,
  with a message like "Could not share this chapter/book. Try again." This
  was seen on 2026-09-14 and a fix is being worked on. <!-- source: gh issue #336, open as of 2026-09-15 --> On the Chrome web
  version, Share Book specifically can fail the same way even when Share
  Chapter works. <!-- source: gh issue #272, open as of 2026-09-15 -->
  **If this happens:**
  1. Do not uninstall the app and do not delete the recording.
  2. Write it down on the problem report sheet (which chapter or book, what
     the message said).
  3. The recording is still safely on the phone — it can be shared again
     later once this is fixed.

## 4. Known limits (as of 2026-09-15)

- **No way to delete a whole book yet.** Have each participant practice
  inside one throwaway book and simply ignore it afterward, rather than
  trying to clean it up. <!-- source: gh issue #337, open -->
- **You cannot listen to a cut before you commit it.** While editing a
  segment, there is no Play button inside edit mode — you have to leave edit
  mode to hear the result, then go back in if you want to change it more. <!-- source: gh issue #284, open -->
- **One recording per segment.** A new take replaces the old one; there is no
  version history.
- **Editing a finished segment re-compresses the audio.** Once a segment is
  marked Finished, its audio is compressed to save space. Editing it again
  decompresses it, and re-finishing it compresses it a second time. Each
  compression pass loses a small amount of quality, the way saving a photo as
  a JPEG twice does. This is expected, not a bug. <!-- source: docs/decisions/0009-transcode-on-finished.md, section 3 (generation count) -->
- **English only.** The app's menus and messages are in English; there is no
  other language option yet. <!-- source: gh issue #169, open -->
- **If a saved recording plays back with no sound, check the phone's media
  volume first.** This has been reported once and may have been a device
  volume setting rather than an app problem — it is not confirmed either way. <!-- source: gh issue #269, open, most recent comment (2026-09-14) reports the opposite (playback worked) and an earlier comment suspects an overlooked device volume setting -->

### The flip side of "nothing leaves the phone"

Nothing is backed up anywhere either. If a phone is lost, reset, or the app is
uninstalled, every recording on it is gone for good — there is no cloud copy
and no restore. <!-- source: docs/decisions/0005-no-backend-in-phase-1.md; docs/native/README.md §0 ("uninstall deletes every recording"); gh issue #24, open ("no way to save or restore a project") --> The only copy that leaves the phone is one made deliberately
with Share.

## 5. Reporting a problem

There is no in-app "report a problem" button yet — a person is the reporting
channel for now. <!-- source: gh issue #205, open as of 2026-09-15 ("Give the failure sink a durable, non-reader-visible destination"); no reporting UI found in src/ during this pass --> When something goes wrong, write down:

1. **Phone make and model** (for example, "Samsung Galaxy A17").
2. **Android version**, if you can find it (Settings → About phone).
3. **The build stamp** — a small line of text at the bottom of the app screen
   reading something like `v0.2.1 · a1b2c3d`. This tells us exactly which
   build was running. <!-- source: src/components/build-stamp.tsx; rendered at the bottom of every screen via src/app/App.tsx -->
4. **What was tapped**, in order, right before the problem.
5. **What happened** — the exact wording of any message on screen. A photo of
   the screen is very helpful.
6. **Whether the recording survived.** After the problem, go back and check:
   is the segment still there, and does it still have audio?

Keep these notes together (paper or a shared note) and pass them along at the
end of each day.
