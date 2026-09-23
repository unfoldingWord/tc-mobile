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
   outside the Play Store. Wording and settings vary by phone and language.
   If downloading or installing stops, record the message and the step where
   it stopped; do not guess which extra settings to change.

   **A developer tester reported needing to change several phone settings
   before the download and install would proceed**, on a plain Android
   phone. He did not list which settings, so treat this as a heads-up, not a
   checklist: the rule above still holds. Expect the download warning and
   "Allow from this source" at the steps `tester-install.md` names; any
   other prompt, or one in a language you cannot read, gets photographed
   and recorded before anyone taps it. <!-- source: gh issue #248, tester
   report 2026-09-22 (contributing developer, source: tester) -->

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
5. **Show them the two menu buttons before they need them.** Everything in
   this app is opened by a picture, never a word, and there are exactly two
   pictures that open a menu:
   - **⋮** (three dots in a column) — on a book, a chapter, or a segment. It
     opens that one item's own actions: rename it, delete it, mark a segment
     finished, and so on.
   - **≡** (three stacked lines) — only in the top corner of the Books screen
     (settings and the problem report) and inside the recorder (the drawer
     with Edit, Mark finished, and Erase for the segment that is open).
     Rename and delete stay on the item's **⋮**.

   Point this out once, early: a participant who has only ever seen one of
   the two glyphs will otherwise tap the wrong one and conclude nothing is
   there. <!-- source: src/components/menu.tsx (hamburger prop docblock); src/components/books-screen.tsx (bookMenuOpen icon="more"); src/components/segments-screen.tsx (chapterMenuOpen icon="more"); src/components/segment-row.tsx (segmentMenu icon="more"); gh PR #683 (Part of #589), decided by the dev lead 2026-09-23: "please use kebab on objects and hamburger menu for global" (https://github.com/unfoldingWord/tc-mobile/pull/683#issuecomment-5787553352) -->

## 3. During the training

- **Recording and editing work offline.** No signal is needed at any point.
- **Tapping the square ends and saves a recording in one step.** There is no
  in-between "paused" state anymore — the moment the square is tapped, that
  recording is saved into the segment and the waveform shifts to show it —
  that shift is the sign it landed. If a save-failed screen appears instead,
  stay on it and resolve it (§4) before anything else. Tapping Record again continues from where the waveform now sits. <!-- source: src/components/recorder.tsx (Recorder docblock, "A take ends when the tap that stops it lands (#614, Option A)"; commitTake); gh PR #681 -->
- **The `[ ]` control opens and closes editing.** One tap opens editing with
  a span already selected, starting where the waveform sits (playback stops) and
  reaching forward; tap `[ ]` again to leave editing and go back to
  Record/Play. There is no separate "select, then edit" step. <!-- source: src/components/recorder.tsx (Recorder docblock, RECORD/EDIT modes); gh PR #705 (Closes #557, #554) -->
- **Rename a segment from its own `⋮` menu.** This is how a participant
  labels a segment with what it actually is (for example, the verse range)
  instead of leaving it as a number. A rejected rename leaves the old name in
  place and says so; try again. <!-- source: src/components/segment-row.tsx (renameSegment control); gh PR #675 (feat(segments): rename a segment from its row menu, #591) -->
- **A new chapter asks for a name before it is created**, already filled in
  with "Chapter N" — accept that or type a real name (for example, a book
  and chapter reference), then confirm. <!-- source: src/components/books-screen.tsx (onNewChapter, NewBookDialog-style prompt, #609); gh PR #637 -->
- **The recorder's own `≡` (its overflow drawer) opens and closes instantly** —
  it does not slide in or out, so do not expect an animation as a sign it
  worked; if the drawer's contents are on screen, it is open. <!-- source: src/components/menu.tsx (hamburger prop docblock, "opens and closes in place"); gh PR #656 (Fixes #621) -->
- **Sharing a chapter** produces one MP3 file. **Sharing a book** produces a
  zip file of all its chapters. Both go out through the phone's normal share
  sheet (the same menu you'd use to share a photo). <!-- source: AGENTS.md "Known open items" #5, and docs/decisions/0009-transcode-on-finished.md -->
- **Agree where to send recordings before the exercise.** The participant
  chooses an app or destination in the phone's share sheet. Check that chosen
  app to confirm the file arrived; tC Mobile does not keep a destination
  history. Sharing again prepares a new file from the current recordings; it
  does not update a copy already sent. How a destination handles matching file
  names depends on that destination. <!-- source: src/hooks/share-target.ts; src/hooks/share-flow.ts -->
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
  - a **tray with a down arrow** means one of two things, and the words under
    the picture say which: on iPhone, in the browser, or when it says the
    sheet was closed, it means exactly that — nothing was sent, share again
    when ready. **On the installed Android app**, the same picture can also
    mean the app could not tell whether the sheet was actually dismissed or
    the file went out — Android's own share screen does not always report
    back which happened. If the words say the app could not confirm what
    happened, do not assume nothing was sent: check the app you meant to send
    it to (WhatsApp, Drive, whichever was chosen) before sharing again, so the
    same chapter or book is not sent twice. <!-- source: src/hooks/share-target.ts resolveProvesDelivery, src/hooks/share-flow.ts resolveSendOutcome, src/components/strings.ts shareUnproven (Frank a446708 P2, #491); not device-verified as of 2026-09-19 -->
  - a **bare tray** (no arrow) means there was nothing recorded to share yet.
  - a **red triangle** means it failed — try again. The menu keeps the message
    after the picture goes.

  On Android the Share button itself is Android's own share picture (three
  joined dots); on iPhone and in the browser it is the box with an arrow. It
  does the same thing on both. <!-- source: src/components/share-outcome-glyph.ts (the marks), src/hooks/share-progress.ts (MIN_BUSY_MS, OUTCOME_HOLD_MS = 1800 ms, ShareSettled's "partial" outcome), src/components/control-affordance.ts shareControlGlyph (#490, decided 2026-09-19); not device-verified as of 2026-09-19 -->

- **If sharing fails:**
  1. Keep the app installed and keep the recording.
  2. Write down the build stamp, chapter or book, message, and whether the
     phone's share sheet opened.
  3. Check that the saved recording still plays. A failed share does not ask
     the app to erase it; sharing can be tried again. Native share changes
     still need acceptance on the training phones. <!-- source: src/hooks/share-flow.ts; issues #336 and #245 -->

## 4. Known limits (as of 2026-09-23)

- **Finish recording — tap the square — before switching apps or locking the
  phone.** Once it is tapped, the recording is already saved (§3), so this is
  usually enough on its own. What it does not cover is a genuine
  interruption while the square still shows recording is live: an incoming
  call, a notification tap, the Home gesture. The app is designed to save
  what was captured up to that point automatically; the only result on record
  is one iPhone Safari run (2026-08-25), and no Android pass has reached it. Until it has,
  treat any such interruption on Android as a possible loss: after it,
  before recording again, check the segment list for the recording you
  expect to be there, and if a save or recovery screen appears instead, keep
  the app open and resolve it before doing anything else. <!-- source: src/components/recorder.tsx close(); AGENTS.md Testing ("Second on-device run: 2026-08-25 ... incoming call mid-take ... saved the partial take" on iPhone Safari; "no Android pass has reached interruption or background capture (#245)"); https://github.com/unfoldingWord/tc-mobile/issues/58#issuecomment-5770432574 (accepted for training; #471 and #484 are post-training follow-ups) -->
- **Use a practice book.** Create it with New book and give it a recognizable
  name. To remove it later, open that book's **⋮** menu, choose Delete, and
  confirm only after checking the book. Deleting a book removes its
  recordings. <!-- source: src/components/books-screen.tsx (NewBookDialog, bookMenuOpen icon="more", deleteBook control and confirmation) -->
- **You can listen to the selected audio while editing.** Use Play the
  selection to hear the selected span before changing it. This plays that
  span, not a preview of how the recording will sound after removing it.
  <!-- source: src/components/recorder.tsx; src/components/strings.ts auditionSelection -->
- **One current recording per segment.** Recording and editing can add to or
  change it; there is no version history to restore an earlier saved version.
- **Editing a finished segment re-compresses the audio.** Once a segment is
  marked Finished, its audio is compressed to save space. Editing it again
  decompresses it, and re-finishing it compresses it a second time. Each
  compression pass loses a small amount of quality, the way saving a photo as
  a JPEG twice does. This is expected, not a bug. <!-- source: docs/decisions/0009-transcode-on-finished.md, section 3 (generation count) -->
- **English only.** The app's menus and messages are in English; there is no
  other language option yet. <!-- source: gh issue #169, open -->
- **If playback is silent or too quiet, check the phone's media volume
  first.** If it persists, record the build, the screen used for playback,
  and whether it happened before or after marking the segment Finished.
  Do not assume volume explains every report. <!-- source: issues #269 and #555 -->

### If a recording will not save

Keep the app open. When offered, **Try saving again** retries the work held in
memory; do not record it again first. If it fails again, keep the screen open
and ask the facilitator for help. The small share icon sends a problem report,
**not the unsaved recording**. Do not restart or leave the app expecting that
report to preserve the audio. <!-- source: src/components/save-failed.tsx; src/hooks/use-save-take.ts -->

Discard asks for confirmation and abandons the pending work. After an ordinary
save failure, discarding an edit leaves the previously saved recording intact;
a new unsaved recording is lost. If another open copy of the app deleted the
book, its saved recordings are gone too. The save screen then offers confirmed
Discard instead of Try saving again: it cannot save into the deleted book or
restore it. The problem report contains no audio.
A screen offering Restart instead of Try saving again cannot retry the save;
restarting abandons the work held in memory. <!-- source: src/components/save-failed.tsx (discard, stale and downgrade paths); src/lib/storage/books.ts (deleteBook, saveTake) -->

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
save, a book that fails to delete, an erase that fails, a segment name
that fails to save, a few narrow faults
inside the recorder: an interruption (a call, another app taking the
microphone) that finds the recorder still running, a microphone wake-up at
Record that failed or took longer than one second, and a Stop or a Back whose
teardown threw inside the app — and, on the playback side, Play refusing to
start because the shared context never freed itself for sound, whether that
took too long, an earlier rejection did, or a fresh interruption arrived
during the buffer-fill/yield right before the source would have started. <!-- source: src/app/install-failure-listeners.ts (uncaught-error, unhandled-rejection); src/components/error-boundary.tsx (render); src/hooks/mp3-codec.ts (encoder-health, encoder-recover); src/hooks/finish-transcode.ts (transcode-sweep, transcode-segment); src/hooks/share-flow.ts:101 (share-prepare); src/hooks/use-recorder.ts (recorder-interrupted-active #478 — onInterrupted's still-active arm; recorder-start-resume #470 — raceAudioResume's rejection branch; recorder-start-resume-timeout #475 — start()'s own report after the await, only once its generation check has passed (a cancelled or superseded start writes nothing) and only when raceAudioResume's 1000 ms timer won; recorder-cancel-stop #474 — cancel()'s native stop() guard; recorder-stop-flush #485 — stop()'s own catch on its bounded flush, which then seals the slices already delivered and carries them through the ordinary tail, so a Stop whose teardown threw is written down AND keeps whatever audio was in hand); src/hooks/use-audio-session.ts stopRecording's backstop catch (recorder-stop-backstop #480 — fires only when endRecording() REJECTS, which the flush catch above never does; a Stop whose failure rides the StopResult to the sheet's Notice does not reach it); src/hooks/use-save-take.ts:105 (save-take, #456); src/hooks/use-books.ts:644 (book-delete, #456 — deleteBook's catch, structurally pinned in tests/use-books-delete-failure-gate.test.ts since this hook cannot be rendered in this Node-only suite); src/hooks/use-erase-segment.ts:44 (erase-segment, #456 — the store-failure catch only, not the separate post-erase-notification one); src/hooks/use-chapter-segments.ts renameSegment's catch and src/components/segment-row.tsx's rejection handler (segment-rename, #591 — not the vanished-segment case, which shows the stale-segment state instead); src/hooks/audio-io.ts's playSamples (a single try/finally is now the ONE report site for all three keys below — dev lead pick, option A, 2026-09-19 judgment sheet, closing the row-accounting class George round-2 P3 and Frank rounds 1 and 3 each found one more exit of: playback-resume #469 — raceAudioResume's own rejection report, or playSamples's single exit reporting a captured one; fires for a LATE rejection arriving after the 1000 ms bound already won the race, for an early rejection whose OWN resume() call failed but the shared context turned out usable anyway because a DIFFERENT, concurrent resumeAudioContext() call elsewhere (playTake/playBuffer's own fire-and-forget in-gesture unlock) won first (Frank round-1 P2), OR for an early rejection on a claim that was superseded (a Stop, a competing Play) before either fail-closed check below ever ran — previously dropped with no row at all (Frank round-3 P2 @ audio-io.ts:678), now still reported since the finally is reached from every exit, superseded or not; an early rejection that leaves the context still unusable is instead folded into playback-resume-unusable below, carrying the REAL captured cause rather than a synthetic stand-in (previously always synthetic even when a real cause existed — Frank round-3 P2 @ audio-io.ts:694), so one failed Play never writes more than one row (George round-2 P3); playback-resume-timeout #469 — the single exit's fail-closed report when the 1000 ms bound was what left the context still needing resume; playback-resume-unusable #469 — the same single exit when the context still needs resume without the bound firing: an early rejection, a resume() that resolved but left the context still needing resume, or a fresh interruption arriving during the buffer-fill/yield after resume had already succeeded (George round-2 P2)) --> What is **not** written
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
   small **text file**, through the phone's normal share sheet — **if it
   opens; see below for what to do on Android if it does not.** Which apps
   that sheet offers has not been checked on a real phone yet, so try
   whatever is there — if it offers saving the file or attaching it to an
   email, that is the preferred route when available. Send it to your
   maintainer contact. Two taps is deliberate, and it is the same two taps as
   sharing a recording. <!-- source: src/hooks/use-failure-log-share.ts (two-gesture share); on the installed app the share goes through src/hooks/share-target.ts:338 `Share.share({ files })` — a file, never plain text; which apps the sheet then lists, and whether it offers save/email at all, is device behaviour and is not device-verified (gh PR #440, George round 6 P2-2; Frank round 10 P2-2) -->
4. Tap the **bin** icon afterwards if you want the mark to go quiet again. It
   empties only this problem record — nothing anyone recorded is touched. <!-- source: src/lib/storage/failures.ts clearFailures (clears only the `failures` store) -->

If the app itself fails and shows the restart screen, that screen has its own
smaller **share** icon underneath the big restart button — use it before
tapping restart. The screen that appears when a recording will not save has
the same small **share** icon in the same place, for the same reason: it
also takes over the whole screen and blocks the way back to **≡**, so this is
its own door to the same report. <!-- source: src/components/send-log-control.tsx (SendLogControl, shared by both screens since #456); src/components/error-boundary.tsx (rendered after the primary Restart); src/components/save-failed.tsx (rendered after the primary Retry/Restart, hidden while a save attempt is in flight); DatabasePanel does NOT carry this control — #456 calls that a design call -->

Two things to know honestly: the mark appears on the Books screen only, so you
will see it when you go back there; <!-- source: src/components/books-screen.tsx; gh issue #205 round-1 G7, accepted as product intent --> and on the **installed Android app**, three
testers' devices have shown the phone's share sheet not opening at all when
sharing a recording, with the control still ending on a mark that can read as
success — the same underlying route the problem report's send also uses. <!--
source: gh issue #593, three Android device reports 2026-09-16 through
2026-09-22 (Galaxy A36, Galaxy S26, one earlier device), none showing a share
sheet; gh issue #593 comment 2026-09-22 ("the failure log's send takes the
same native route as Share Chapter"), stated there as inference from reading
the code, not yet confirmed on the log specifically --> **If you tap the
share icon twice for a problem report and no share sheet appears, do not keep
retrying and do not assume it went anywhere.** Fall back to writing it down
by hand instead — see ["Write down what the app cannot
know"](#write-down-what-the-app-cannot-know) below — phone model, Android
version, the build stamp, what was tapped, and what was on screen — and pass
that along at the end of the day the way you would for anything else. <!-- source: gh issue #593 -->

Sending a problem report has not otherwise been tried on a real phone's
share sheet, so also tell us if it opens but the wrong thing happens. <!--
source: gh PR for #205, "not device-verified" -->

On the **save-failed** screen, background conversion of finished recordings
pauses while you recover or send the report. It resumes when that screen
closes, including work requested during the pause. A conversion already in
flight can still finish and add one report entry, so the pause does not mean
the report is frozen instantly. <!-- source: src/components/save-failed.tsx pauseTranscodeSweep/resumeTranscodeSweep effect; src/hooks/finish-transcode.ts requestedDuringPause and in-flight withEncoder turn -->

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
