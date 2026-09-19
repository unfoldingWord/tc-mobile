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
   an APK from a download link; an iPhone installs through TestFlight. <!-- source: docs/tester-install.md, "Android (download link)" and "iPhone or iPad (TestFlight)" sections --> The
   Android app needs **Android 7.0 (2016) or newer** — an older phone cannot
   install it. <!-- source: android/variables.gradle minSdkVersion = 24 (Capacitor 8 floor) -->
3. Bring a paper or digital "problem report" sheet (see [section 5](#5-reporting-a-problem)).
   The app can now send us what it recorded about a failure, but it records only
   some kinds of failure (§5 lists which), and only the app's own side of them —
   what the person was doing, and whether their recording survived, still has to
   come from you. The sheet is not a backup for the app's record; it is the
   larger half. <!-- source: gh issue #205; src/components/failure-log-panel.tsx (the menu panel), src/components/books-screen.tsx (the ≡ mark) -->
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
- **What the screen shows while sharing, and after.** Share is two taps: the
  first gets the file ready, the second ("Share now", the big tick) opens the
  phone's share sheet. While the app is working, and while the sheet is open,
  a large spinning ring sits over the menu. When the sheet closes the app
  shows one big picture for about two seconds, then goes back to the list:
  - a **tray with a tick** means the file was handed to the phone's share
    sheet. The app cannot see whether the app you chose actually received or
    sent it — if that matters, check there.
  - a **tray with a broken rim** means the file WAS handed to the phone's
    share sheet, but some of the chapter or book was left out (a segment with
    no recording, or a whole missing chapter in a book) — the same picture the
    Share menu already shows before you tap Share now. The words under the
    picture say what was left out. Check the recording before treating it as
    complete.
  - a **tray with a down arrow** means the sheet was closed before anything
    went out. Nothing was sent; share again when ready.
  - a **bare tray** (no arrow) means there was nothing recorded to share yet.
  - a **red triangle** means it failed — try again. The menu keeps the message
    after the picture goes.

  On Android the Share button itself is Android's own share picture (three
  joined dots); on iPhone and in the browser it is the box with an arrow. It
  does the same thing on both. <!-- source: src/components/share-outcome-glyph.ts (the marks), src/hooks/share-progress.ts (MIN_BUSY_MS, OUTCOME_HOLD_MS = 1800 ms, ShareSettled's "partial" outcome), src/components/control-affordance.ts shareControlGlyph (#490, decided 2026-09-19); not device-verified as of 2026-09-19 -->

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

### Send what the app recorded

The app keeps its own short record of **some** of what goes wrong on that phone
— the last 50 entries, and nothing a person typed or recorded. <!-- source: src/types/failure.ts (FAILURE_LOG_LIMIT = 50); src/lib/storage/failures.ts (the ring); src/lib/failure-text.ts (what a stored entry holds) --> It survives
closing and reopening the app. <!-- source: src/lib/storage/db.ts v6 `failures` store; e2e/failure-log.spec.ts "the log survives a reload" -->

**Read "some" literally — this is the part to get right.** What is written down
today is: the app crashing or reloading itself, a problem nobody caught,
failures while making an MP3 or preparing a share, a recording that fails to
save, a book that fails to delete, an erase that fails, a few narrow faults
inside the recorder: an interruption (a call, another app taking the
microphone) that finds the recorder still running, a microphone wake-up at
Record that failed or took longer than one second, and a Stop or a Back whose
teardown threw inside the app — and, on the playback side, Play refusing to
start because the shared context never freed itself for sound, whether that
took too long, an earlier rejection did, or a fresh interruption arrived
during the buffer-fill/yield right before the source would have started. <!-- source: src/app/install-failure-listeners.ts (uncaught-error, unhandled-rejection); src/components/error-boundary.tsx (render); src/hooks/mp3-codec.ts (encoder-health, encoder-recover); src/hooks/finish-transcode.ts (transcode-sweep, transcode-segment); src/hooks/share-flow.ts:101 (share-prepare); src/hooks/use-recorder.ts (recorder-interrupted-active #478 — onInterrupted's still-active arm; recorder-start-resume #470 — raceAudioResume's rejection branch; recorder-start-resume-timeout #475 — start()'s own report after the await, only once its generation check has passed (a cancelled or superseded start writes nothing) and only when raceAudioResume's 1000 ms timer won; recorder-cancel-stop #474 — cancel()'s native stop() guard; recorder-stop-flush #485 — stop()'s own catch on its bounded flush, which then seals the slices already delivered and carries them through the ordinary tail, so a Stop whose teardown threw is written down AND keeps whatever audio was in hand); src/hooks/use-audio-session.ts stopRecording's backstop catch (recorder-stop-backstop #480 — fires only when endRecording() REJECTS, which the flush catch above never does; a Stop whose failure rides the StopResult to the sheet's Notice does not reach it); src/hooks/use-save-take.ts:105 (save-take, #456); src/hooks/use-books.ts:644 (book-delete, #456 — deleteBook's catch, structurally pinned in tests/use-books-delete-failure-gate.test.ts since this hook cannot be rendered in this Node-only suite); src/hooks/use-erase-segment.ts:44 (erase-segment, #456 — the store-failure catch only, not the separate post-erase-notification one); src/hooks/audio-io.ts's playSamples (a single try/finally is now the ONE report site for all three keys below — dev lead pick, option A, 2026-09-19 judgment sheet, closing the row-accounting class George round-2 P3 and Frank rounds 1 and 3 each found one more exit of: playback-resume #469 — raceAudioResume's own rejection report, or playSamples's single exit reporting a captured one; fires for a LATE rejection arriving after the 1000 ms bound already won the race, for an early rejection whose OWN resume() call failed but the shared context turned out usable anyway because a DIFFERENT, concurrent resumeAudioContext() call elsewhere (playTake/playBuffer's own fire-and-forget in-gesture unlock) won first (Frank round-1 P2), OR for an early rejection on a claim that was superseded (a Stop, a competing Play) before either fail-closed check below ever ran — previously dropped with no row at all (Frank round-3 P2 @ audio-io.ts:678), now still reported since the finally is reached from every exit, superseded or not; an early rejection that leaves the context still unusable is instead folded into playback-resume-unusable below, carrying the REAL captured cause rather than a synthetic stand-in (previously always synthetic even when a real cause existed — Frank round-3 P2 @ audio-io.ts:694), so one failed Play never writes more than one row (George round-2 P3); playback-resume-timeout #469 — the single exit's fail-closed report when the 1000 ms bound was what left the context still needing resume; playback-resume-unusable #469 — the same single exit when the context still needs resume without the bound firing: an early rejection, a resume() that resolved but left the context still needing resume, or a fresh interruption arriving during the buffer-fill/yield after resume had already succeeded (George round-2 P2)) --> What is **not** written
down today is the microphone refusing to start, a Stop that fails the way you
see it — the recorder's own notice that no sound was recorded or that the
recording could not be decoded — Play failing for a reason besides a stuck
resume (a bad decode, or nothing saved to play), and the share sheet failing
at the moment of sending. Those show their own message on screen and leave no
entry behind. <!-- source: src/hooks/use-audio-session.ts — the seven console.error sites that report nothing: audio-context resume before Play (take and buffer, two sites — priming calls distinct from playSamples's own raceAudioResume, which now reports under playback-resume/-timeout/-unusable above), nothing-to-play, take playback, buffer playback, record-start, and primeAudioContext on sheet open (the take-playback and buffer-playback catches still report nothing themselves; they only ever wrap a row that playSamples already wrote when the cause was a stuck resume, and stay silent for every other cause, a decode failure or a dangling clip included) (NOT stopRecording's backstop catch, which reports under recorder-stop-backstop since #480; a Stop that returns its error in the StopResult never enters that catch — and "Could not finish this recording." is deliberately NOT in this list: both of its sources, the backstop and use-recorder.ts's flush catch (recorder-stop-flush #485), write a row); src/components/recorder.tsx (commit/preview); src/hooks/share-flow.ts:460 — all still end at console.error; gh issue #205 round-2 G2 --> So
when the microphone, playback for a reason besides a stuck resume, or the
share sheet fails in front of you, **write it down yourself** (§5.2) and do
not assume this report carries it. Routing those to the record is follow-up
work, not something this build does. <!-- source: src/hooks/report-failure.ts:41 -->

1. On the **Books** screen (the first screen), look at the **≡** button in the
   top corner. If something has gone wrong, it carries a small red mark. <!-- source: src/components/books-screen.tsx -->
2. Tap **≡**. The menu says how many problems were recorded, and shows two
   buttons. Like everything else in this app they are **pictures, not words**:
   the **share** icon and the **bin** icon. <!-- source: src/components/failure-log-panel.tsx (icon-only Controls; the two Notices carry the only text) -->
3. Tap the **share** icon once — it prepares the report — then tap it again
   when it turns into the highlighted share button. The report goes out as a
   small **text file**, through the phone's normal share sheet. Which apps that
   sheet offers has not been checked on a real phone yet, so try whatever is
   there — if it offers saving the file or attaching it to an email, that is
   the preferred route when available. Send it to your maintainer contact.
   Two taps is deliberate, and it is the same two taps as sharing a recording. <!-- source: src/hooks/use-failure-log-share.ts (two-gesture share); on the installed app the share goes through src/hooks/share-target.ts:338 `Share.share({ files })` — a file, never plain text; which apps the sheet then lists, and whether it offers save/email at all, is device behaviour and is not device-verified (gh PR #440, George round 6 P2-2; Frank round 10 P2-2) -->
4. Tap the **bin** icon afterwards if you want the mark to go quiet again. It
   empties only this problem record — nothing anyone recorded is touched. <!-- source: src/lib/storage/failures.ts clearFailures (clears only the `failures` store) -->

If the app itself fails and shows the restart screen, that screen has its own
smaller **share** icon underneath the big restart button — use it before
tapping restart. The screen that appears when a recording will not save has
the same small **share** icon in the same place, for the same reason: it
also takes over the whole screen and blocks the way back to **≡**, so this is
its own door to the same report. <!-- source: src/components/send-log-control.tsx (SendLogControl, shared by both screens since #456); src/components/error-boundary.tsx (rendered after the primary Restart); src/components/save-failed.tsx (rendered after the primary Retry/Restart, hidden while a save attempt is in flight); DatabasePanel does NOT carry this control — #456 calls that a design call -->

Two things to know honestly: the mark appears on the Books screen only, so you
will see it when you go back there; <!-- source: src/components/books-screen.tsx; gh issue #205 round-1 G7, accepted as product intent --> and sending has not yet been tried on a
real phone's share sheet, so tell us if it does not open. <!-- source: gh PR for #205, "not device-verified" -->

A third thing, specifically about the **save-failed** screen's share icon: the
app keeps converting already-finished recordings to a smaller file in the
background, and that work does not pause just because the save-failed screen
is up. If that background work is itself failing at the same time as your
save, it can overwrite the report you just armed before your second tap sends
it — so on that screen only, a share that will not "stick" (turns quiet again
on its own, or needs more than two taps) is a known limit, not something you
did wrong. Retry the save first; if the save then succeeds, the background
work settles and the share behaves normally again. <!-- source: src/hooks/finish-transcode.ts (module-scoped transcode sweep, no pause on SaveFailed mount); src/components/error-boundary.tsx quiesceTranscodeSweep() (the crash screen's screen-only fix, not available here because its quiesce is one-way and this screen's exit is Retry on the same page); AGENTS.md "Errors have a channel before they have copy" (SaveFailed paragraph); George R1 P2-2 on #509 -->

### Write down what the app cannot know

The app's record does not say what was happening in the room. When something
goes wrong, still write down:

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
