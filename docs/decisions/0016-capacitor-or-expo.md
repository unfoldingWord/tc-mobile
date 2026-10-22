# 0016 — Stay on Capacitor with targeted plugins; move to Expo only on named triggers

**Status:** Proposed · **Date:** 2026-10-22 · **DRI:** the dev lead drafts;
the DRI decides · **Issue:**
[#1520](https://github.com/unfoldingWord/tc-mobile/issues/1520) · **Research:**
[`../research/capacitor-or-expo.md`](../research/capacitor-or-expo.md)

This ADR is **Proposed**. Nothing in it has run on a phone. The research note
labels every claim [observed], [inference] or [assumption]. This ADR repeats
only the conclusions and points to the note for the evidence. The throwaway
Expo proof (draft PR, branch `spike/1520-expo-proof`) has been built in a
container only.

## Context

The app is a React DOM PWA in a Capacitor 8 shell on iOS and Android
(`capacitor.config.ts`; [ADR 0009](0009-transcode-on-finished.md) for the
encoder). [`native-packaging.md`](../research/native-packaging.md) chose
Capacitor on 2026-08-27 and named the conditions that would flip that choice.

Since then three things have happened:

- iOS playback has hit the WebView's hold on the audio session repeatedly:
  #1100, #1111, #1116, #1251, #1261, and now #1518, which is silent Play on
  1.1.
- v2 asks for native-heavy storage: recording onto the microSD card
  ([ADR 0011](0011-v2-storage-and-export.md)) and cloud backup.
- The requirements owner has a hunch that native apps will be needed in v2
  (#1520, 2026-10-20). The DRI asked for the line to be drawn on evidence.

The DRI's 2026-10-22 pick on #1520 holds new Capacitor-native plugin work,
including #1456 and an `AVAudioPlayer` plugin for #1518, until this reports.

## Decision (proposed)

### 1. Where each native need goes

From the research note §2, in short:

| Need                                 | Line                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Audio session and the silent switch  | Stays in Capacitor: the `"playback"` declaration (#1518); an `AVAudioPlayer` plugin if that fails |
| microSD record and backup (Android)  | Stays in Capacitor: a custom plugin (#1456 chain); same native code in Expo                       |
| Cloud backup (iCloud, Google Drive)  | Stays: share sheet or Files picker; a plugin only for automatic backup                            |
| Background and interruptions         | Stays: background capture is not wanted (#836)                                                    |
| Share sheet                          | Stays: shipped                                                                                    |
| Large files and storage quota        | Stays, with a watch: the iOS embedded-web quota (≈15% per origin) and the base64 bridge           |
| MP3 encoder worker                   | Stays: shipped; a move would rewrite it                                                           |
| Limiter at record time; 32-bit float | Limiter stays (Web Audio); float capture unproven in both stacks                                  |
| Store listing and review             | Stays: no rejection on record                                                                     |

No need is in "needs a native app". The custom plugins the middle path needs
would be needed in Expo too, because Expo has no first-party module for the
card, Drive or iCloud. The one need Expo plainly simplifies is the iOS audio
session.

### 2. Recommendation for the DRI

**Stay on Capacitor and add targeted plugins (the middle path).** Lift the
hold on #1456 and on a #1518 plugin once the DRI accepts this. A move to Expo
costs roughly 120–200 PRs, against about 17–33 for the middle path (note §6).
It rewrites the UI and most of the browser boundary, and it needs a data
migration that has not been proven on a phone. Nothing found so far pays for
that.

This is a recommendation. The DRI decides.

### 3. What would trigger a move

Reopen this ADR, and plan a move, if **any one** of the first three fires, or
**two** of the rest:

1. **The audio session cannot be owned from the shell.** #1518's
   `"playback"` declaration fails on a device and an `AVAudioPlayer` plugin
   also fails, or the plugin cannot share the session with WKWebView
   recording.
2. **Storage outgrows the WebView.** A field phone hits the iOS embedded-web
   quota or loses data to eviction. Or, with clip bytes in files (the card
   seam), the base64 bridge cannot save a 20-minute take within the DRI's
   threshold on an entry-level Android phone (#1472 measures this).
3. **The proof's Play, with the silent switch on, is audible in Expo where the
   Capacitor build's is not after both #1518 fixes**, and the requirements
   owner rules that blocking.
4. WebView feel or performance is measured and rejected on an entry-level
   Android phone (`native-packaging.md` C4/C6).
5. A required need lands in "needs a native app": for example, real-time
   processing a WebView cannot run on the target phones.
6. The requirements owner commits the product past v2 with native-only
   features (v3 and beyond).

### 4. The hard rule for any move

No move starts until the proof's probe has read a real phone's `tc-mobile`
IndexedDB, with matching per-store counts, from an Expo build under
`org.unfoldingword.tcmobile` signed with the same key, on **both** iOS and
Android (note §4).

The move then ships a first-launch export of IndexedDB to native files that:

- verifies the copy;
- never deletes the old database in the same release;
- keeps the PWA at both origins, or ships Scripture Bundle export with an
  app-side import first, so PWA-only users are not stranded (note §4.4).

## Consequences

- **The hold lifts.** If accepted, #1456 and any #1518 plugin proceed as
  Capacitor plugins. Their Android Java and iOS Swift would carry into an
  Expo module later with a new bridge layer, so the work is not lost if a
  trigger fires. [inference]
- **The exit cost keeps growing.** `src/` was ≈8.6k lines at the 2026-08-27
  decision and is ≈64k now. Every Capacitor-specific UI PR adds to a later
  rewrite. Keeping `lib/` DOM-free, and keeping clip storage behind the #1456
  seam, are the two habits that keep a move possible. [inference]
- **The DRI runs the proof.** Its run sheet maps each phone result to these
  triggers. A failed migration probe on iOS does not by itself trigger
  anything; it makes any move costlier by one Swift module (note §4.3).
- **This ADR closes #1520** when the DRI accepts or rejects it.

## Open questions for the DRI

- Accept the middle path, or ask for more evidence first? The proof's phone
  run is the cheapest next evidence.
- The threshold for trigger 2's 20-minute save (shared with #1472).
