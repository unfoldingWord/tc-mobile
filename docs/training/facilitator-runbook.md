# Facilitator runbook — tC Mobile

This is for the person running the room: setting up phones, answering the
first questions, and knowing what to do when something does not work. It is
not a developer guide. Plain language, short steps.

**Nothing leaves the phone.** tC Mobile has no server of any kind. Recordings
are stored only in the phone's own app storage and never travel anywhere
unless someone deliberately taps Share. <!-- source: docs/decisions/0005-no-backend-in-phase-1.md; grep -rn "fetch(\|XMLHttpRequest\|WebSocket" src/ returned no matches, checked 2026-09-15 --> Tell every participant this up front — it was the very first question the first outside tester asked. <!-- source: gh issue #248, comment 2026-09-14 -->

**Four points are awaiting Tim**, the requirements owner. Each is marked
"Awaiting Tim" where it comes up. Where the runbook already has a safe
default, the text there says to keep using it.

1. Whether to offer the browser version at the training (§2, step 1).
2. Whether "share a very long book chapter by chapter" is a rule (§3).
3. Whether participants file their own problem reports (§5, "Where reports go").
4. Which private address the problem-report file goes to (§5, "Where reports go").

<!-- source: PR #1297 body, "For the requirements owner to confirm" items 1-4; no answer to any of them is on gh issue #248 as of 2026-10-05 -->

## 1. Before the training

1. Make sure you have the install link or invitation ready for every phone you
   will set up (see [`tester-install.md`](../tester-install.md) for the exact
   steps — do not retype them here, just follow that guide).
2. Know which kind of build each phone is getting: an Android phone installs
   an APK from a download link; an iPhone installs through TestFlight. <!-- source: docs/tester-install.md, "Android (download link)" and "iPhone (TestFlight)" sections --> The
   Android app needs **Android 7.0 (2016) or newer**, with Android System
   WebView kept up to date — an older phone cannot install it. <!-- source: android/variables.gradle minSdkVersion = 24 (Capacitor 8 floor; DRI pick 2026-09-28 on #1017 "Keep Android 7 (Recommended)"); the WebView wording is docs/native/system-requirements.md "Platform floors" --> The iPhone
   app needs **iOS 15.4 or newer**, and it is an **iPhone app: there is no
   iPad version** as of 1.0.1, and it has not been tried on an iPad. <!-- source: ios/App/App.xcodeproj/project.pbxproj IPHONEOS_DEPLOYMENT_TARGET = 15.4 and TARGETED_DEVICE_FAMILY = 1 (#1289, DRI pick 2026-10-01 "iPhone only for now"); PR #1289 "Not verified" (iPad compatibility mode not tried) --> The
   full requirements statement, with what is and is not measured, is
   [`docs/native/system-requirements.md`](../native/system-requirements.md);
   it states no memory (RAM) figure on purpose, and neither does this file. <!-- source: docs/native/system-requirements.md status paragraph; gh issue #1017 ("Don't publish the RAM figures until ... reported") -->
3. Bring a paper or digital "problem report" sheet (see [section 5](#5-reporting-a-problem)).
   The app can now send us what it recorded about a failure, but it records only
   some kinds of failure (§5 lists which), and only the app's own side of them —
   what the person was doing, and whether their recording survived, still has to
   come from you. The sheet is not a backup for the app's record; it is the
   larger half. <!-- source: gh issue #205; src/components/failure-log-panel.tsx (the menu panel), src/components/books-screen.tsx (the ≡ mark) -->
4. Charge every phone. Recording drains the battery faster than normal use.
5. **Know which build you are on.** The current build is **1.0.1**, the one
   submitted to the App Store and Google Play; the same name appears in the
   small build stamp at the bottom of every screen (`v1.0.1 · <short code>`;
   the short code after the `·` changes with every build). Check it on each
   phone before the session. The builds before it were release candidates
   named `1.0.0-rc.1` to `1.0.0-rc.3`; a phone whose stamp still reads
   `v1.0.0-rc.…` is on an old build and should be updated the way §2 says —
   over the top, never by uninstalling. On an iPhone, TestFlight may not yet
   offer the new build to every tester group; if it offers nothing newer and
   the stamp is not the one named for the session (§2 says how to read it),
   note the phone and tell the maintainer rather than reinstalling. <!-- source: src/components/build-stamp.tsx (`v{__APP_VERSION__} · {__BUILD_SHA__}`); docs/progress_tracker.md "2026-10-02 ... v1.0.0 and v1.0.1 shipped" (1.0.1 is the store build; "Assign TestFlight build 1790903231 to the testers' group" is listed under Next, so assignment is not recorded as done); docs/native/README.md §4a (a tester whose group is not assigned the new build stays on the previous one; happened on 1.0.0-rc.1) and §5a ("Release candidates use `tester-build-v1.0.0-rc.N`") -->

   **Not every phone has the new look.** A phone that saved the old look keeps
   it after an update, and the app no longer has a switch to change it. A phone
   that never saved a choice gets the new look. <!-- source: src/lib/design.ts readStoredDesign (a stored "current" wins; anything else, including nothing stored, reads as "o4"); nextDesign's docblock ("No menu entry calls it since #1244 removed the Books ≡ switch"); gh issue #1244 (DRI decision 2026-09-30); not device-verified -->
   - **How to tell:** open any menu. In the new look its top corner shows a **✕**.
     On an old-look phone that corner shows **‹**, **≡** or **⋮** instead. <!-- source: src/components/menu.tsx dismissGlyph (`o4` draws "close" unless `back`; otherwise `hamburger ? dismissIcon : "back"`) -->
   - An old-look phone still records, plays and shares normally.
   - These are **new look only**: the ✕ to close a menu, dragging a menu down to
     close it, tappable crumbs (book and chapter names) in the screen headers,
     chapter names in the headers, and the larger icons. Expect an old-look
     phone not to have them. <!-- source: src/components/menu.tsx (drag to close is O4 only, #1268); src/components/o4-crumbs.tsx (links, #1269; chapter name, #1230); src/components/segments-screen.tsx (the O4 header); src/app/styles/o4/recorder.css (glyphs drawn larger); not device-verified -->
   - **Do not uninstall or reinstall to change the look. That deletes every
     recording on the phone.** Write down which phone it is and tell the
     maintainer.

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

   **In short:** an Android phone opens `app-release.apk` from the newest
   release on <https://github.com/unfoldingWord/tc-mobile/releases> (the
   durable address <https://github.com/unfoldingWord/tc-mobile/releases/latest>
   lands on it) and taps through the "install from this source" warning; an
   iPhone accepts a TestFlight invitation, installs the free TestFlight app,
   then installs and opens tC Mobile through it — from the home screen
   afterward, not from TestFlight itself. `tester-install.md` has the full
   steps; this is only the shape of it. <!-- source: docs/tester-install.md
   "Android (download link)" and "iPhone (TestFlight)" sections; GitHub
   release v1.0.1 is the newest full release with app-release.apk attached
   (the rc builds before it were pre-releases); docs/native/README.md §5 step
   4, §4 -->

   The app also runs in a web browser at <https://tcmobile.app>. That is not
   the training route — the installed apps are — and recordings made in a
   browser are stored under the address that was opened, so a phone that
   used the older <https://tc-mobile.unfoldingword.workers.dev> address keeps
   its recordings only there. **The installed app is a third, separate store:**
   recordings made in a browser do not appear in the TestFlight or APK app
   on the same phone, and the other way round. A participant who tried the
   app in a browser before the training must Share anything they want to
   keep before switching to the installed app — the installed app opening
   empty does not mean the browser recordings are gone, but nothing moves
   them. **Awaiting Tim (requirements owner): whether to offer the browser
   route at the training at all.** Until he decides, use the installed apps. <!-- source: capacitor.config.ts (webDir "dist", no `server` block — the installed app loads its bundled files, not tcmobile.app); browser storage is per origin (gh issue #1295), so the WebView's own origin and the two HTTPS addresses are three stores — the exact WebView origin string is not in the committed config, and the "three stores" claim is an inference from per-origin storage plus the absence of any import path (src/lib/storage/persistence.ts docblock), confidence high; George round 1 P2-3 on PR #1297;
   docs/progress_tracker.md 2026-10-02 (tcmobile.app connected, serves
   1.0.1; "keep workers.dev with no redirect (recordings are stored per
   address)"); gh issue #1295; docs/tester-install.md "Web browser (no
   install)" -->

   **To update an installed phone to a newer build, do the same install
   action — install the new APK, or update through TestFlight — directly
   over the version already there. Never uninstall to update: uninstalling
   wipes the app's data, and every recording lives in that data, so
   uninstalling deletes every recording stored in the app.** <!-- source: gh issue #923,
   observed on Android 2026-09-25: "Uninstall v0.2.10, then install v0.2.12:
   the app shows 0.2.12, but all data from 0.2.10 is gone"; see also
   [the flip side of "nothing leaves the phone"](#the-flip-side-of-nothing-leaves-the-phone)
   --> A fix that stopped an in-place Android update from silently continuing to run the old build (#934) has merged and ships in 1.0.1, but it is not confirmed on a phone as of this writing, nor checked on iOS at all. <!--
   source: gh issue #923, comment 2026-09-27 ("the fix is
   in v0.2.13 ... Only the phone check is left: on an Android phone holding
   v0.2.12 recordings, install the v0.2.13 APK over it (don't uninstall),
   relaunch twice, and confirm the footer reads 0.2.13 and every recording
   is still there."); #923 was closed 2026-09-28 under the DRI's rule that a
   finished fix closes with its phone check carried on the #974 sheet, so
   closure is not confirmation; PR #934 merged 2026-09-26 (merge e5218643),
   an ancestor of this branch
   -->

   **The same rules apply to testers and to participants.** On an iPhone,
   open TestFlight, choose the newest build of tC Mobile and tap **Update**
   (or **Install**). On Android, open the newest `app-release.apk` and
   install it over the old one. On both, deleting the app erases every
   recording on it. If Android refuses to install over the old app, stop
   there: do not uninstall to get past it. The same goes for TestFlight
   offering no newer build, for a phone that should be on the newest build —
   but first read the whole stamp: a phone whose stamp already shows the
   build named for the session — the version **and** the short code after
   the `·` — is up to date, and TestFlight offering nothing newer there is
   success, not an install problem. The version alone is not enough: it
   stays the same across many builds. The short code changes when the app's
   code changes, and no more often than that: two TestFlight uploads of the
   same code show the same stamp, so when the maintainer says a NEW UPLOAD
   of the same build is the one to be on, the stamp cannot tell the two
   apart — ask the maintainer how to confirm it. If the version matches but
   the short code differs, the phone is not up to date: note the phone and
   tell the maintainer, as above. The app's own record
   cannot hold an install problem, so write down what you saw (the message,
   if there is one) and tell the maintainer (§5, "Write down what the app cannot know"). If a
   recording on that phone matters, share it first (§3), since Share is the
   only copy that leaves the phone. <!-- source: docs/native/README.md
   "Tester announcement template" ("If uninstalling is necessary, share any
   recordings you need to keep first: uninstall deletes them") and §5a
   (`INSTALL_FAILED_UPDATE_INCOMPATIBLE` when the signing differs, "Do not
   uninstall first"); docs/native/README.md §4a (a tester whose TestFlight
   group is not assigned the new build stays on the old one — happened on
   1.0.0-rc.1); docs/tester-install.md "iPhone (TestFlight)"; the
   TestFlight button labels are Apple's, not from this repo; the "already
   newest is success" clause is George's Low on PR #1279, batched in gh
   issue #1278, and it compares the WHOLE stamp because the version half
   alone cannot tell two builds apart (docs/native/README.md, the build-stamp
   paragraph under "Versions": two builds can share a package.json version;
   George round 1 on PR #1306). The short code is `git rev-parse --short=7
   HEAD` at build time (vite.config.ts, `buildSha`), not the iOS build
   number, so two uploads of one commit carry one stamp (George round 2 on
   PR #1306) -->

   After installing over an old build, close and reopen the app twice,
   then check the build stamp — the small text at the bottom of every
   screen, a version and a short code in the shape `v1.0.1 · <short code>`
   (the short code changes with every build; more in
   [section 5](#5-reporting-a-problem)). If it still shows the old version,
   or recordings are missing, stop: do not uninstall — write down the stamp
   and what you saw, as in section 5, "Write down what the app cannot know".
   An empty problem record there does not mean nothing happened. <!-- source:
   src/components/build-stamp.tsx; rendered on every screen via
   src/app/App.tsx -->

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
   - **⋮** (three dots in a column) — on a book, a chapter, or a segment,
     and in the top corner of the recorder. It opens that one item's own
     actions: rename it, delete it, mark a segment done, and so on. What the
     recorder's own **⋮** drawer holds depends on the look (§1, step 5):
     - **New look** (every freshly installed 1.0.1 phone): two tiles, **Done**
       (marks the segment finished) and **Reset** (its confirm box reads
       "Reset segment and start over"). There is **no Edit tile** here — Edit
       is the scissors on the recorder's bottom bar (§3). The drawer closes
       with the **✕** in its top corner, like every new-look menu.
     - **Old look**: rows, not tiles — Edit, "Mark segment N done", and
       "Reset segment and start over" — and the drawer's own close control is
       a **⋮**.

     The tile reads **Done**; the app's storage warnings and these notes say
     "finished" for the same state. <!-- source: src/components/recorder-menu.tsx (o4 branch: RecorderMenuTiles renders the Done tile in record mode and the Reset tile; its docblock: "Record mode has no Edit tile ... because the recorder screen carries its own edit control"; the non-o4 branch renders the Edit, mark-done and erase rows; `hamburger` + `dismissIcon="more"`); src/components/menu.tsx dismissGlyph (o4 → "close", otherwise `hamburger ? dismissIcon : "back"`); src/lib/strings.ts tileFinished ("Done", D17 #949), markFinished ("Mark segment N done"), tileErase ("Reset", #1220), eraseSegment ("Reset segment and start over"), enterEdit ("Edit recording", the scissors), storageLow ("Mark segments finished ..."); src/lib/design.ts DEFAULT_DESIGN = "o4"; src/components/segment-row.tsx; not device-verified; George round 1 P2-1 on PR #1297 -->

   - **≡** (three stacked lines) — only in the top corner of the Books screen
     (settings and the problem report). Rename and delete stay on the item's
     **⋮**.

   Point this out once, early: a participant who has only ever seen one of
   the two glyphs will otherwise tap the wrong one and conclude nothing is
   there. <!-- source: src/components/menu.tsx (hamburger prop docblock); src/components/recorder.tsx (recorderMenuOpen icon="more", #1225); src/components/books-screen.tsx (bookMenuOpen icon="more"); src/components/segments-screen.tsx (chapterMenuOpen icon="more"); src/components/segment-row.tsx (segmentMenu icon="more"); gh PR #683 (Part of #589), decided by the dev lead 2026-09-23: "please use kebab on objects and hamburger menu for global" (https://github.com/unfoldingWord/tc-mobile/pull/683#issuecomment-5787553352) -->

## 3. During the training

The space figures and the warning behaviour described in this section come
from the code and from desktop arithmetic, not from a phone: none of it has
been measured on a device yet.

- **Recording and editing work offline.** No signal is needed at any point.
- **Mark segments Done as the translator finishes them.** A finished segment
  is compressed in the background and takes about a tenth of the space of one
  still being worked on, so marking Done as you go is what keeps a phone from
  filling up. It is also the one thing the app's own storage warnings (below)
  ask for. <!-- source: docs/decisions/0009-transcode-on-finished.md and AGENTS.md "Known open items" 2 (64 kbps MP3 on Finished, PCM dropped, ~660 MB to ~66 MB for 50 stories); src/lib/strings.ts storageLow / storageCritical; the exact per-minute figures are arithmetic in docs/native/system-requirements.md "Storage: derived estimates", not measurements, and are not repeated here -->
- **Share each chapter at the end of each day.** The phone holds the only
  copy; Share is the only way a copy leaves it (§4, "The flip side"). Agree
  the destination before the exercise (below).
- **Long passages: record them as several segments.** The app stops and
  saves a recording by itself at **20 minutes**; the recording is kept, not
  lost, and the segment can be continued. Splitting a long passage into
  segments is the normal way to work, and it also keeps each recording small
  enough for a low-memory phone. <!-- source: src/lib/audio/take-cap.ts TAKE_CAP_MS = 20 * 60_000; src/hooks/use-recorder.ts (seals and saves at the cap, logs "recorder-take-cap", #1005, closed 2026-09-26); gh issue #248 comment on #1002's known limits ("keep each take short ... a very long take may fail on a low-memory phone" — an inference from the code, to be confirmed on a low-end phone) -->
- **Very long books: share chapter by chapter.** Share Book of a very long
  book (Psalms-sized) now streams to a temporary file instead of holding the
  whole book in memory, but no phone has run that path. Until one has,
  sharing chapter by chapter is the safer route for a long book at the
  training. **Awaiting Tim (requirements owner): whether this is a rule for
  every facilitator.** Until he decides, treat it as the safer default. <!-- source: gh issue #1003, closed 2026-09-28 ("Not verified: no phone has run either path yet, and the low-end phone measurement hasn't been done"); gh issue #248 comment on #1002's known limits -->
- **Keep the phone awake and the app open while a book is being shared.** A
  large book can take many minutes on a slow phone. If the app is closed
  partway, a temporary file may be left on the phone, taking up space. <!-- source: GitHub release v1.0.1 body, "Known limits in 1.0.1" (Share Book); gh issue #1004 (closed 2026-09-26); gh issue #248 comment on #1002's known limits -->
- **Do not clear the app's cache or storage from the phone's settings.**
  "Clear storage" (or "Clear data") deletes every recording. Whether "Clear
  cache" alone leaves recordings intact has not been verified on a phone, so
  treat both as off limits until it has. <!-- source: gh issue #248 comment on #1002's known limits ("Do not tell facilitators to clear the app's cache or storage until someone verifies on a phone"; a row for it on #974); docs/native/README.md §0 (uninstall deletes every recording; IndexedDB is the system of record) -->
- **What the storage warnings mean.** They appear on the Books screen only
  when there is something to act on. In the new look (§1, step 5) the first
  two come as a banner with a phone icon, the title "Share your work soon"
  and a **Share your work** button that shares every book on the phone as one
  zip; on an old-look phone they are a plain line of text. <!-- source: src/components/storage-pressure-banner.tsx (O4: state 17 banner, strings.storageShareSoon title, strings.shareAll button, #983/#987/#1045; current look: the #247 Notice); src/components/books-screen.tsx pressureLine -->

  **Share your work can refuse.** Before it builds anything it checks that
  the phone has room for the zip, and if not it says "This phone does not
  have room to prepare your work. Mark finished segments, then try again."
  — on the installed app as well as in the browser. If every segment is
  already finished, that line leaves nothing more to mark: **share one
  chapter at a time instead** (§3, "Sharing a chapter"), which does not take
  this check. Remove nothing until that chapter's file has been opened and
  checked at the agreed destination. In a browser on Android
  the button can also fail after building with "Could not share your work.
  Try again." (§4); again, share chapter by chapter. <!-- source: src/hooks/use-library-share.ts (roomForExport checked before the encode; InsufficientStorageError); src/lib/export/book.ts roomForExport and EXPORT_HEADROOM_FACTOR = 2 ("No device reading backs this figure"); src/lib/strings.ts shareAllStorage, shareAllFailed; Share Chapter and Share Book have no roomForExport caller (grep of src/); src/hooks/share-target.ts selectShareRoute ("unsupported" when canShare rejects the file; the native route never consults canShare); not device-verified; George round 1 P2-2 on PR #1297 -->

  The words of the three warnings are:
  - "This phone is running low on space. Mark segments finished to free up
    room, or share your work and then remove it." — a heads-up, with time to
    act. Mark segments finished first. **Remove nothing from the app until
    the shared copy has been opened and checked at the agreed destination**
    — a share that failed or was cut short is not a copy. For a long book,
    the chapter-by-chapter note above applies to this share too.
  - "This phone is almost out of space, and new recordings may not save. Mark
    finished segments, or share your work and then remove it." — urgent: new
    recordings may fail to save. Stop recording on that phone until space is
    freed, and share first if anything on it matters. The same rule holds:
    remove nothing until the shared copy has been checked.
  - "This phone may delete what you record here if space runs low. Share your
    work when you can." — **browser version only**; the installed app does not
    show it. It means the browser has not promised to keep the app's storage.

  None of the lines shows a number, on purpose — the phone's own estimate is
  too coarse to promise one. <!-- source: src/lib/strings.ts storageLow, storageCritical, storageNotPersisted; src/components/storage-pressure-notice.ts (whole gate; low = info, critical = alert, DRI 2026-09-24); src/lib/storage/pressure.ts ("Nothing may render the numbers this is computed from"); src/lib/storage/persistence.ts storageMarker (`native` returns null — the not-persisted line is not shown in the installed app); not device-verified -->

- **Starting a segment over.** A translator who wants to say the whole
  segment again does not need to edit it: in the recorder, the **eraser** at
  the left end of the bottom bar ("Clear and record again") clears the
  recording. A small panel asks once more (the eraser there confirms, the back
  arrow cancels). The recorder stays open with the segment empty, ready for
  Record. The eraser is greyed while recording and when the segment has
  nothing saved yet. There is no undo for a clear. Clearing keeps the
  segment, and so does **Reset** in the segment's **⋮** on the chapter screen
  (its confirm box reads "Reset segment and start over"). **Delete** (the bin,
  in the same **⋮**) removes the whole segment. <!-- source: src/components/recorder-toolbars.tsx (rerecord icon="eraser"), src/components/recorder.tsx onRerecord / onConfirmErase (#592), src/components/erase-confirm.tsx (glyph), src/components/segment-row.tsx (Reset and Delete tiles, #1119, #1220); not device-verified -->
- **Recording a new segment.** On the chapter screen, a segment with no
  recording shows a gray button with a red outline and a red microphone. It
  does **not** start recording: it opens the recorder, and the translator
  then presses the big red **Record** button there. Say this once, because a
  participant may expect the first tap to record. <!-- source: src/components/segment-row.tsx (variant="mic", strings.openRecorderSegment, #1217); not device-verified -->
- **Tapping the square ends and saves a recording in one step.** There is no
  in-between "paused" state anymore — the moment the square is tapped, that
  recording is saved into the segment and the waveform shifts to show it —
  that shift is the sign it landed. If a save-failed screen appears instead,
  stay on it and resolve it (§4) before anything else. Tapping Record again continues from where the waveform now sits. <!-- source: src/components/recorder.tsx (Recorder docblock, "A take ends when the tap that stops it lands (#614, Option A)"; commitTake); gh PR #681 -->
- **The scissors in the bottom bar open editing, and a ✕ in the same spot
  closes it.** One tap opens
  editing with a span already selected, starting where the waveform sits
  (playback stops) and reaching forward; while editing that button shows ✕ —
  tap it to leave editing and go back to Record/Play. The scissors that appear under the
  waveform, with no tile behind them, are Cut: a different control. There is no separate "select, then edit" step. <!-- source: src/components/recorder.tsx (Recorder docblock, RECORD/EDIT modes); gh PR #705 (Closes #557, #554); src/components/recorder-toolbars.tsx edit-toggle glyph (#955, #1252) -->
- **Rename a segment from its own `⋮` menu.** This is how a participant
  labels a segment with what it actually is (for example, the verse range)
  instead of leaving it as a number. A rejected rename leaves the old name in
  place and says so; try again. <!-- source: src/components/segment-row.tsx (renameSegment control); gh PR #675 (feat(segments): rename a segment from its row menu, #591) -->
- **A new chapter asks for a name before it is created**, already filled in
  with "Chapter N" — accept that or type a real name (for example, a book
  and chapter reference), then confirm. <!-- source: src/components/books-screen.tsx (onNewChapter, NewBookDialog-style prompt, #609); gh PR #637 -->
- **The recorder's own `⋮` (its overflow drawer) opens and closes instantly** —
  it does not slide in or out, so do not expect an animation as a sign it
  worked; if the drawer's contents are on screen, it is open. <!-- source: src/components/menu.tsx (hamburger prop docblock, "opens and closes in place"); gh PR #656 (Fixes #621) -->
- **In the new look, `⋮` and `≡` only open a menu, and the ✕ at the menu's top
  right closes it** — the same on the Books, book, chapter, segment and
  recorder menus and the naming sheets. It can also be closed by dragging the
  bar at its top (or the row with the ✕) down; a short drag lets it spring
  back open. About's licence text keeps a back arrow, because there it goes
  back to the list rather than closing. **On an old-look phone (§1, step 5)
  the menu's top corner shows ‹, ≡ or ⋮ instead of ✕, and that control
  closes the menu.** <!-- source: src/components/menu.tsx (`back` prop docblock, dismissGlyph, drag down to close); src/components/recorder-menu.tsx (hamburger, dismissIcon="more"); src/components/sheet-drag.ts; #1268; not device-verified -->
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
    the picture say which. If they say the sheet was closed "before anything
    went out", nothing was sent — share again when ready. **On the installed
    Android app** the words may instead say the phone "can't confirm it went
    further." That line means a cancelled share and a sent one look the same:
    Android's own share screen does not reliably tell the app which happened,
    so the tray-with-a-tick below is not something the Android app can
    promise even on a successful share. Do not read the line as sent or as
    not sent: check the app you meant to send it to (WhatsApp, Drive,
    whichever was chosen) before sharing again, so the same chapter or book is
    not sent twice. <!-- source: src/hooks/share-target.ts resolveProvesDelivery
    (`route === "native" && platform === "ios"` — a native Android resolve is
    never classed "proven", because Android's own chooser can report
    RESULT_CANCELED as a resolve rather than a rejection once the activity has
    merely stopped, so the plugin cannot tell a real cancel from a real send);
    src/hooks/share-flow.ts resolveSendOutcome; src/lib/strings.ts
    shareDismissed ("... before anything went out."), shareUnproven ("The share sheet closed. This phone can't confirm it went
    further."); this wording was reported back near-verbatim from a real
    Android phone on gh issue #593 (2026-09-22 comment, Galaxy A36: "The share
    sheet closed, this phone can't confirm it went further.") -->
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

### What to watch for at the training

Some changes to the app will be decided from what you see at the training. For
each participant, write down the three things below. Write the person's
role, never their name. Pass the notes along at the end of each day with
your other notes (§5).

1. **Fixing a mistake.** When a participant wanted to change something they
   said, what did they do? Write which of these they used:
   - **Edited the recording:** opened editing with the scissors in the
     bottom bar, then cut a piece out (the scissors under the sound picture)
     or put a cut piece back (paste, the arrow onto a line).
   - **Said it all again:** the eraser in the recorder ("Clear and record
     again"), or **Reset** in the segment's ⋮ menu.

   Write whether they found it alone or someone showed them. Opening editing
   and then leaving it without cutting counts as "looked at editing", not as
   an edit.

2. **The names they typed.** Copy down exactly what they typed for each
   book, chapter and segment name. If a name is a person's name or phone
   number, write "a person's name" or "a phone number" instead. Note any
   name that was cut off with "…", and whether that confused them. If they
   typed a number as a chapter name (for example "22"), note what they
   expected the chapter's number to be.
3. **The icons.** If you are running the icon check, follow
   [`icon-recognition-protocol.md`](icon-recognition-protocol.md) and fill in
   its sheet. It takes about ten minutes per participant. Its results also
   decide whether the round buttons need to stand out more from the
   background, so run it if you can.

<!-- source and tracking, for maintainers:
     item 1: gh issue #595 (DRI pick 2026-09-28, "After training observations (Recommended)": facilitators note who used cut/paste and who re-recorded; the editor-optional decision is made from those notes); strings.ts rerecord = "Clear and record again" and tileErase = "Reset"; the bottom-bar scissors open editing, Cut is the scissors under the waveform, Paste is the arrow onto a line (§3 above; icon-recognition-protocol.md rows 6, 8, 9). Split per George round 1 P2-1 on PR #1314.
     item 2: gh issue #1284 (long names cut off with "…", no way to read them in full; known limit in §4) and gh issue #1272 (a typed chapter "number" becomes the chapter's name while the badge shows its position — the issue labels this inferred from the code).
     item 3: gh issue #249 and ADR 0010 (docs/decisions/0010-icon-recognition.md); gh issue #461 waits on the #249 check (DRI pick 2026-09-28, "Decide after the #249 icon check (Recommended)": if people find controls by the glyph, the button-disc contrast is accepted; if not, a border or a lighter surface ladder is chosen).
     Observation notes are per participant and by role, per AGENTS.md "Tester feedback is tagged by kind and source". -->

## 4. Known limits (as of 2026-10-02, build 1.0.1)

- **The iPhone app is iPhone-only.** There is no iPad version, and the app
  has not been tried on an iPad. An Android tablet is not something any
  build has been run on either; this file says "phone" throughout because
  phones are what has been tested. <!-- source: ios/App/App.xcodeproj/project.pbxproj TARGETED_DEVICE_FAMILY = 1 (#1289); PR #1289 "Not verified"; docs/progress_tracker.md 2026-10-02 "Not run" ("The iPhone-only build has not been installed on a device") -->
- **Nothing in 1.0.0 or 1.0.1 has run on a phone beyond what the rc.3
  testing covered.** Recording, editing, sharing and storage did not change
  between rc.3 and 1.0.1; the 1.0.1 changes are the privacy link in About,
  the iPhone-only build, and the privacy declarations. Treat every "not
  confirmed on a phone" note below as still open. <!-- source: docs/progress_tracker.md 2026-10-02 "Not run"; GitHub release v1.0.1 body ("Recording, editing, sharing and storage are unchanged. None of this has been run on a phone yet.") -->
- **Long names are cut off** with "…" in headers and menus, with no way yet
  to read them in full. Short names work best (a book and chapter reference
  rather than a sentence). <!-- source: gh issue #1284, open; GitHub release v1.0.1 body "Known limits in 1.0.1" -->
- **After a phone alarm goes off during a recording**, the recorder's timer
  and a flat waveform may keep running after the alarm is dismissed, even
  though the saved recording ends where the alarm sounded — the screen says
  "recording" when nothing more is being captured. If an alarm rings, tap
  the square and play the segment back: trust what you hear, not the timer or
  the waveform. Do not Reset. Whether tapping Record afterwards continues the
  saved audio has not been confirmed, so keep the take as it is and report
  the build stamp (§5). One tester report, 2026-10-02, with the phone and
  build not given; not reproduced by us. <!-- source: gh issue #1294, open ("the recording actually ends when the timer went off ... a weird false graphic of time going up"; build, platform and OS version not given; cause inferred, not run); PR #1298 (fix lane, open: the hook never bound the track's mute event, so the on-screen position after an alarm is unreliable until that fix ships); docs/progress_tracker.md 2026-10-02 "Other"; bench George round 3 on PR #1297 -->

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
  the app open and resolve it before doing anything else. <!-- source: src/components/recorder.tsx close(); AGENTS.md Testing ("Second on-device run: 2026-08-25 ... incoming call mid-take ... saved the partial take" on iPhone Safari; "no Android pass has reached interruption or background capture (#245)"); https://github.com/unfoldingWord/tc-mobile/issues/58#issuecomment-5770432574 (accepted for training; #484 is the post-training device-evidence follow-up; #471, the earlier fix attempt, was closed 2026-09-24 as unrebaseable after #614 removed the recorder's paused state, and its replacement is #807, post-training) -->
- **Known issue on iPhones (#1251, 2026-09-30): Play and the live waveform can
  stop working.** **If Play is silent or fails, do this, in this order:**
  1. **Before touching anything, note what the screen shows** — whether it
     says "Could not play this recording.", and whether the Play button is
     showing as playing (a pause symbol) or not. Pressing again clears the
     message.
  2. **Leave the app open. Which screen you noted decides what the next
     press does:**
     - **The message is up and the button shows Play (not pause):** press
       Play once. On rc.3 and 1.0.1 that press is the fresh start. Wait for
       the voice.
     - **The button shows pause and there is no message:** that Play is
       still trying. Pressing now only stops it — it does not set up the
       fresh start. Press Play again after that and wait: the press that
       brings the message onto the screen is not the fresh start either.
       Once the message is up, press Play once more and wait for the voice.
       **If that press stays silent and the message never comes, go to
       step 3 — do not keep waiting for it.**
     - **The button shows Play and there is no message:** press Play once
       and wait for the voice. If it stays silent, go to step 3.
  3. **If the press that should have been the fresh start is still silent
     or does nothing, or no press ever brings the message or the voice,
     fully close the app** — swipe it away in the phone's
     app switcher — **open it again, play the recording, and confirm you hear
     the voice before anyone records again.** If it is still silent after
     that restart, leave that phone alone.
  4. **Send the report (§5) the first time this happens on a phone in a
     session, even when a later press brought the voice back.** The rc.3 fix
     has not been confirmed on a phone, so that report — with what you noted
     in step 1 and which press or step brought the sound back — is the device
     evidence #1251 is missing. Note the iPhone model and whether headphones
     were connected.

  **If the moving line goes flat while recording,** stop the take with the
  square as usual, then **play that take and confirm you hear the voice
  before anyone records again** on that phone. If you do not hear it, go
  through the steps above. Send the report (§5) either way: the red mark on
  Books **≡** is expected to light for this, and the "capture keeps working"
  claim below is inferred from the code, not seen on a phone. <!-- source: gh issue #1251 (DRI comment 2026-09-30); src/hooks/audio-io.ts playSamples (clock check after source.start, "playback-clock-stalled", then discardSharedContext so the next Play builds a fresh context in its tap), checkSharedClockOnReturn (runs on the page becoming visible; writes "audio-clock-stalled-on-return"), src/hooks/use-audio-session.ts onVisibilityChange; src/lib/failure-marker.ts lightsFailureMarker (only "recorder-take-cap" is exempt, so every other row, these included, lights the ≡ mark); "Could not play this recording." is src/lib/strings.ts playbackFailed; the shared context is what decoding a captured take uses (src/hooks/audio-io.ts decodeAudioData via getAudioContext), and the live meter reads it too (createLevelTap), so a stalled clock can leave the waveform flat while the capture itself keeps working — that capture claim is inferred from the code, not observed; the swipe-away workaround is from the tester's report in #1251 and has not been confirmed by us on a device; not device-verified; the order — second Play before the restart — is George round 1 on PR #1306: the restart-first order made the "report the first recovered Play" ask below impossible to follow, because the second Play was never pressed; George round 2 on PR #1306 added step 1 (a second press clears the message: `claimFloor` sets `playbackError` to null, src/hooks/use-audio-session.ts), the stop-first rule (a press on a segment already marked playing is the toggle-off, src/hooks/use-audio-session.ts playTake/playBuffer, and does not build a new context), the "only after the message" limit (src/hooks/audio-io.ts playSamples discards the context and throws on two exits — the "stalled" clock verdict, and the resume fail-closed gate, whose `unusableError` makes the `finally` discard it — and the caller paints the same message for both; a silent "not-running" context returns a live handle and shows no message) and the step-2 split by screen is George round 3 on PR #1306: a Play that is still trying shows the pause glyph before any message (src/hooks/use-audio-session.ts playBuffer sets playingBuffer before its awaits), a press on it only stops (recorder.tsx's playingBuffer branch → stopAll, which bumps the session generation, src/lib/audio/session.ts, so watchClock resolves "skipped" and nothing is discarded, src/hooks/audio-io.ts), and the fresh context is built only by the press AFTER the message is painted; the two no-message exits to step 3 (a press that never paints the message, and the Play-glyph-with-no-message case) are bench George round 4 on PR #1306: a "not-running" clock verdict returns without throwing (src/hooks/audio-io.ts watchClock, and playSamples returns unless the verdict is "stalled"), so a silent press need not ever show the message; the flat-line paragraph (src/hooks/audio-io.ts createLevelTap writes "recorder-tap-clock-stalled" and keeps pushing frames, so the scope does not freeze and nothing in the Play steps would be triggered) --> <!-- source: gh issue #1251 is open and its fix is marked not device-verified in the comment above; the ask to report the first recovered Play is George's Low on PR #1279, batched in gh issue #1278 ("asking for it would give the device evidence #1251 still lacks") -->

  What rc.2 phones saw: after connecting Bluetooth headphones, and sometimes
  after coming back from the lock screen, the Play button failed or did
  nothing, and the moving line that shows the voice while recording stayed
  flat. The recording should still be saved. **A fix shipped in rc.3 and is
  in 1.0.1, but it is not confirmed on a phone, including with the silent
  switch on.** What a person may still see on rc.3 and 1.0.1 (the rc.3
  residuals): <!-- source: GitHub release v1.0.1 body, "Known limits in 1.0.1" ("Not yet confirmed on a phone: the rc.3 recovery of Play and the live waveform after locking an iPhone (#1251), including with the silent switch on") -->
  - a Play that fails with "Could not play this recording."; the next Play
    then starts fresh;
  - a red mark on Books **≡** that can appear just from coming back to the
    app (§5).

- **Use a practice book.** Create it with New book and give it a recognizable
  name. To remove it later, open that book's **⋮** menu, choose Delete, and
  confirm only after checking the book. Deleting a book removes its
  recordings. <!-- source: src/components/books-screen.tsx (NewBookDialog, bookMenuOpen icon="more", deleteBook control and confirmation) -->
- **You can listen to the selected audio while editing.** Use Play the
  selection to hear the selected span before changing it. This plays that
  span, not a preview of how the recording will sound after removing it.
  <!-- source: src/components/recorder.tsx; src/lib/strings.ts auditionSelection -->
- **One current recording per segment.** Recording and editing can add to or
  change it; there is no version history to restore an earlier saved version.
- **Editing a finished segment re-compresses the audio.** Once a segment is
  marked Done, its audio is compressed to save space. Editing it again
  decompresses it, and marking it Done again compresses it a second time. Each
  compression pass loses a small amount of quality, the way saving a photo as
  a JPEG twice does. This is expected, not a bug. <!-- source: docs/decisions/0009-transcode-on-finished.md, section 3 (generation count) -->
- **English only.** The app's menus and messages are in English; there is no
  other language option yet. Names people type can be in any script. <!-- source: gh issue #169, open; PR #1270 (typed names set their own text direction, rc.3) is part of #1267, which stays open, so no further right-to-left claim is made here -->
- **Share Book and Share your work in the browser version on Android** can
  fail after the file is built: Share Book says "Could not share this book.
  Try again." and the storage banner's Share your work says "Could not share
  your work. Try again." Both hand over a zip, which Chrome on Android does
  not accept for sharing; a chapter is a plain MP3 and is not affected, so
  share chapter by chapter there. The installed Android app sends a share by
  a different route, and this failure has not been reported from it. <!-- source: gh issue #272, open (moved to v1.0.0 as the Chrome-on-Android PWA path; the APK routes shares through the Capacitor Share plugin and never reaches the Web Share gate, per the 2026-09-16 comment); src/hooks/share-target.ts selectShareRoute docblock ("Android Chrome's Web Share allowlist rejects application/zip (#272)" — the project's claim, not re-run here); src/hooks/use-library-share.ts and src/hooks/use-book-share.ts (both "application/zip"); src/hooks/use-chapter-share.ts ("audio/mpeg"); src/lib/strings.ts shareBookFailed, shareAllFailed; GitHub release v1.0.1 body lists #272 among the known limits; George round 1 P2-2 on PR #1297 -->
- **If playback is silent or too quiet, check the phone's media volume
  first.** If it persists, record the build, the screen used for playback,
  and whether it happened before or after marking the segment Done.
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
restarting abandons the work held in memory. <!-- source: src/components/save-failed.tsx (discard, stale and downgrade paths); src/lib/storage/books.ts (deleteBook); src/lib/storage/takes.ts (saveTake) -->

### The flip side of "nothing leaves the phone"

Nothing is backed up anywhere either. If a phone is lost, reset, or the app is
uninstalled, every recording on it is gone for good — there is no cloud copy
and no restore. <!-- source: docs/decisions/0005-no-backend-in-phase-1.md; docs/native/README.md §0 ("uninstall deletes every recording"); gh issue #24, closed 2026-09-15, superseded by #353 (whole-project import/export, post-V1) — the underlying fact holds: no file picker, import, unzip or restore path exists anywhere in src/ --> The only copy that leaves the phone is one made deliberately
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
Record that failed or took longer than one second, a Stop or a Back whose
teardown threw inside the app, and a recording that reached 20 minutes and was
stopped and saved by the app — and, on the playback side, Play refusing to
start because the shared context never freed itself for sound, whether that
took too long, an earlier rejection did, or a fresh interruption arrived
during the buffer-fill/yield right before the source would have started, or
Play failing for any other reason (a recording that could not be loaded or
decoded, or nothing saved to play), and the app's sound engine looking
switched on while its clock had stopped — found when Play started but no
sound followed within a second, while the level meter was drawing during a
recording, or when the app came back to the screen. In the exported file these three
show as `playback-clock-stalled` (Play started but no sound followed),
`recorder-tap-clock-stalled` (the level meter's clock stopped during a
recording) and `audio-clock-stalled-on-return` (found when the app came back
to the screen). Each one also puts the red mark on Books **≡**. <!-- source: src/app/install-failure-listeners.ts (uncaught-error, unhandled-rejection); src/components/error-boundary.tsx (render); src/hooks/mp3-codec.ts (encoder-health, encoder-recover); src/hooks/finish-transcode.ts (transcode-sweep, transcode-segment); src/hooks/share-flow.ts:101 (share-prepare); src/hooks/use-recorder.ts (recorder-interrupted-active #478 — onInterrupted's still-active arm; recorder-start-resume #470 — raceAudioResume's rejection branch; recorder-start-resume-timeout #475 — start()'s own report after the await, only once its generation check has passed (a cancelled or superseded start writes nothing) and only when raceAudioResume's 1000 ms timer won; recorder-cancel-stop #474 — cancel()'s native stop() guard; recorder-stop-flush #485 — stop()'s own catch on its bounded flush, which then seals the slices already delivered and carries them through the ordinary tail, so a Stop whose teardown threw is written down AND keeps whatever audio was in hand; recorder-release-track #479 — a track stop() that throws while the mic stream is released, reported per track so the other tracks are still stopped; recorder-take-cap #1005 — the elapsed tick sealing a take at the 20-minute cap, which the sheet then saves; not a failure, the one record that a take was cut); src/hooks/audio-io.ts (recorder-tap-clone-stop #479 — the level tap's cloned track throwing on its own stop()); src/hooks/use-audio-session.ts stopRecording's backstop catch (recorder-stop-backstop #480 — fires only when endRecording() REJECTS, which the flush catch above never does; a Stop whose failure rides the StopResult to the sheet's Notice does not reach it); src/hooks/use-save-take.ts:97 (save-take, #456); src/hooks/use-save-take.ts:202 (erase-segment, #456 — performClearEditedSegment's cut-to-empty close, not the segment-store erase below); src/hooks/use-books.ts:644 (book-delete, #456 — deleteBook's catch, structurally pinned in tests/use-books-delete-failure-gate.test.ts since this hook cannot be rendered in this Node-only suite); src/hooks/use-erase-segment.ts:44 (erase-segment, #456 — the store-failure catch only, not the separate post-erase-notification one); src/hooks/use-chapter-segments.ts renameSegment's catch and src/components/segment-row.tsx's rejection handler (segment-rename, #591 — not the vanished-segment case, which shows the stale-segment state instead); src/hooks/audio-io.ts's playSamples (a single try/finally is now the ONE report site for all three keys below — dev lead pick, option A, 2026-09-19 judgment sheet, closing the row-accounting class George round-2 P3 and Frank rounds 1 and 3 each found one more exit of: playback-resume #469 — raceAudioResume's own rejection report, or playSamples's single exit reporting a captured one; fires for a LATE rejection arriving after the 1000 ms bound already won the race, for an early rejection whose OWN resume() call failed but the shared context turned out usable anyway because a DIFFERENT, concurrent resumeAudioContext() call elsewhere (playTake/playBuffer's own fire-and-forget in-gesture unlock) won first (Frank round-1 P2), OR for an early rejection on a claim that was superseded (a Stop, a competing Play) before either fail-closed check below ever ran — previously dropped with no row at all (Frank round-3 P2 @ audio-io.ts:678), now still reported since the finally is reached from every exit, superseded or not; an early rejection that leaves the context still unusable is instead folded into playback-resume-unusable below, carrying the REAL captured cause rather than a synthetic stand-in (previously always synthetic even when a real cause existed — Frank round-3 P2 @ audio-io.ts:694), so one failed Play never writes more than one row (George round-2 P3); playback-resume-timeout #469 — the single exit's fail-closed report when the 1000 ms bound was what left the context still needing resume; playback-resume-unusable #469 — the same single exit when the context still needs resume without the bound firing: an early rejection, a resume() that resolved but left the context still needing resume, or a fresh interruption arriving during the buffer-fill/yield after resume had already succeeded (George round-2 P2)); src/hooks/use-audio-session.ts playTake's and playBuffer's catches and the dangling-clip branch (playback-take, playback-buffer, playback-dangling, #1213 — each skips the #469 error, whose row playSamples already wrote, and writes nothing for a superseded Play); src/hooks/audio-io.ts playSamples, createLevelTap and checkSharedClockOnReturn (playback-clock-stalled, recorder-tap-clock-stalled, audio-clock-stalled-on-return, #1251 — a shared context reporting running whose currentTime did not advance for 1000 ms: after a Play's source.start, across the level tap's frames during a take, or after the page became visible again; the Play one fails that Play, and playTake/playBuffer's catches skip its error the way they skip the #469 one); src/hooks/audio-io.ts discardSharedContext (playback-context-close, #1213 — a failed close() of the shared context a fail-closed Play dropped) --> What is **not** written
down today is the microphone refusing to start, a Stop that fails the way you
see it — the recorder's own notice that no sound was recorded or that the
recording could not be decoded — and the share sheet failing
at the moment of sending. Those show their own message on screen and leave no
entry behind. <!-- source: src/hooks/use-audio-session.ts — the four console.error sites that report nothing: audio-context resume before Play (take and buffer, two sites — priming calls distinct from playSamples's own raceAudioResume, which now reports under playback-resume/-timeout/-unusable above), record-start, and primeAudioContext on sheet open (NOT stopRecording's backstop catch, which reports under recorder-stop-backstop since #480; a Stop that returns its error in the StopResult never enters that catch — and "Could not finish this recording." is deliberately NOT in this list: both of its sources, the backstop and use-recorder.ts's flush catch (recorder-stop-flush #485), write a row); src/components/recorder.tsx (commit/preview); src/hooks/share-flow.ts:460 — all still end at console.error; gh issue #205 round-2 G2 --> So
when the microphone or the share sheet fails in front of you, **write it down yourself** (§5.2) and do
not assume this report carries it. Routing those to the record is follow-up
work, not something this build does. <!-- source: src/hooks/report-failure.ts:41 -->

1. On the **Books** screen (the first screen), look at the **≡** button in the
   top corner. If something has gone wrong, it carries a small red mark. A
   recording the app stopped and saved at 20 minutes is written in the report
   but does not put the mark there on its own, so open **≡** anyway if a
   translator tells you a long recording stopped by itself. <!-- source: src/components/books-screen.tsx (the mark keys on useMarkedFailureCount, the panel on useFailureCount); src/lib/failure-marker.ts (recorder-take-cap does not light it, #1005) -->
2. Tap **≡**. The problem record appears at the top of this menu only when
   the app has logged a problem — on a phone with no problem logged there
   is no share or bin icon, and that is normal. <!-- source: src/components/failure-log-panel.tsx docblock ("Only mounted while the log is non-empty"); src/components/books-screen.tsx (`failureCount > 0 && <FailureLogPanel>`) --> The menu says how many problems were recorded, and shows two
   buttons. Like everything else in this app they are **pictures, not words**:
   the **share** icon and the **bin** icon. <!-- source: src/components/failure-log-panel.tsx (icon-only Controls; the two Notices carry the only text) -->
3. Tap the **share** icon once — it prepares the report — then tap it again
   when it turns into the highlighted share button. The report goes out as a
   small **text file**, through the phone's normal share sheet — **if it
   opens; see below for what to do on Android if it does not.** Which apps
   that sheet offers has not been checked on a real phone yet, so try
   whatever is there — if it offers saving the file, save it on the phone
   and keep it there. Send it only the way "Where reports go" (below) says,
   once a private address is confirmed — **not** by attaching it to a public
   GitHub issue. Two taps is deliberate, and it is the same two taps as sharing a
   recording. <!-- source: src/hooks/use-failure-log-share.ts (two-gesture share); on the installed app the share goes through src/hooks/share-target.ts:338 `Share.share({ files })` — a file, never plain text; which apps the sheet then lists, and whether it offers save/email at all, is device behaviour and is not device-verified (gh PR #440, George round 6 P2-2; Frank round 10 P2-2) -->
4. Tap the **bin** icon afterwards if you want the mark to go quiet again. It
   asks once to confirm, then empties only this problem record — nothing
   anyone recorded is touched. Send first: the record is the only trace of
   what went wrong, and there is no undo. <!-- source: src/lib/storage/failures.ts clearFailures (clears only the `failures` store); src/components/failure-log-panel.tsx (the bin opens EraseConfirm; onClear runs only on onConfirm) -->

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

1. **Phone make and model** (for example, "Samsung Galaxy A17" or
   "iPhone 13").
2. **Android or iOS version**, if you can find it (Android: Settings → About
   phone; iPhone: Settings → General → About).
3. **The build stamp** — a small line of text at the bottom of the app screen
   reading something like `v1.0.1 · <short code>`. This tells us exactly which
   build was running. <!-- source: src/components/build-stamp.tsx; rendered at the bottom of every screen via src/app/App.tsx -->
4. **What was tapped**, in order, right before the problem.
5. **What happened** — the exact wording of any message on screen. A photo of
   the screen is very helpful.
6. **Whether the recording survived.** After the problem, go back and check:
   is the segment still there, and does it still have audio?

Keep these notes together (paper or a shared note) and pass them along at the
end of each day.

### Where reports go

**Problems are reported on the project's public GitHub issues page,
<https://github.com/unfoldingWord/tc-mobile/issues>** — one issue per
problem, with the notes above. This is the requirements owner's decision of
2026-09-30; an email address may replace it later. <!-- source: gh issue #248, requirements owner (Tim) 2026-09-30: "point testers to the GitHub repository instead of an email address for reporting problems: https://github.com/unfoldingWord/tc-mobile/issues (the repo is public). An email alias can replace it later." This superseded the DRI's 2026-09-28 "Hold until we have an alias" on an email address. -->

- **Filing needs a GitHub account.** A participant without one gives the notes
  to you, and you file them. **Awaiting Tim (requirements owner): whether
  participants file their own reports, or everything goes through the
  facilitator.** <!-- inference about GitHub, not repo evidence: creating an issue requires being signed in; confidence high -->
- **The page is public.** Write what happened and which build; attach a photo
  of the screen only if it shows no personal information. Do **not** attach a
  recording, the app's problem-report file, or anyone's name or phone number.
  Reports are recorded by role (tester, facilitator, developer), never by
  name. <!-- source: PRIVACY.md "Contact" ("Anything posted there is public. Do not include a recording, the problem log or other personal information"); AGENTS.md Conventions, "Tester feedback is tagged by kind and source" -->
- **The problem-report file (§5.1) therefore needs a private route.** The
  repository names no tester channel for it: the privacy policy and the store
  listings give `support@unfoldingword.org` as the public support contact,
  and the DRI's 2026-09-28 note held a tester email alias until one exists.
  **Awaiting Tim (requirements owner): which private address the
  problem-report file goes to.** Until he decides, keep the file on the phone (do
  not tap the bin) and say in the GitHub issue that a report file exists. <!-- source: PRIVACY.md "Contact" (support@unfoldingword.org, listed as the privacy contact); docs/progress_tracker.md 2026-10-02 ("support: GitHub issues plus support@unfoldingword.org" for the store listings); gh issue #248, DRI 2026-09-28 ("Hold until we have an alias") and Tim 2026-09-30 (GitHub for now); src/components/failure-log-panel.tsx (the bin clears the record; there is no undo) -->
