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
   This one has no default yet: ask the requirements owner before the session.
4. Which private address the problem-report file goes to (§5, "Where reports go").

<!-- source: PR #1297 body, "For the requirements owner to confirm" items 1-4; no answer to any of them is on gh issue #248 as of 2026-10-05 -->

## 1. Before the training

1. Make sure you have the install link or invitation ready for every phone you
   will set up (see [`tester-install.md`](../tester-install.md) for the exact
   steps — do not retype them here, just follow that guide).
2. Know which kind of build each phone is getting: an Android phone installs
   an APK from a download link; an iPhone installs through TestFlight. <!-- source: docs/tester-install.md, "Android (download link)" and "iPhone (TestFlight)" sections --> The
   Android app needs **Android 7.0 (2016) or newer**, with Android System
   WebView kept up to date — an older phone cannot install it. A phone whose WebView is too old shows a screen with a phone and an up arrow, not the app: update Android System WebView in Google Play. <!-- source: index.html #old-webview-check (#1944); not yet seen on a real WebView 91 --> <!-- source: android/variables.gradle minSdkVersion = 24 (Capacitor 8 floor; DRI pick 2026-09-28 on #1017 "Keep Android 7 (Recommended)"); the WebView wording is docs/native/system-requirements.md "Platform floors" --> The iPhone
   app needs **iOS 15.4 or newer**, and it is an **iPhone app: there is no
   iPad version** as of 1.2.2, and it has not been tried on an iPad. <!-- source: ios/App/App.xcodeproj/project.pbxproj IPHONEOS_DEPLOYMENT_TARGET = 15.4 and TARGETED_DEVICE_FAMILY = 1 (#1289, DRI pick 2026-10-01 "iPhone only for now"); PR #1289 "Not verified" (iPad compatibility mode not tried) --> The
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

   **Bring an external microphone.** The team recommends an external
   noise-cancelling microphone, about US$35, for all training events. It helps
   recordings on low-cost phones: facilitators at an earlier training reported
   that one worked and helped on cheaper phones, whose built-in microphones
   pick up too much background noise. The team has tested one. No model or
   brand is named here, because none has been given. Beyond that, no
   test result is recorded in this file, and whether a given microphone plugs
   into a given phone is not checked here, so try it on one phone before the
   session. <!-- source: gh issue #248, DRI decision 2026-10-27 (https://github.com/unfoldingWord/tc-mobile/issues/248#issuecomment-6441801461: "The team has tested one and we wil be recommending it for all training events going forward.  $35 mic which is relatively inexpensive."); the rationale is the facilitators' report in gh issue #248, comment 2026-10-14 (its "not tested by the development team" is superseded by the decision above) -->

5. **Know which build you are on.** The current tester build is **1.2.2**. The
   same name appears in the small build stamp at the bottom of every screen
   (`v1.2.2 · <short code>`; the short code after the `·` changes with every
   build). Check it on each phone before the session. The plan is to promote the
   1.2 line to production on 2026-11-15, the end of Sprint 6, as a go or no-go
   decision for the DRI. If it goes, 1.2.2 is what production serves; a no-go
   holds it, and the held version is promoted later as the next patch number,
   so ask the maintainer which build the session names. On an iPhone, TestFlight may not yet offer the new build to every
   tester group; if it offers nothing newer and the stamp is not the one named
   for the session (§2 says how to read it), note the phone and tell the
   maintainer rather than reinstalling. A phone whose stamp shows an older
   version is on an old build: update it the way §2 says, over the top, never by
   uninstalling. <!-- source: gh release view tester-build-v1.2.2 (published 2026-10-30); src/components/build-stamp.tsx (`v{__APP_VERSION__} · {__BUILD_SHA__}`); AGENTS.md "Versions and milestones" (1.2 promoted staging -> main at Sprint 6's end, 2026-11-15, a DRI go/no-go; a no-go is promoted later as the next patch on a new release branch); origin/staging is at 1.2.2 (package.json, merge 24b144d7), the same tree as origin/release/v1.2.2; docs/native/README.md §4a (a tester whose group is not assigned the new build stays on the previous one; happened on 1.0.0-rc.1) -->

   **Every phone has the same look.** Open any menu: its top corner shows a
   **✕**. Menus also close by dragging them down, and the screen headers carry
   tappable book and chapter names. A phone whose stamp still shows 1.0.1 or
   older may show **‹**, **≡** or **⋮** there instead; update it over the top
   as above — do not reinstall to change the look, because that deletes every
   recording. <!-- source: gh PR #1363 (deleted the earlier look and the design switch, first in tester-build-v1.1.0); src/components/menu.tsx dismissGlyph (`back ? "back" : "close"`) and its drag to close (#1268); src/components/crumbs.tsx; not device-verified -->

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

   **Keep only the right file.** A browser may warn that an app file can "harm
   your device". Before a participant chooses to keep it, check that the file
   the warning names is `app-release.apk`, or the same name with a number in
   brackets before `.apk` (such as `app-release (1).apk`, which a browser gives
   a second download), and that it came from the releases page. The same names
   from a chat, an email or another tab mean stop: do not keep it. A warning on
   any other file means stop: do not keep it. <!-- source: docs/tester-install.md
   "Android" step 2 (the same guard); gh issue #248, comment 2026-09-24 -->

   **In short:** an Android phone opens `app-release.apk` from the release the
   tester announcement names (for 1.2.2, `tester-build-v1.2.2` on
   <https://github.com/unfoldingWord/tc-mobile/releases>) and taps through the
   "install from this source" warning; an iPhone accepts a TestFlight
   invitation, installs the free TestFlight app, then installs and opens tC
   Mobile through it — from the home screen afterward, not from TestFlight
   itself. **Tester builds are marked Pre-release, so the "latest" address
   <https://github.com/unfoldingWord/tc-mobile/releases/latest> still lands on
   an older full release (1.0.1): use the link in the announcement, and check
   the stamp afterwards.** `tester-install.md` has the full steps; this is only
   the shape of it. <!-- source: docs/tester-install.md "Android (download
   link)" and "iPhone (TestFlight)" sections; gh release list --repo
   unfoldingWord/tc-mobile shows tester-build-v1.2.2 as Pre-release and v1.0.1
   as Latest, and /releases/latest resolving to the newest non-pre-release is
   GitHub's behaviour; docs/native/README.md §5 step 4, §4 -->

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
   --> A fix that stopped an in-place Android update from silently continuing to run the old build (#934) has merged and ships from 1.0.1 on, but it is not confirmed on a phone as of this writing, nor checked on iOS at all. <!--
   source: gh issue #923, comment 2026-09-27 ("the fix is
   in v0.2.13 ... Only the phone check is left: on an Android phone holding
   v0.2.12 recordings, install the v0.2.13 APK over it (don't uninstall),
   relaunch twice, and confirm the footer reads 0.2.13 and every recording
   is still there."); #923 was closed 2026-09-28 under the DRI's rule that a
   finished fix closes with its phone check carried on the #974 sheet, so
   closure is not confirmation; PR #934 merged 2026-09-26 (merge e5218643),
   an ancestor of this branch
   -->

   **Once a phone has updated to a new build, do not put an older build back
   on it.** When the newer build changed how recordings are stored (1.1.0 and
   1.2.0 each did), the recordings stay on the phone but out of reach until a
   build at least as new as the one it last opened is installed over it
   (AGENTS.md, "Confirming a deploy and rolling one back" is the one statement
   of this: "A rollback is not free once a phone has opened a build with a newer
   database schema"). Opening 1.2.2 over any older build — a 1.0.1 store
   phone or a 1.1.x tester phone — is such a change (§3, "What is new in
   1.2"). If the app says "This copy is out of date" and restarting does
   not clear it, do not uninstall, because
   that deletes every recording. Write down the stamp and what you saw, as in
   section 5, and report it. (On Android, the phone itself refuses to install
   an older build over a newer one; see
   [docs/native/README.md](../native/README.md) §5a.) <!-- source: AGENTS.md
   "A rollback is not free once a phone has opened a build with a newer
   database schema"; screen text read from src/lib/strings.ts dbOutOfDate, not seen on a device -->

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
   screen, a version and a short code in the shape `v1.2.2 · <short code>`
   (the short code changes with every build; more in
   [section 5](#5-reporting-a-problem)). If it still shows the old version,
   or recordings are missing, stop: do not uninstall — write down the stamp
   and what you saw, as in section 5, "Write down what the app cannot know".
   An empty problem record there does not mean nothing happened. <!-- source:
   src/components/build-stamp.tsx; rendered on every screen via
   src/app/App.tsx -->

2. **Allow the microphone when asked.** The first time someone taps record,
   the phone will ask for microphone access. Without it, recording will not
   work at all. Read the labels the dialog actually shows and choose by
   these rules (the labels named here are English): if **While using the
   app** is shown, choose it; otherwise, if **Allow** is shown, choose it.
   Do not choose **Only this time** for anyone who will
   record again later, such as over a training day: it may end once the app
   is left, and the phone would ask again at a later recording. **Deny** and
   **Don't allow** both refuse the microphone; do not choose either. Which
   labels appear depends on the phone. If none of these labels is on the
   dialog, for example because the phone is in another language, stop and
   do not guess by position: ask someone who reads that language which
   button allows the microphone. **The wording above
   has not been checked against a real permission dialog on a phone.**
   <!-- inference, not repo evidence: how long an "Only this time" grant lasts
   is Android platform behaviour and has not been tested here; same wording
   as docs/tester-install.md step 5; gh issue #248, comment 2026-09-24 and
   the 2026-10-12 follow-up -->
3. **If the app never asks, or recording fails after allowing it:** open the
   phone's own settings — **Settings → Apps → tC Mobile → Permissions →
   Microphone** — and turn it on. (Standard Android path; wording varies by
   phone.) <!-- source: standard Android Settings path for a per-app permission; not app-specific code, phrasing varies by device --> On the Chrome web version, the same setting is under the
   padlock/"i" icon by the address bar → site settings → Microphone.
4. **A dismissed permission question can look like a real block.** If someone
   closes the microphone question without answering it, the app may show the
   same message it would for an unreadable permission state: "Microphone
   access is needed to record. Allow it when asked — or if you already allowed
   it, check your device settings." Retry first — if the question does not come back, use the
   Settings path in step 3. <!-- source: src/lib/audio/mic-refusal.ts — a dismissed prompt and an unreadable permission state both map to the same indeterminate message; a confirmed device-level block gets its own distinct message (#203, closed) -->
5. **Show them the menu buttons before they need them.** Everything in
   this app is opened by a picture, never a word, and there are two pictures
   that open a menu (plus the gear on the Books screen, below):
   - **⋮** (three dots in a column) — on a book, a chapter, or a segment,
     and in the top corner of the recorder. It opens that one item's own
     actions: rename it, delete it, mark a segment done, and so on. The
     recorder's own **⋮** drawer holds two tiles, **Done** (marks the segment
     finished) and **Reset** (its confirm box reads "Reset segment and start
     over"). There is **no Edit tile** here — Edit is the scissors on the
     recorder's bottom bar (§3). The drawer closes with the **✕** in its top
     corner, like every menu. From 1.1, if the drawer is opened while
     recording, a **Stop** tile (the square) comes first: tapping it closes
     the drawer and ends the take, the same as the Stop button underneath. <!-- source: src/components/recorder-menu.tsx (RecorderMenuTiles: the Stop tile, record mode, only while `recording`; the Done tile in record mode and the Reset tile; its docblock: "Record mode has no Edit tile ... because the recorder screen carries its own edit control"; `hamburger`); src/components/recorder.tsx (onStopTake → onRecordButton); gh issue #369 (DRI pick 2026-10-19); src/components/menu.tsx dismissGlyph (`back ? "back" : "close"`); the rows and the ⋮ closer are v1.0.1's non-O4 branch of recorder-menu.tsx (`dismissIcon="more"`), deleted by gh PR #1363; not device-verified -->

     The tile reads **Done**; the app's storage warnings and these notes say
     "finished" for the same state. <!-- source: src/lib/strings.ts tileFinished ("Done", D17 #949), tileErase ("Reset", #1220), eraseSegment ("Reset segment and start over"), enterEdit ("Edit recording", the scissors), storageLow ("Mark segments finished ..."); src/components/segment-row.tsx; not device-verified; George round 1 P2-1 on PR #1297 -->

   - **≡** (three stacked lines) — only in the top corner of the Books screen.
     It opens the app's menu: About, Templates, and the problem report while
     the problem log holds an entry (§5). No recording is needed for that, and
     clearing the log removes the report. Rename and delete stay on the
     item's **⋮**.
   - **The gear** — also only in the Books header, beside **≡**. It opens
     Settings (§3, "What is new in 1.2"). Settings is no longer in the **≡**
     menu.

   Point this out once, early: a participant who has only ever seen one of
   the glyphs will otherwise tap the wrong one and conclude nothing is
   there. <!-- source: src/components/books-screen.tsx on origin/staging (header: the gear Control, strings.settingsOpen, then the ≡ Control; the global Menu holds FailureLogPanel while the log is non-empty, then the About and Templates tiles; SettingsPanel is its own panel); src/components/menu.tsx (hamburger prop docblock); src/components/recorder.tsx (recorderMenuOpen icon="more", #1225); src/components/books-screen.tsx (bookMenuOpen icon="more"); src/components/segments-screen.tsx (chapterMenuOpen icon="more"); src/components/segment-row.tsx (segmentMenu icon="more"); gh PR #683 (Part of #589), decided by the dev lead 2026-09-23: "please use kebab on objects and hamburger menu for global" (https://github.com/unfoldingWord/tc-mobile/pull/683#issuecomment-5787553352) -->

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
  when there is something to act on. The first two come as a banner with a
  phone icon, the title "Share your work soon" and a **Share your work**
  button that shares every book on the phone as one zip. <!-- source: src/components/storage-pressure-banner.tsx (state 17 banner, strings.storageShareSoon title, strings.shareAll button, #983/#987/#1045); src/components/books-screen.tsx pressureLine; the plain line is v1.0.1's non-O4 branch (the #247 Notice), deleted by gh PR #1363 -->

  **Share your work can refuse.** Before it builds anything it checks that
  the phone has room for the zip, and if not it says "This phone does not
  have room to prepare your work. Mark finished segments, then try again."
  — on the installed app as well as in the browser. If every segment is
  already finished, that line leaves nothing more to mark: **share one
  chapter at a time instead** (§3, "Sharing a chapter"), which does not take
  this check. Remove nothing until that chapter's file has been opened and
  checked at the agreed destination. In a browser on Android
  the button can also fail after building with "Could not share your work.
  Use the tC Mobile app to share it." (§4); share chapter by chapter there. <!-- source: src/hooks/use-library-share.ts (roomForExport checked before the encode; InsufficientStorageError); src/lib/export/book.ts roomForExport and EXPORT_HEADROOM_FACTOR = 2 ("No device reading backs this figure"); src/lib/strings.ts shareAllStorage, shareAllFailedWeb (PR #1339); Share Chapter and Share Book have no roomForExport caller (grep of src/); src/hooks/share-target.ts selectShareRoute ("unsupported" when canShare rejects the file; the native route never consults canShare); not device-verified; George round 1 P2-2 on PR #1297 -->

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
  the left end of the bottom bar ("Reset and record again") resets the
  recording. A small panel asks once more (the eraser there confirms, the back
  arrow cancels). The recorder stays open with the segment empty, ready for
  Record. The eraser is greyed while recording and when the segment has
  nothing saved yet. There is no undo for a reset. Resetting keeps the
  segment, and so does **Reset** in the segment's **⋮** on the chapter screen
  (its confirm box reads "Reset segment and start over", and its button
  "Reset recording"). **Delete** (the bin,
  in the same **⋮**) removes the whole segment. <!-- source: src/components/recorder-toolbars.tsx (rerecord icon="eraser"), src/components/recorder.tsx onRerecord / onConfirmErase (#592), src/components/erase-confirm.tsx (glyph), src/components/segment-row.tsx (Reset and Delete tiles, #1119, #1220); src/lib/strings.ts rerecord and eraseConfirm (one verb, "Reset", #1233); not device-verified -->
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
- **`⋮` and `≡` only open a menu, and the ✕ at the menu's top
  right closes it** — the same on the Books, book, chapter, segment and
  recorder menus and the naming sheets. It can also be closed by dragging the
  bar at its top (or the row with the ✕) down; a short drag lets it spring
  back open. About's licence text keeps a back arrow, because there it goes
  back to the list rather than closing. <!-- source: src/components/menu.tsx (`back` prop docblock, dismissGlyph, drag down to close); src/components/recorder-menu.tsx (hamburger); src/components/sheet-drag.ts; #1268; the ‹, ≡ and ⋮ closers are v1.0.1's (`dismissIcon`), deleted by gh PR #1363; not device-verified -->
- **Sharing a chapter** produces one MP3 file. **Sharing a book** produces a
  zip file of all its chapters. Both go out through the phone's normal share
  sheet (the same menu you'd use to share a photo). Each MP3 is named for the
  book, then the chapter's place in the book and its name, such as "Jonah -
  03 Jonah runs.mp3" for the third chapter, so a book's files sort in the
  book's order, also after a chapter is moved; a chapter with no name of its
  own is "Jonah - 03 Chapter 3.mp3". A book with 100 chapters or more uses
  three digits for all its files ("Psalms - 003 …"). <!-- source: AGENTS.md "Known open items" #5, and docs/decisions/0009-transcode-on-finished.md; src/lib/strings.ts shareFilename (number and name, the requirements owner's R18 pick on gh issue #1233); src/lib/chapter-slot.ts (the place in the book, the DRI's Q2 (a) on gh issue #1272); not device-verified -->
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
   - **Said it all again:** the eraser in the recorder ("Reset and record
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
     item 1: gh issue #595 (DRI pick 2026-09-28, "After training observations (Recommended)": facilitators note who used cut/paste and who re-recorded; the editor-optional decision is made from those notes); strings.ts rerecord = "Reset and record again" and tileErase = "Reset"; the bottom-bar scissors open editing, Cut is the scissors under the waveform, Paste is the arrow onto a line (§3 above; icon-recognition-protocol.md rows 6, 8, 9). Split per George round 1 P2-1 on PR #1314.
     item 2: gh issue #1284 (long names cut off with "…", no way to read them in full; known limit in §4) and gh issue #1272 (a typed chapter "number" becomes the chapter's name while the badge shows its position — the issue labels this inferred from the code).
     item 3: gh issue #249 and ADR 0010 (docs/decisions/0010-icon-recognition.md); gh issue #461 waits on the #249 check (DRI pick 2026-09-28, "Decide after the #249 icon check (Recommended)": if people find controls by the glyph, the button-disc contrast is accepted; if not, a border or a lighter surface ladder is chosen).
     Observation notes are per participant and by role, per AGENTS.md "Tester feedback is tagged by kind and source". -->

## What is new in 1.2 (tester build 1.2.2)

This is what a facilitator meets that 1.0.1 did not have. It follows the
1.2.2 tester release notes, which also say what to check on a phone. **Almost
none of it has been run on a phone.** The one 1.2 phone result on record is the
upgrade check below; everything else here says what the code is written to do,
not what anyone saw. <!-- source: gh release view tester-build-v1.2.2
(published 2026-10-30; "Known limits": "None of this build's changes has been
run on a phone yet"); docs/progress_tracker.md "2026-11-02 (evening) to
2026-11-03 — device session" for the one later result; this section describes
origin/staging (1.2.2), not develop -->

**The first time 1.2.2 opens over an older build — a 1.0.1 store phone or a
1.1.x tester phone — it upgrades the app's stored data.** The progress tracker records one phone
run of this upgrade: an Android phone, from 1.1.0 to 1.2.2, over disposable
data. Its books, chapters, names, Done marks and recordings all survived, and
recording, delete, Done, adding a chapter and Share Chapter worked afterwards.
That is one phone and one starting build. It has not been run on an iPhone, from
1.0.1, or on a phone whose data matters, so the upgrade is still unproven
there. Before updating a phone that matters, share what is on it. After
updating, check that the stamp starts
`v1.2.2`, that every book is there in its old order, and that an older
recording still plays. Do not put an older build back and do not uninstall to
clear a problem: §2 says what to do, and AGENTS.md, "Confirming a deploy and
rolling one back", is the one statement of why. <!-- source: tester-build-v1.2.2
notes; AGENTS.md "A rollback is not free once a phone has opened a build with a
newer database schema" (v1.1.0 moved the schema from 9 to 11 and v1.2.0 from 11
to 14, so 1.0.1 and 1.1.x are both older than 1.2.2's schema; DB_VERSION = 14 in
src/lib/storage/db.ts on origin/staging); docs/progress_tracker.md 2026-11-02
(evening) to 2026-11-03 (#1464, Android only; the iPhone row is open) -->

- **A Settings screen.** A gear in the Books header opens it. It holds the light
  and dark choice, "Always show chapter numbers", and "Even out the volume when
  done". <!-- source: tester-build-v1.2.2 notes, "Settings"; src/lib/strings.ts settingsOpen, settingsChapterNumbers, settingsNormalizeOnFinished -->
- **Even out the volume when done is off until someone turns it on.** With it
  on, marking a segment Done evens out its loudness before the MP3 is made, and
  that cannot be undone for that segment. Nobody has listened to the result on
  a phone. <!-- source: tester-build-v1.2.2 notes, "Changed"; PR #1746 comment 6474144416, DRI pick "Turn it off for 1.2 (Recommended)"; src/lib/settings.ts readStoredNormalizeOnFinished; docs/progress_tracker.md 2026-10-23 to 10-24 "Not run" ("Normalization also owes a listening test") -->
- **Play a whole chapter from its row** on the Books screen. Tap again to
  pause and again to resume. If the chapter's recordings cannot be found, the
  play button's ring turns the warning colour and a screen reader says it did
  not play. Not run on a phone, and the iPhone is where audio start-up rules
  are the likeliest to differ. <!-- source: tester-build-v1.2.2 notes ("Play a whole chapter", "Chapter play says when it can't play"); AGENTS.md "Device testing" on iOS audio contexts -->
- **Export project** is in a book's menu. It shares one zip in the Scripture
  Bundle format, named `<book> - project.zip` with "project" in the app's
  language. It is export only: there is no import, so a project cannot be
  brought back in from the zip. The first time for a book it asks what language
  the recordings are in, with a search by name or code; you choose once and
  every export of that book uses the answer. While a book is being prepared, the
  button shows it is busy. <!-- source: tester-build-v1.2.2 notes ("Export project", "Export waits its turn"); AGENTS.md Known open items 5; src/lib/strings.ts exportProject, exportProjectFilename, languageAskTitle -->
- **A licence question.** Share Chapter and Share Book ask which licence the
  first time a book is shared, and a book's menu has a Licence tile to look at
  or change it later without sharing. "CC BY-SA 4.0" is already selected on the
  question. Ask the maintainer before the session which licence the training
  uses. A book made from a template keeps the template's licence and shows no
  Licence tile. <!-- source: tester-build-v1.2.2 notes ("Licences"); PR #1670, #1703, #1707 (#1455); the "ask the maintainer" line is this file's advice, not a decision -->
- **Templates.** A Templates tile opens a list with Open Bible Stories. Tap
  it, name the book, and the book is made from the template. A name another
  book already has is refused. The list says "Loading the templates." while it
  loads. <!-- source: tester-build-v1.2.2 notes ("Templates", "The Template Library tells you it's loading"); PR #1655, #1633 -->
- **A test template for Titus, in the browser version on staging only.** It is
  test data: nothing recorded in a book made from it is real work, and books
  made from it may not carry over when the real template is released. It is not in the
  Android or iPhone apps and not in production. <!-- source: tester-build-v1.2.2 notes, "A test template: Titus" -->
- **The app follows the phone's language** for eight languages besides English;
  the texts are AI drafts no speaker has read (§4). On an iPhone, the
  microphone permission prompt follows too. Better licence wording in French,
  Spanish and Chinese in 1.2.2 is also a first draft. <!-- source: tester-build-v1.2.2 notes -->
- **Move a chapter, a book or a segment without press-and-hold.** Every
  chapter on the Books screen has a **⋮**; a book's menu and a segment's menu
  have Move up and Move down. Each moves the row one place and is greyed on the
  first or last. In a book made from a template, chapters and segments have
  no Move (and no chapter ⋮), because their order is the template's (#1985, #1969); the segments the template made cannot be deleted either, though one you add yourself can (#1979). On a chapter with many segments the progress dots may look a
  little smaller. <!-- source: tester-build-v1.2.2 notes ("Move a chapter without press-and-hold", "Move up and Move down"); not run on a phone -->
- **Hold a cut-off name to read it whole** on the Books, Segments and recorder
  screens (§4). <!-- source: tester-build-v1.2.2 notes -->
- **If the microphone is refused again after Try again,** the apps show the
  steps to turn it on in the phone's settings; 1.2.2 makes those steps fit a
  small screen. §2 step 3 is still the fallback. <!-- source: tester-build-v1.2.2 notes ("Microphone help") -->
- **Removing a segment's recording says Reset everywhere.** Shared chapter files
  start with the chapter's number ("Jonah - 03 Jonah runs.mp3"), a moved
  chapter takes the number of the place it lands in, and a second book with the
  same name as another is refused. <!-- source: tester-build-v1.2.2 notes ("Changed") -->
- **The recorder stops by itself after a long stretch of exact silence** and
  saves what it captured. This is for a microphone that goes dead without
  telling the app. It reacts only to exact digital silence (every sample zero).
  On at least one Android phone a quiet room reads as exact silence, so since
  1.3.0 it waits for 30 seconds of it, not a few, and then shows a calm notice
  that the recording stopped and what was recorded is saved; the next Record
  clears it (#1972, #1986). Write down any time it stops a recording while
  someone was speaking or pausing (§5, `recorder-capture-stalled`). <!-- source: tester-build-v1.2.2 notes ("Changed"); src/lib/audio/capture-silence.ts (isDigitalSilence: every sample exactly zero; CAPTURE_SILENCE_MS; the no-zeros-in-a-pause assumption is checked by the #1294 device sheet); §5 -->
- **A recording waiting at launch is saved quietly.** If the app closed while a
  recording was waiting to be saved, the next launch saves it, with no screen,
  if its saved copy is intact. It writes one line in the problem record that
  does not light the mark (§5). While a recording is waiting behind an earlier
  save, it is held in memory only, so closing the app in that moment can still
  lose it. <!-- source: tester-build-v1.2.2 notes ("Fixed"); PR #1725, #1683 (#38); not run on a phone -->
- **After an update, Share Book or Export project restarts the app once**
  rather than failing, unless a recording is open or unsaved. §5 lists both
  rows. <!-- source: tester-build-v1.2.2 notes ("Fixed"); src/hooks/stale-chunk-reload.ts -->
- **Many screen-reader names were improved.** No screen reader was run on a
  phone for any of them. <!-- source: tester-build-v1.2.2 notes ("Changed"); docs/progress_tracker.md 2026-10-26 "Not run" -->
- **On Android, About shows a QR code for the Play listing**, so another person
  can scan it. <!-- source: tester-build-v1.2.2 notes -->

## 4. Known limits (as of build 1.2.2)

- **The iPhone app is iPhone-only.** There is no iPad version, and the app
  has not been tried on an iPad. An Android tablet is not something any
  build has been run on either; this file says "phone" throughout because
  phones are what has been tested. <!-- source: ios/App/App.xcodeproj/project.pbxproj TARGETED_DEVICE_FAMILY = 1 (#1289); PR #1289 "Not verified"; docs/progress_tracker.md 2026-10-02 "Not run" ("The iPhone-only build has not been installed on a device") -->
- **Almost nothing new in 1.1 or 1.2 has a phone result.** The 1.2.2 release
  notes say none of that build's changes had been run on a phone when it was
  published. The progress tracker since records one Android upgrade run (1.1.0 to
  1.2.2, §3) and, for 1.1, five iPhone checks the DRI reported as passed (the
  1.1 upgrade, reordering, a new book's cover colour, Record again and Play after
  lock and unlock; phone model and iOS version not recorded). Treat every "not
  confirmed on a phone" note in this file as still open. <!-- source: GitHub
  release tester-build-v1.2.2 notes, "Known limits" ("None of this build's
  changes has been run on a phone yet"); docs/progress_tracker.md "2026-11-02
  (evening) to 2026-11-03 — device session" (#1464, Galaxy A17, Android 16) and
  the "2026-10-15 (day)" entry's "iPhone, TestFlight 1.1 (1791982821)" run; the iOS
  Simulator run of #1251 in the first entry is not a phone and is not counted -->
- **A long name can still be cut off** with "…" in headers and menus. Press and
  hold a cut-off name on the Books, Segments or recorder screen to read it in
  full, and hold the cover or the number badge to move it instead. Short names
  still work best (a book and chapter reference rather than a sentence). <!--
  source: GitHub release tester-build-v1.2.2 notes ("Read a long name in the
  header"; 1.2.0 "Read a cut-off name"); gh issue #1284; not run on a phone -->
- **After a phone alarm goes off during a recording**, the recorder's timer
  and a flat waveform may keep running after the alarm is dismissed, even
  though the saved recording ends where the alarm sounded — the screen says
  "recording" when nothing more is being captured. If an alarm rings, tap
  the square and play the segment back: trust what you hear, not the timer or
  the waveform. Do not Reset. Whether tapping Record afterwards continues the
  saved audio has not been confirmed, so keep the take as it is and report
  the build stamp (§5). One tester report, 2026-10-02, with the phone and
  build not given; not reproduced by us. <!-- source: gh issue #1294, closed 2026-10-23 with a device label; the remaining device rows are on #974 (A1–A4, I5–I8), not yet run per its close comment ("the recording actually ends when the timer went off ... a weird false graphic of time going up"; build, platform and OS version not given; cause inferred, not run); PR #1298 (merged at 38c82e8d: bound the track's mute event; not yet run on a phone, so the on-screen position after an alarm stays unconfirmed); docs/progress_tracker.md 2026-10-02 "Other"; bench George round 3 on PR #1297 -->

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
       Play once. That press is the fresh start. Wait for
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
     session, even when a later press brought the voice back.** The fix
     has not been confirmed on a phone, so that report — with what you noted
     in step 1 and which press or step brought the sound back — is the device
     evidence #1251 is missing. Note the iPhone model and whether headphones
     were connected.

  **If the moving line goes flat while recording,** stop the take with the
  square as usual, then **play that take and confirm you hear the voice
  before anyone records again** on that phone. If you do not hear it, go
  through the steps above. Send the report (§5) either way: the red mark on
  Books **≡** is expected to light for this, and the "capture keeps working"
  claim below is inferred from the code, not seen on a phone. <!-- source: gh issue #1251 (DRI comment 2026-09-30); src/hooks/audio-io.ts playSamples (clock check after source.start, "playback-clock-stalled", then discardSharedContext so the next Play builds a fresh context in its tap), checkSharedClockOnReturn (runs on the page becoming visible; writes "audio-clock-stalled-on-return"), src/hooks/use-audio-session.ts onVisibilityChange; src/lib/failure-marker.ts lightsFailureMarker (these three are in none of its exempt sets, so they light the ≡ mark); "Could not play this recording." is src/lib/strings.ts playbackFailed; the shared context is what decoding a captured take uses (src/hooks/audio-io.ts decodeAudioData via getAudioContext), and the live meter reads it too (createLevelTap), so a stalled clock can leave the waveform flat while the capture itself keeps working — that capture claim is inferred from the code, not observed; the swipe-away workaround is from the tester's report in #1251 and has not been confirmed by us on a device; not device-verified; the order — second Play before the restart — is George round 1 on PR #1306: the restart-first order made the "report the first recovered Play" ask below impossible to follow, because the second Play was never pressed; George round 2 on PR #1306 added step 1 (a second press clears the message: `claimFloor` sets `playbackError` to null, src/hooks/use-audio-session.ts), the stop-first rule (a press on a segment already marked playing is the toggle-off, src/hooks/use-audio-session.ts playTake/playBuffer, and does not build a new context), the "only after the message" limit (src/hooks/audio-io.ts playSamples discards the context and throws on two exits — the "stalled" clock verdict, and the resume fail-closed gate, whose `unusableError` makes the `finally` discard it — and the caller paints the same message for both; a silent "not-running" context returns a live handle and shows no message) and the step-2 split by screen is George round 3 on PR #1306: a Play that is still trying shows the pause glyph before any message (src/hooks/use-audio-session.ts playBuffer sets playingBuffer before its awaits), a press on it only stops (recorder.tsx's playingBuffer branch → stopAll, which bumps the session generation, src/lib/audio/session.ts, so watchClock resolves "skipped" and nothing is discarded, src/hooks/audio-io.ts), and the fresh context is built only by the press AFTER the message is painted; the two no-message exits to step 3 (a press that never paints the message, and the Play-glyph-with-no-message case) are bench George round 4 on PR #1306: a "not-running" clock verdict returns without throwing (src/hooks/audio-io.ts watchClock, and playSamples returns unless the verdict is "stalled"), so a silent press need not ever show the message; the flat-line paragraph (src/hooks/audio-io.ts createLevelTap writes "recorder-tap-clock-stalled" and keeps pushing frames, so the scope does not freeze and nothing in the Play steps would be triggered) --> <!-- source: gh issue #1251 is open and its fix is marked not device-verified in the comment above; the ask to report the first recovered Play is George's Low on PR #1279, batched in gh issue #1278 ("asking for it would give the device evidence #1251 still lacks") -->

  What rc.2 phones saw: after connecting Bluetooth headphones, and sometimes
  after coming back from the lock screen, the Play button failed or did
  nothing, and the moving line that shows the voice while recording stayed
  flat. The recording should still be saved. **A fix shipped in rc.3 and is in
  1.2.2, but it is not confirmed on a phone.** 1.2.0 also changed how playback
  treats the iPhone silent switch; that is not confirmed on a phone either.
  What a person may still see: <!-- source: GitHub release v1.0.1 body, "Known
  limits in 1.0.1" ("Not yet confirmed on a phone: the rc.3 recovery of Play and
  the live waveform after locking an iPhone (#1251), including with the silent
  switch on"); GitHub release tester-build-v1.2.2 notes ("On iPhone, the silent
  switch should no longer mute playback. Please try ... " and "None of this
  build's changes has been run on a phone yet") -->
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
- **Eight languages besides English are unchecked AI drafts.** The app opens
  in the phone's language for Spanish, French, Portuguese, Indonesian, Swahili,
  Hindi, Russian and Simplified Chinese, and there is no language switch inside
  the app. No speaker of those languages has read the app text, so expect
  wording that reads oddly and write it down. Any other phone language shows
  English. Names people type can be in any script. <!-- source: GitHub release
  tester-build-v1.2.2 notes, "Also new since 1.1.0" ("drafted by AI and not yet
  read by a speaker of each language ... no language switch inside the app; it
  follows the phone"); gh issue #169 (closed 2026-10-29); PR #1270 (typed names set their own text
  direction) is part of #1267 (closed 2026-10-08; not run on a device with an RTL name), so no further right-to-left
  claim is made here -->
- **Share Book and Share your work in the browser version on Android** can
  fail after the file is built: Share Book says "Could not share this book.
  Sharing a book works in the tC Mobile app." and the storage banner's Share
  your work says "Could not share your work. Use the tC Mobile app to share
  it." Both hand over a zip, which Chrome on Android is read as not
  accepting for sharing (the project's reading, not re-run on a phone); a
  chapter is a plain MP3 and is not affected, so share chapter by chapter
  there. The installed Android app sends a share by
  a different route, and this failure has not been reported from it. <!-- source: gh issue #272, closed 2026-10-23 with a device label; the remaining device checks are on #974 (A12, A13, A15) (moved to v1.0.0 as the Chrome-on-Android PWA path; the APK routes shares through the Capacitor Share plugin and never reaches the Web Share gate, per the 2026-09-16 comment); src/hooks/share-target.ts selectShareRoute docblock ("Android Chrome's Web Share allowlist rejects application/zip (#272)" — the project's claim, not re-run here); src/hooks/use-library-share.ts and src/hooks/use-book-share.ts (both "application/zip"); src/hooks/use-chapter-share.ts ("audio/mpeg"); src/lib/strings.ts shareBookFailedWeb (PR #1332), shareAllFailedWeb (PR #1339); GitHub release v1.0.1 body lists #272 among the known limits; George round 1 P2-2 on PR #1297 -->
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

**Read "some" literally — this is the part to get right.** The lists below
follow AGENTS.md, "Errors have a channel before they have copy", which is the
engineering list. If the two ever differ, AGENTS.md is right and this is
stale. The code in brackets is what shows in the exported file. <!-- source:
AGENTS.md "Errors have a channel before they have copy"; src/lib/failure-marker.ts
(lightsFailureMarker); the extra load rows named below were found by reading
src/hooks (use-books.ts, use-chapter-segments.ts, use-recorder-segment.ts,
use-template-library.ts, replay-pending-takes.ts), not by running anything -->

**Written down, and puts the red mark on Books ≡:**

- The app crashing or reloading itself, and a problem nobody caught
  (`uncaught-error`, `unhandled-rejection`, `render`).
- Making an MP3 or converting a finished recording failing (`encoder-health`,
  `encoder-recover`, `transcode-sweep`, `transcode-segment`).
- Sharing: a share that failed while being prepared (`share-prepare`) or at the
  moment of sending (`share-send`), a share's temporary file that could not be
  deleted afterwards (`share-spool-release`), and a book's Export project
  bundle that failed (`book-export-bundle`).
- A recording that fails to save (`save-take`). A recording waiting to be saved
  whose hold could not be written or deleted, or was refused
  (`pending-take-write`, `pending-take-delete`, `pending-take-refused`).
- A failed delete of a book (`book-delete`), a failed Reset (`erase-segment`),
  segment rename (`segment-rename`), segment delete (`segment-delete`), chapter,
  book or segment move (`chapter-reorder`, `book-reorder`, `segment-reorder`),
  book colour (`book-cover-colour`), the Export project language question
  (`book-language`, `language-list`) and a licence save (`book-licence`).
- The recorder: a recording that failed to start for a reason other than a
  refusal (`recorder-start`); a microphone that is missing, busy or failing
  (`recorder-mic-start`); the level meter failing to open (`recorder-tap-open`);
  an interruption (a call, another app taking the microphone) that finds the
  recorder still running (`recorder-interrupted-active`); the microphone
  wake-up at Record that failed or took longer than a second
  (`recorder-start-resume`, `recorder-start-resume-timeout`); a Stop or a Back
  whose teardown threw (`recorder-cancel-stop`, `recorder-stop-flush`,
  `recorder-release-track`, `recorder-tap-clone-stop`, `recorder-stop-backstop`);
  the recording sheet failing to save or close (`recorder-commit-stop`,
  `recorder-commit-close`, `recorder-close-tail`, `recorder-close-rejected`); a
  recovered recording that could not be saved or shared
  (`recorder-recovered-save`, `recorder-recovered-share`); a Back that found
  nothing to close (`recorder-back-no-handle`); and a recording the app stopped
  by itself after a long stretch of exact digital silence, shown as
  `recorder-capture-stalled`. That row is written when the app stops the
  recording, before it saves what it captured. If the save then fails, the
  save-failed screen in "If a recording will not save" appears and writes a row
  of its own.
- Playback: Play refusing to start because the app's sound engine would not
  wake or stayed unusable (`playback-resume`, `playback-resume-timeout`,
  `playback-resume-unusable`, `playback-context-close`); Play failing for any
  other reason, including a recording that could not be loaded or decoded or
  that has nothing saved (`playback-take`, `playback-buffer`,
  `playback-dangling`); the wake-up inside a Play tap being refused
  (`playback-tap-resume`); and a chapter play that failed (`chapter-play`). The
  sound engine looking switched on while its clock had stopped is written as
  `playback-clock-stalled` (Play started but no sound followed),
  `recorder-tap-clock-stalled` (during a recording) or
  `audio-clock-stalled-on-return` (when the app came back to the screen).
- A part of the app that would not load after an update and could not reload
  (`stale-chunk`): the app had already reloaded once for this build, or a
  recording was open or unsaved.
- A licence text in About that failed to load (`about-licence-text`), and the
  tester-only phone check's own failures (`phone-check`).
- Screens that would not load: the books list, a chapter, a recording opened
  from a segment, or a template (`books-load`, `chapter-load`,
  `recorder-segment-load`, `recorder-segment-reload`, `template-load`,
  `template-create`), and a waiting recording the launch could not read
  (`pending-take-read`).
- Other screens and background work, listed in AGENTS.md and present in the
  1.2.2 code: creating, adding a chapter to, or renaming a book
  (`books-create`, `books-add-chapter`, `books-rename`); adding a segment,
  renaming a chapter, or marking a chapter finished (`chapter-add-segment`,
  `chapter-rename`, `chapter-set-finished`); the Android Back button failing to
  attach or act (`native-back-handler`, `native-back-exit`,
  `native-back-remove`, `native-back-listener`); the installed app failing to
  clear the web app's old service worker or its caches
  (`native-sw-unregister`, `native-sw-cache-cleanup`); a storage-space listener
  that threw (`storage-pressure-bump`); a light or dark choice or other setting
  that could not be saved (`use-theme: persist`, `use-settings: persist`); the
  problem report's own share and clear (`failure-log-share-prepare`,
  `failure-log-share-send`, `failure-log-clear`); and the background
  conversion failing to record that it stalled (`transcode-stall-accounting`).

**Written down, but does not put the red mark on ≡:**

- A recording sealed at the 20-minute cap (`recorder-take-cap`). Not a failure:
  the one record that a recording was cut. Like the silence row above, it is
  written before the save.
- A waiting recording that the app saved by itself the next time it opened
  (`pending-take-replayed`). Not a problem: it lets a tester tell a waiting
  recording existed and was saved. A reopen with nothing waiting writes
  nothing.
- The app reloading itself once after an update (`stale-chunk-reload`).
- The microphone being refused (`recorder-mic-refused`): the screen already says
  what to do and Record asks again.
- A Done mark the app could not save (`recorder-finished-flag`), a waveform edit
  it could not apply (`recorder-edit-apply`): the screen says so and the
  recording is untouched.
- The sound engine failing to wake on a routine step: coming back to the
  front mid-recording (`recorder-foreground-resume`), Try again on a recording
  that would not open (`recorder-decode-retry-resume`, `recorder-segment-resume-retry`),
  a sheet opening (`sheet-open-resume`) and a Play on a recording
  (`playback-buffer-tap-resume`). This can happen routinely on an iPhone, so it
  is logged only.
- A book's menu that could not read whether the book came from a template
  (`book-provenance-read`): the Licence tile stays hidden and the next open reads
  again.
- The phone's top and bottom bars not taking the light or dark look
  (`system-bars-style`, installed apps only): written once per page; the bars
  keep their previous look and nothing is lost.

<!-- source: src/lib/failure-marker.ts (INFORMATIONAL_CONTEXTS, ROUTINE_RECOVERABLE_CONTEXTS, RESUME_CONTEXTS: everything not in those sets lights the mark); the DRI's picks "Log it, don't light ≡ (Recommended)" (#1076), "Log only, no ≡ (Recommended)" (https://github.com/unfoldingWord/tc-mobile/pull/1692#issuecomment-6421765458) and "A: one text round + log row (Recommended)" (https://github.com/unfoldingWord/tc-mobile/pull/1706#issuecomment-6425490363); the silence stop is the requirements owner's R13 decision on gh issue #1294; inferred from the code, not run on a phone -->

**What is not written down today:** a Stop that fails the way you see it (the
recorder's own notice that no sound was recorded or that the recording could not
be decoded), and the recorder's "This device cannot record audio." line when the phone
cannot record at all. Each shows its own message on screen and leaves no entry
behind. So when a Stop fails in front of you, **write it down yourself**
(§5.2) and do not assume this report carries it. <!-- source: AGENTS.md "What is
still never written down is the recorder sheet's own Stop notice (captureFailureText ...)"; src/components/recorder.tsx captureFailureText calls neither console.error nor reportFailure -->

1. On the **Books** screen (the first screen), look at the **≡** button in the
   top corner. If something has gone wrong, it carries a small red mark. A
   recording the app stopped and saved at 20 minutes is written in the report
   but does not put the mark there on its own, so open **≡** anyway if a
   translator tells you a long recording stopped by itself. The same goes
   for a recording the app saved by itself on reopening. <!-- source: src/components/books-screen.tsx (the mark keys on useMarkedFailureCount, the panel on useFailureCount); src/lib/failure-marker.ts (recorder-take-cap, #1005, and pending-take-replayed, #38, do not light it) -->
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
   reading something like `v1.2.2 · <short code>`. This tells us exactly which
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
