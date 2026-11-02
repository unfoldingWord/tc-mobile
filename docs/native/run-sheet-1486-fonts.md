# Run sheet: device font check, the 10 languages plus Vietnamese, on Android (#1486)

This is the Android half of #1486, written for a Claude Code session driving a
phone over adb with the DRI beside it, in the same shape as the card-spike run
sheet (`docs/native/card-spike-sheet.md` on `spike/card-store`, #1472). **The
iPhone half stays open.** An Android pass does not close #1486, whose
acceptance criterion is a tracker table with at least one low-end Android phone
and one iPhone, and any phone not run marked unverified.

**Nothing below has been run on a device.** Every results cell starts empty.
Anything marked **ASSUMPTION** is the author's reading, not something observed.
Where a step says **HUMAN**, stop and ask the DRI to do it with their hands and
wait for the answer. Do not guess a result; write `cannot-tell` with the reason.

## What this answers

The app ships no `@font-face`; `--p-font-ui` is `system-ui, ...`
(`src/app/styles/1-primitives.css`, as #1486 cites it). So whether a script
draws as text or as boxes ("tofu") is the phone's own fonts talking. The
decision this feeds is which font strategy the fonts issue picks, and whether
the Capacitor Device plugin is needed for language (the `navigator.language`
and `navigator.languages` capture). The level-3 scripts (Ethiopic, Myanmar,
Lao, Nastaliq) are the likelier tofu; that is inference from #1486, not
observed.

The instrument is the **Script samples** section of the tester-only Phone check
(`src/lib/phone-check/font-samples.ts`, PR #1662), which is in
`tester-build-v1.2.2` (checked with `git ls-tree -r tester-build-v1.2.2`). It
lists these lines, each with its own `lang` and `dir`:

| id         | Label                | lang      | dir |
| ---------- | -------------------- | --------- | --- |
| latin      | Latin with accents   | `fr`      | ltr |
| arabic     | Arabic               | `ar`      | rtl |
| devanagari | Devanagari           | `hi`      | ltr |
| han        | Han (Simplified)     | `zh-Hans` | ltr |
| cyrillic   | Cyrillic             | `ru`      | ltr |
| ethiopic   | Ethiopic             | `am`      | ltr |
| bengali    | Bengali              | `bn`      | ltr |
| myanmar    | Myanmar              | `my`      | ltr |
| lao        | Lao                  | `lo`      | ltr |
| thai       | Thai                 | `th`      | ltr |
| urdu       | Urdu (Arabic script) | `ur`      | rtl |

plus three digit lines (Latin `0123456789`, Arabic-Indic, Devanagari), and the
report gains `navigator.language`, `navigator.languages` and one fill-in line
per sample. The app's supported UI languages (`LOCALES` in `src/lib/locale.ts`
on `develop`) are `ar`, `en`, `es`, `fr`, `hi`, `id`, `pt`, `ru`, `sw`, `vi`,
`zh-Hans`: eleven, of which `vi` (Vietnamese, #1830, merged 2026-11-02) is the
newest.

**Vietnamese is not a line in the samples.** It is Latin script, so the
`latin` line (French accents) does not test its stacked tone marks (for example
`ệ ữ ặ ổ`). Also, `vi.ts` is **not** in `tester-build-v1.2.2` (checked with
`git ls-tree -r tester-build-v1.2.2 | grep i18n/vi.ts`, empty), so no published
tester APK shows Vietnamese UI text. This sheet covers Vietnamese with a
fixture page (step F3) and flags the in-app Vietnamese UI check as open until a
tester build that contains #1830 exists.

## Prerequisites

Run each check and paste its output into the notes.

1. **Tools.** `adb version`, `gh --version`, `python3 --version`, `sha256sum`.
2. **Phone connected.** `adb devices -l` lists exactly one device in state
   `device` (`unauthorized` means the DRI accepts the prompt, **HUMAN**). If
   more than one, pass `-s <serial>` to each adb command. Serial stays in local
   notes only.
3. **Phone facts.** `adb shell getprop ro.product.manufacturer`,
   `ro.product.model`, `ro.build.version.release`, `ro.build.version.sdk`.
   Whether the phone is low-end: `adb shell getprop ro.config.low_ram`,
   `adb shell pm list features | grep -i ram.low` (Go edition phones report
   `android.hardware.ram.low`; **ASSUMPTION** that is the right flag on this
   phone) and `adb shell grep MemTotal /proc/meminfo`. The issue wants a
   low-end phone (Go edition if available); record what this one is and say so
   if it is not low-end.
4. **WebView version.** `adb shell pm list packages | grep -i webview`, then
   `adb shell dumpsys package <that package> | grep versionName`. The system
   WebView draws the app's text; its version belongs in the header.
5. **Installed fonts on the phone (extra evidence).** `adb shell ls /system/fonts | head -100`.
   Note any `Noto*` files that match the scripts (for example `NotoSansEthiopic`,
   `NotoSansMyanmar`, `NotoSansLao`, `NotoNastaliqUrdu`). **ASSUMPTION:** the
   file names vary by vendor and Android version; the list is context, not a
   verdict. The verdict is what the screen shows.
6. **The app.** `adb shell dumpsys package org.unfoldingword.tcmobile | grep versionName`.
   If it is not installed, install tester-build-v1.2.2 (a clean phone, or a
   phone the DRI says has no recordings that matter):

   ```
   mkdir -p /tmp/run-1486
   gh release download tester-build-v1.2.2 --repo unfoldingWord/tc-mobile --pattern app-release.apk --dir /tmp/run-1486
   sha256sum /tmp/run-1486/app-release.apk
   # expect 5092fcfea1163eb80853f95d671dfc38a654876c0ccf9f78d7ec1889a0955744 (from the release notes)
   ```

   A mismatch means stop; do not install. Only after the hash matches:
   `adb install -r /tmp/run-1486/app-release.apk`.

   If an ordinary tester build is already installed and its `versionName` is
   1.2.2 or higher, use it as is. If it is lower than 1.2.2 and holds
   recordings, **do not install over it** without the safe-copy steps in
   `docs/native/run-sheet-1464-upgrade.md`, because 1.2.2 raises the database
   version (one-way). Never uninstall (uninstalling deletes recordings). Never
   use `adb install -d`.

## Capturing output

```
mkdir -p /tmp/run-1486
adb logcat -c
adb logcat -v threadtime -e 'Capacitor|tcmobile|AndroidRuntime|FATAL|chromium' > /tmp/run-1486/logcat-all.txt &
grep -E 'AndroidRuntime|FATAL' /tmp/run-1486/logcat-all.txt
```

The capture keeps only lines matching those tags, which can still include other
apps' lines. Keep `logcat-all.txt` local and never attach or paste it; quote only the filtered lines a result needs. **ASSUMPTION:** this phone's `logcat` supports `-e`; if it refuses the flag, say so in the notes and capture without it, kept local.

Screenshots: `adb exec-out screencap -p > /tmp/run-1486/<name>.png`. A screenshot
is the only honest record of tofu, so take one per screen and open each image
before keeping it: the phone's status bar or notifications can show a name,
a place or a carrier. Delete or retake any image that does. The phone's own
language list can be redacted from the notes if it names a region.

## Steps

Mark each cell `rendered`, `tofu`, `partial` (some glyphs boxed or a mark
misplaced), `cannot-tell` or `n/a`. A script line that shows readable text in
the right direction is `rendered`. Boxes, question marks, or blank gaps are
`tofu`. A shaping failure (Arabic letters unjoined, Devanagari marks detached,
Myanmar or Lao marks stacked wrongly, Nastaliq drawn in a plain Naskh style)
is `partial` with a note; **ASSUMPTION:** the DRI cannot read every script, so
judge shape, not meaning, and mark `cannot-tell` on any doubt.

### F1 The Phone check, in the phone's own language

1. **HUMAN:** open the app. On the Books screen, tap the version line at the
   bottom (`v1.2.2 · abcdef0`) **5 times within 3 seconds** (the gesture #974
   gives). The Phone check opens.
2. **HUMAN:** tap **Start** and wait for "Done." Start is required before any
   capture. Read from the code (`src/hooks/use-phone-check.ts`): opening the
   screen only restores the last saved results, or nothing; only a Start run
   calls `readDeviceInfo`, and the report writes "not run" for device data that
   is null. So `navigator.language` and `navigator.languages` in the report are
   either from this Start or are stale values saved by an earlier one. Start
   never touches books or recordings (the screen says so).
3. Scroll to **Script samples**. Take a screenshot. Fill the first table from
   what the phone draws: one cell per sample, plus the digit lines. (The
   samples draw without Start; only the language values need it.)
4. The separate **Start memory test** is not part of this run; leave it unless
   the DRI asks. It can restart the app.
5. Copy the report: tap **Copy report**. **HUMAN** pastes it into a place the
   session can read (for example the session chat). The report carries
   `navigator.language`, `navigator.languages` and one empty line per sample.
   Fill each line with `rendered`, `tofu` or `partial` to match the table. If
   the language lines say "not run" or are missing, Start did not complete;
   run it again before concluding anything. A report that still lacks them
   after a completed Start is a finding to record, not proof of the wrong build
   (check the build stamp for that).

### F2 `navigator.language` after the phone's language changes

The issue also asks what the phone reports after its language is changed,
because that feeds the native-language decision.

1. Record the starting report's `navigator.language` and `navigator.languages`
   (F1).
2. **HUMAN:** Settings > System > Languages (the path varies by vendor;
   **ASSUMPTION**), add a second language, for example Hindi, and move it to
   the top. Reopen the app, tap the version line 5 times, tap **Start** and
   wait for "Done." (a fresh measurement; without it the report shows the values
   saved by the earlier Start), scroll to Script samples, **Copy report**, and
   compare. Does the phone check text change?
   (It is English-only by design, S11, so it should not.) Does the rest of
   the app switch to that language? Take screenshots.
3. Repeat for two more languages the DRI picks from the app's supported list
   (for example Arabic for right-to-left, and Chinese for Han). Android 13 and
   later also has per-app language in Settings > Apps > tC Mobile > Language
   (**ASSUMPTION** it is present on this phone); record whether it exists and
   whether `navigator.languages` follows it.
4. Put the phone's language back to the DRI's own when done (**HUMAN**).

For each language, record the whole `navigator.languages` array, not only the
first entry. The app resolves the UI language by walking that list
(`src/lib/i18n/resolve.ts`), so a regional tag such as `pt-BR` or `zh-Hans-CN`
is expected to reach the base language (inference from that file's docblock).

### F3 Vietnamese and the full set on a fixture page (no app build needed)

This tests the phone's fonts for the scripts and for Vietnamese's stacked marks
without any build. It does **not** show the app's Vietnamese UI (see the open
item). The fixture lives in scratch, is never committed, and is served from the
machine to the phone over adb.

```
mkdir -p /tmp/run-1486/fixture
cat > /tmp/run-1486/fixture/index.html <<'EOF'
<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>font samples</title>
<body style="font-family:system-ui,sans-serif;font-size:20px;line-height:1.6;padding:12px">
<p lang="vi">Vietnamese: ệ ữ ặ ổ ề ợ ẳ ỹ Ư ơ Đ đ — Dịch Kinh Thánh bằng lời nói</p>
<p lang="fr">French: Traduction orale de la Bible : é è ç à ñ ã ũ</p>
<p lang="ar" dir="rtl">Arabic: ترجمة الكتاب المقدس الشفهية</p>
<p lang="hi">Devanagari: बाइबल का मौखिक अनुवाद</p>
<p lang="zh-Hans">Han: 圣经口头翻译</p>
<p lang="ru">Cyrillic: Устный перевод Библии</p>
<p lang="am">Ethiopic: የመጽሐፍ ቅዱስ የቃል ትርጉም</p>
<p lang="bn">Bengali: বাইবেলের মৌখিক অনুবাদ</p>
<p lang="my">Myanmar: သမ္မာကျမ်းစာ နှုတ်ဖြင့် ဘာသာပြန်ခြင်း</p>
<p lang="lo">Lao: ການແປພຣະຄຳພີດ້ວຍປາກເປົ່າ</p>
<p lang="th">Thai: การแปลพระคัมภีร์ด้วยวาจา</p>
<p lang="ur" dir="rtl">Urdu: بائبل کا زبانی ترجمہ</p>
<p>Digits: 0123456789 / <span lang="ar">٠١٢٣٤٥٦٧٨٩</span> / <span lang="hi">०१२३४५६७८९</span></p>
EOF
cd /tmp/run-1486/fixture && python3 -m http.server 8000 --bind 127.0.0.1 &
adb reverse tcp:8000 tcp:8000
adb shell am start -a android.intent.action.VIEW -d http://localhost:8000/
```

The samples are the same strings as `font-samples.ts` (the sample text is copied
from that file; check them against it with `git diff --no-index` or by eye if a
character looks off) plus one Vietnamese line. Vietnamese sentence wording is
this sheet's, only to give real words; judge the marks, not the meaning
(**ASSUMPTION** the wording is idiomatic; it was not checked by a speaker).

The page opens in the phone's default browser (**HUMAN** if it asks which
browser to use; Chrome is the one wanted). `localhost` through `adb reverse` is
a secure context and needs no network. **ASSUMPTION:** Chrome and the app's
WebView share the phone's system fonts, so a Chrome result predicts the app's;
the app's own Script samples section (F1) is what counts if they differ. Take
a screenshot per scroll position. For the Vietnamese line, mark `rendered` only
if every mark sits on its vowel (no boxes, no separated floating marks).

Stop the server afterwards: bring it to the foreground in its shell and stop
it, or `kill` its job; then `adb reverse --remove tcp:8000`.

### F4 In-app Vietnamese (and every other UI language) text

The question is whether each language's UI text draws, not only the sample
lines. This needs a build with the language's table:

- the nine other languages are in `tester-build-v1.2.2`: with the phone set to
  each (F2), read the Books screen and the recorder screen and mark rendered,
  tofu or partial. **ASSUMPTION:** a language whose table is incomplete is
  skipped and the app shows English (ADR 0015 (g), as `resolve.ts` describes);
  if the screen stays English, record that, not tofu.
- Vietnamese is **not** in 1.2.2. Mark F4 `vi` as `n/a: no tester build with
vi.ts yet`. When the next tester build (planned v1.3.0 at sprint end) exists,
  repeat F2 and F4 for `vi` on an updated phone. Do not build a debug APK and
  install it over a release-signed app: the signature mismatch would force an
  uninstall.

## Results

Header per phone: model, Android release and sdk, low-end flag and RAM,
WebView version, build, date. One row per script; fill `rendered`, `tofu`,
`partial`, `cannot-tell` or `n/a`, with the screenshot name.

| Script (lang)            | In the app's Script samples (F1) | Fixture page (F3) | Notes |
| ------------------------ | -------------------------------- | ----------------- | ----- |
| Latin with accents (fr)  |                                  |                   |       |
| Vietnamese (vi)          | n/a: not in the app section      |                   |       |
| Arabic (ar)              |                                  |                   |       |
| Devanagari (hi)          |                                  |                   |       |
| Han Simplified (zh-Hans) |                                  |                   |       |
| Cyrillic (ru)            |                                  |                   |       |
| Ethiopic (am)            |                                  |                   |       |
| Bengali (bn)             |                                  |                   |       |
| Myanmar (my)             |                                  |                   |       |
| Lao (lo)                 |                                  |                   |       |
| Thai (th)                |                                  |                   |       |
| Urdu, Arabic script (ur) |                                  |                   |       |
| Digits, Latin            |                                  |                   |       |
| Digits, Arabic-Indic     |                                  |                   |       |
| Digits, Devanagari       |                                  |                   |       |

Language capture (F2):

| Phone language set to | `navigator.language` | `navigator.languages` | App UI language changed? | Per-app language present? |
| --------------------- | -------------------- | --------------------- | ------------------------ | ------------------------- |
| (starting)            |                      |                       |                          |                           |
|                       |                      |                       |                          |                           |
|                       |                      |                       |                          |                           |
|                       |                      |                       |                          |                           |

In-app UI text (F4), one row per language: `ar`, `es`, `fr`, `hi`, `id`, `pt`,
`ru`, `sw`, `zh-Hans`, then `vi` (expected `n/a` until a build with #1830
exists).

| Language | Books screen draws? | Recorder screen draws? | Notes |
| -------- | ------------------- | ---------------------- | ----- |
|          |                     |                        |       |

**Open, to be marked in the tracker as unverified:** iPhone (all rows);
any Android phone not run; `vi` in the app UI.

## Safety and stop rules

- Read-only on the phone's data: nothing here writes books or recordings. The
  Phone check's Start step "never touches the app's books or recordings", per
  its own screen. The only changes to the phone are the phone's language
  setting (put it back), the app install if needed, and one temporary
  `adb reverse`.
- **Never** run `adb uninstall`, `pm clear`, "Clear storage" or "Clear data",
  a factory reset, or `adb install -d`. Uninstalling deletes recordings.
- Do not tap the Phone check's **Start memory test** unless the DRI asks: it
  can end in an app restart (the screen warns of it).
- Stop and ask the DRI if the phone shows a low-battery warning, if any step
  wants an account or personal data, or if the app is on a version below 1.2.2
  and holds recordings (see prerequisite 6).
- No names, no places. Refer to people by role and to phones by model and
  Android version. Do not post the adb serial, a Wi-Fi or carrier name, or a
  screenshot with a notification, contact or location in it.

## Recording the result

1. **A dated comment on #1486**, `YYYY-MM-DD` (the user's date, not the
   container clock), with the results tables, the phone header, the
   `navigator.language(s)` table, which cells are `cannot-tell` and why, and
   which **ASSUMPTION** lines proved wrong. State plainly that the iPhone run
   and the `vi` in-app check are still open. Screenshots go on the issue
   (after review for names and places), not in the repo.
2. **A tracker line through a docs PR.** The acceptance criterion is a table in
   `docs/progress_tracker.md`: phone, OS version, script, rendered or tofu. Add
   one dated entry at the top (newest first, one entry per session, never edit
   an older entry) with that table and a link to the #1486 comment. Mark any
   phone or script not run as unverified. Open the PR from `develop` with the
   Sprint 6 milestone and `release-notes: N/A` (evidence, no code). Run
   `npm run check:pr-body` first.
3. Do not commit screenshots, logs or the fixture. Delete `/tmp/run-1486` after
   the comment is posted.
4. Do not close #1486 from an Android-only run.

## Cleanup

1. Stop the logcat capture and the fixture's `http.server`; run
   `adb reverse --remove tcp:8000`.
2. **HUMAN:** put the phone's language list back as it was.
3. Leave the app installed as found. Delete the scratch directory.
