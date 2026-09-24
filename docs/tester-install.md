# Installing tC Mobile for testing

Thank you for helping test tC Mobile. This guide walks you through installing
the app on your phone or tablet. You do not need to be a developer — just
follow the steps for the kind of device you have.

If anything is unclear or does not work, that is useful to know. See
[If something goes wrong](#if-something-goes-wrong) at the end.

---

## iPhone or iPad (TestFlight)

Apple asks testers to install through a free app called **TestFlight**. It is
Apple's normal way to try an app before it is in the App Store.

1. **Check your email** for an invitation to test tC Mobile. If you do not see
   it, check your spam folder, or let us know and we will re-send it.
2. **Install TestFlight** (free) from the App Store if you do not already have
   it. Search for "TestFlight", made by Apple.
3. **Open the invitation** from your email and tap **Accept**, then **Install**.
   This installs tC Mobile onto your device.
4. **Open tC Mobile from your home screen** — tap the tC Mobile icon, not the
   TestFlight app. TestFlight is only there to deliver the app; you use tC
   Mobile itself from the home screen like any other app.

---

## Android (download link)

On Android you install tC Mobile from a download link we send you, rather than
from the Play Store. Your phone will ask you to confirm this is okay — that is
normal. The steps below describe the usual path; button names and settings
vary by phone and language. Where a word cannot be relied on, look for the
shape, icon, or position described instead.

The app needs **Android 7.0 (2016) or newer** — an older phone cannot install
it. <!-- source: android/variables.gradle minSdkVersion = 24 (Capacitor 8 floor) -->

1. **Open the download link** we send you in your phone's web browser, or
   scan the QR code we post with it. Every tester build is listed at
   <https://github.com/unfoldingWord/tc-mobile/releases> — open the newest
   one marked **Pre-release** and tap `app-release.apk`. <!-- source: each tester build is a pre-release tagged android-release-vX.Y.Z with app-release.apk attached, from android-release-v0.2.3 on; the repo is public so the asset link needs no login -->
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
- **What you were doing** when it happened (for example, "I tapped record for
  the first time").
- **What you saw** — the exact message if there was one. A **photo** of the
  screen, or a **screen recording**, is enormously helpful.

Send this to the maintainer (`<placeholder: support channel>`). Thank you —
every report you send makes the app better for the translators who will use
it.
