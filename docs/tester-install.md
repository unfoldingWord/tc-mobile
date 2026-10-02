# Installing tC Mobile for testing

Thank you for helping test tC Mobile. This guide walks you through installing
the app on your phone. You do not need to be a developer — just follow the
steps for the kind of phone you have. The current build is **1.0.1**; after
installing, the small build stamp at the bottom of the app's first screen
should start `v1.0.1 ·`. <!-- source: GitHub release v1.0.1 (tag v1.0.1, the newest full release, published 2026-10-02); docs/progress_tracker.md "2026-10-02 ... v1.0.0 and v1.0.1 shipped"; src/components/build-stamp.tsx -->

If anything is unclear or does not work, that is useful to know. See
[If something goes wrong](#if-something-goes-wrong) at the end.

---

## iPhone (TestFlight)

Apple asks testers to install through a free app called **TestFlight**. It is
Apple's normal way to try an app before it is in the App Store.

The app is built for **iPhone**, running **iOS 15.4 or later**. It is not
offered for iPad: as of 1.0.1 the iOS app is iPhone-only, and it has not been
tried on an iPad. <!-- source: ios/App/App.xcodeproj/project.pbxproj TARGETED_DEVICE_FAMILY = 1 (both app-target configurations, #1289, DRI pick 2026-10-01 "iPhone only for now") and IPHONEOS_DEPLOYMENT_TARGET = 15.4; docs/native/system-requirements.md "Platform floors"; PR #1289 "Not verified": iPad compatibility mode was not tried -->

1. **Check your email** for an invitation to test tC Mobile. If you do not see
   it, check your spam folder, or let us know and we will re-send it.
2. **Install TestFlight** (free) from the App Store if you do not already have
   it. Search for "TestFlight", made by Apple.
3. **Open the invitation** from your email and tap **Accept**, then **Install**.
   This installs tC Mobile onto your iPhone. TestFlight shows the app's
   version as `1.0` with a long build number; that is normal — the app's own
   build stamp (below) is the thing to check. <!-- source: docs/native/README.md §4a (MARKETING_VERSION is 1.0, CFBundleVersion is the run's unix timestamp, independent of the web version) -->
4. **Open tC Mobile from your home screen** — tap the tC Mobile icon, not the
   TestFlight app. TestFlight is only there to deliver the app; you use tC
   Mobile itself from the home screen like any other app.
5. **Check the build stamp** at the bottom of the first screen. It should
   start `v1.0.1 ·`. If it shows an older name (for example `v1.0.0-rc.3`),
   open TestFlight and tap **Update** on tC Mobile; if TestFlight offers no
   newer build, tell us rather than deleting the app — **deleting the app
   deletes every recording on it.** <!-- source: docs/native/README.md §4a (a tester whose group is not assigned the new build stays on the old one; happened on 1.0.0-rc.1); docs/training/facilitator-runbook.md §2 (never uninstall to update) -->

---

## Android (download link)

On Android you install tC Mobile from a download link we send you, rather than
from the Play Store. Your phone will ask you to confirm this is okay — that is
normal. The steps below describe the usual path; button names and settings
vary by phone and language. Where a word cannot be relied on, look for the
shape, icon, or position described instead.

The app needs **Android 7.0 (2016) or newer**, with **Android System WebView
kept up to date** (Play Store → Android System WebView → Update) — an older
phone cannot install it. <!-- source: android/variables.gradle minSdkVersion = 24 (Capacitor 8 floor; DRI pick 2026-09-28 on #1017, "Keep Android 7 (Recommended)"); docs/native/system-requirements.md "Platform floors" (the "kept up to date" WebView wording is the standing product wording there; the tree pins no minimum WebView version) -->

1. **Open the download link** we send you in your phone's web browser, or
   scan the QR code we post with it. The durable address is
   <https://github.com/unfoldingWord/tc-mobile/releases/latest> — GitHub
   keeps it pointing at the newest full release — and every build is listed
   at <https://github.com/unfoldingWord/tc-mobile/releases>. Open the newest
   release (marked **Latest**; the earlier release candidates are the ones
   marked **Pre-release**) and tap `app-release.apk`. <!-- source: GitHub release v1.0.1 is the newest full release ("Latest"), with app-release.apk and a QR image attached; the rc builds before it are pre-releases tagged tester-build-v1.0.0-rc.N (docs/native/README.md "Tester announcement template", docs/release/promotion-v1.0.0.md §3a); the older android-release-vX.Y.Z and tester-build-vX.Y.Z tags stay up so shared links work (#629); /releases/latest resolving to the newest non-pre-release is GitHub's behaviour, not this repo's; the repo is public so the asset link needs no login -->
   **Stay with one install route.** If you installed tC Mobile from one of
   these APKs, keep updating from them; do not switch to Google Play, or the
   other way round, without asking us first — switching may need an
   uninstall, and uninstalling deletes your recordings. <!-- source: GitHub release v1.0.1 body ("Stay with one install route"); docs/progress_tracker.md 2026-10-02 (Play Closed testing 1.0.1 exists alongside the APK) -->
2. **Download the file.** It ends in `.apk` — that is the app. **Some
   browsers warn about it, or stop it, before it even finishes downloading** —
   an `.apk` is not a document or a picture, so the browser treats it with
   more caution than most files. You may see a small warning banner or a
   shield-shaped icon in the notification area, asking whether to keep a file
   that "can harm your device." That warning is the browser being cautious
   about any app file; it is not specific to tC Mobile. Look for the button
   that lets the download continue or keeps the file — it is usually not the
   first or most prominent one. **Before you choose it, read the file the
   warning names. Choose it only if that file is `app-release.apk` from the
   releases page in step 1.** If the warning names a different file, or the
   file came from anywhere else, stop. Do not keep it — tell the facilitator
   instead. If the browser removes the
   file outright instead of just warning ("blocked"), the setting that
   controls it may be in the browser or in the phone; tell the facilitator
   rather than guessing which one to change. <!-- source: standard
   Chrome/Android download-warning behaviour for .apk files — this app ships
   no download logic of its own (the file comes straight from GitHub's own
   release-asset link, step 1 above), so nothing in src/ controls this dialog;
   wording, icon and button position vary by browser, browser version and
   phone language; gh issue #248, tester report 2026-09-22, source: tester
   ("I had to tweak several settings to be able to download and then install
   the app... These settings might be hard to find depending on the phone's
   language"; the exact settings were not listed and are not guessed at here) -->
3. **Your phone will warn you** that it does not usually install apps from this
   place. This is expected. If you cannot read the words, look for a button
   that opens a **settings** screen (often shown with a gear icon), and on
   that screen a switch or checkbox next to this browser or file manager's
   name — turn that **on**, then go back to the warning. In English this is
   **Settings** and **Allow from this source**.
4. **Tap Install**, then **Open** when it finishes. These are usually the
   single large button on the screen at each step.
5. **The first time you record, your phone will ask to use the microphone.**
   Allow it — the app needs the microphone to record, and without it
   recording will not work. In English the choice that allows it may say
   **Allow**, **While using the app** or **Only this time**; do not choose
   **Don't allow**. On some older Android versions the button that refuses
   may instead say **Deny** — it means the same thing as **Don't allow**. If
   you will be recording more than once, such as over a training day,
   choose **Allow** or **While using the app** rather than **Only this
   time** if you can: **Only this time** may end once you leave the app, and
   you could be asked to grant the microphone again before a later
   recording. <!-- inference, not repo evidence: how long an "Only this
   time" grant lasts is Android platform behaviour, and this repo has no
   record of testing it per OS version; confidence: medium; gh issue #248,
   PR #870 George round 2 --> The choices may be a list, one under another,
   and the side a button sits on changes with the phone's language, so ask
   the facilitator rather than guessing by position.

If you cannot reach Install, tell the facilitator whether the download stopped
or the downloaded file would not open. Include the phone model, screen
language, and a photo or exact wording of the message — a photo carries across
a language you cannot read. Some phones have extra steps that are not yet
documented here; do not guess which settings to change.

**Updating later:** install the newer `app-release.apk` over the app that is
already there. **Never uninstall first** — uninstalling deletes every
recording on the phone. After updating, close the app fully and open it again
**twice**, then check that the build stamp at the bottom of the screen has
changed. If it still shows the old version, or recordings are missing, stop —
**do not uninstall** — and tell us the stamp and what you saw.
<!-- source: GitHub release v1.0.1 body ("Do not uninstall to update"); gh issue #923 (observed on Android 2026-09-25: uninstall then install lost all data), closed 2026-09-28 with the in-place-update phone check moved to #974; docs/training/facilitator-runbook.md §2 -->

---

## Web browser (no install)

The same app runs in a web browser at **<https://tcmobile.app>**. This is the
route for a phone that cannot take either install above, or for trying the app
on a computer; the phone apps above are the ones we hand out at a training.
<!-- source: docs/progress_tracker.md 2026-10-02 ("tcmobile.app: connected by the DRI as a Custom Domain on the tc-mobile Worker ... serves 1.0.1"); gh issue #1295 -->

- It needs a current browser: Chrome or Edge 111 or later, Firefox 114 or
  later, or Safari 15.4 or later on an iPhone. Adding it to the home screen is
  recommended. <!-- source: vite.config.ts build.target via docs/native/system-requirements.md "Platform floors" and "Web (PWA)"; README.md "Testing on a phone" (add to home screen) -->
- **Recordings made in the browser are stored under the address you opened.**
  If you have used the older address,
  <https://tc-mobile.unfoldingword.workers.dev>, keep using it: it still works
  and is not redirected, and your recordings are only there. Opening
  <https://tcmobile.app> instead starts empty, and the app has no way to move
  recordings between the two. Share anything you want to keep before
  switching. <!-- source: gh issue #1295 ("Keep tc-mobile.unfoldingword.workers.dev serving, with no redirect ... Browser storage is per origin ... tcmobile.app opens empty, and the app has no import"); docs/progress_tracker.md 2026-10-02 "Next" item 3 -->
- **The installed app is separate again.** Recordings you make in the browser
  do not appear in the iPhone or Android app installed on the same phone, and
  recordings made in the installed app do not appear in the browser. If you
  try the app in a browser first and later install it, the installed app
  starts empty — your browser recordings are still in the browser, and the
  only way to carry one across is to Share it from the browser before you
  switch. <!-- source: capacitor.config.ts (webDir "dist", no `server` block: the installed app loads bundled files, not tcmobile.app); per-origin browser storage (gh issue #1295) and no import path (src/lib/storage/persistence.ts); the separation is inferred from those, not observed on a phone; George round 1 P2-3 on PR #1297 -->
- A browser can clear a website's stored data; if that happens, the
  recordings are gone. There is no backup. <!-- source: PRIVACY.md "Deleting your data"; docs/decisions/0005-no-backend-in-phase-1.md -->

---

## What to expect

- **It works offline.** You do not need an internet connection to record. It is
  built to be used in places with little or no signal.
- **Everything stays on your phone.** Your recordings are kept on the device,
  not uploaded anywhere.
- **It will ask to use the microphone** the first time you record. Please tap
  **Allow** — this is the app getting ready to record your voice, and nothing
  more.

---

## If something goes wrong

If the app will not install, will not record, or does anything surprising,
please tell us. The more of this you can include, the faster we can help:

(Facilitators running a training session: see the
[facilitator runbook](training/facilitator-runbook.md) for what to check and
what to write down.)

- **Which phone** you are using, and roughly which model (for example, "iPhone
  13" or "a Samsung Galaxy, a couple of years old").
- **Which build** — the small build stamp at the bottom of the app's first
  screen (for example `v1.0.1 · ` followed by a short code).
- **What you were doing** when it happened (for example, "I tapped record for
  the first time").
- **What you saw** — the exact message if there was one. A **photo** of the
  screen is enormously helpful. If you made a **screen recording**, keep it
  and show it to your facilitator in person; do not post it anywhere — it can
  carry a translator's voice.

**Where to send it:** open a new issue on the project's public GitHub page,
<https://github.com/unfoldingWord/tc-mobile/issues>. If you would rather not
use GitHub, or do not have an account, give the notes to your facilitator or
the person who sent you the app, and they will file it. <!-- source: gh issue #248, requirements owner (Tim) 2026-09-30: "point testers to the GitHub repository instead of an email address for reporting problems ... An email alias can replace it later"; this replaced the DRI's 2026-09-28 "Hold until we have an alias" on an email address -->

**That page is public.** Do not post a recording, a screen recording, the
app's problem-report file, your phone number or other personal details there — describe what
happened in words and attach a photo of the screen if it shows no personal
information. We record every report by role (tester, facilitator, developer),
never by name. <!-- source: PRIVACY.md "Contact" ("Anything posted there is public. Do not include a recording, the problem log or other personal information"); AGENTS.md Conventions, "Tester feedback is tagged by kind and source" (role, never name) -->

Thank you — every report you send makes the app better for the translators
who will use it.
