# Prior art — oral BT audio tools

> Compiled 2026-08-22 for the tC Mobile inception. Every claim below was
> checked against a fetched page, a file read via the GitHub API, or strings
> extracted from a downloaded binary. Confidence is marked per finding.

## 1. Shema Studio

**Source code is NOT public — confidence HIGH.** Code search for `shema.studio`
and `shema_studio` returns nothing; shema.studio's homepage, /about, /download,
/support and /privacy contain zero links to GitHub or any source host.

**Action required:** Tim asked us to "look at the source code for Shema Studio."
That cannot be done from public sources. Someone needs to ask **Han Chung**
(the author) for a repo invite. Everything below was recovered by unzipping the
shipped Android APK.

- **What it is:** Flutter app (Android/iOS/Windows/macOS), free, v1.0.14 Aug
  2026, package `studio.shema.app`. Philosophy "LOMO" — Local, Oral, Mobile,
  Offline. Five bottom tabs: Choose → Understand → Translate → Refine → Share.
- **Audio stack:** `record`, `just_waveform`, `audioplayers`/`media_kit`, and
  **ffmpeg_kit** for cut/insert/concat.
- **Working format WAV, delivery M4A/AAC** (`-c:a aac -b:a 128k -ac 1`), joined
  with the ffmpeg concat demuxer. Confidence MEDIUM-HIGH (strings).

### The three data-model choices worth stealing

1. **Passage is first-class, and how a book is divided is a separate pluggable
   dimension.** `division_type.dart` plus localization keys
   `divisionBsb / divisionChapter / divisionEwe / divisionFia / divisionMine /
divisionProject / divisionRecent`, and three shipped pericope datasets
   (`bsb_pericopes.enc`, `fia_pericopes.enc`, `ewe_pericopes.enc`). A recording
   binds to the **passage**, not to a hard-coded chapter.
   _This is the single most important finding — see ADR 0004._
2. **Markers live inside the audio file as WAV cue points**
   (`utils/wav_cue_markers.dart`, class `WavCueMarker`). A take is
   self-describing and survives raw file sharing. Confidence MEDIUM-HIGH.
3. **`RecordingPurpose` and `RecordingStatus` are separate enums.** The progress
   guide names statuses: _affirmed / refined / draft / partly recorded / not yet
   started_.

### Waveform editing it already ships (confidence HIGH — published guide)

Tap to set playback point; press-and-hold + drag to select a range; play / cut /
clear selection; **insert a fresh recording at the playback point**; insert
silence; trim head/tail; divide into sections; press-and-hold a section to
re-listen; **re-record one section leaving the rest untouched**; copy a section;
drag to reorder sections; add section markers.

Plus a **pinned reference recording** that can be stepped through
section-by-section for record-along, and previous takes of the same section
surfacing automatically in the recorder.

> This is essentially the whole of tC Mobile's v1 feature list, already shipped.

### Interop

Real importers for **APM** (Audio Project Manager), **BTT Writer**, AVTT, USFM.
**No Scripture Burrito importer or exporter anywhere in the binary** — grepped,
zero "burrito" strings.

`.shema` bundle = a signed zip with `manifest.json`, in seven typed varieties
(Refine / Comments / Recording Text / Resources / Contribute / Full Sync /
Delivery), three security levels, and a **three-word spoken fingerprint** for
trust-circle pairing — no passwords, no typing, works for non-literate users.

### Clone / don't clone

| Element                                       | Clone?                  | Why                                                                                                                         |
| --------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Passage + pluggable division scheme           | **Yes — highest value** | One model serves OBS frames and Bible pericopes                                                                             |
| Section markers inside the audio (WAV cues)   | Yes                     | Self-describing takes                                                                                                       |
| Re-record one section, rest untouched         | Yes                     | This is Tim's "the work happens here"                                                                                       |
| Pinned reference, section-by-section stepping | Yes                     | Cheap, large UX win in a workshop                                                                                           |
| Separate purpose/status enums                 | Yes                     | Phase-2 progress + versioning without redesign                                                                              |
| Typed bundle purposes                         | Phase 2                 | Avoids "one blob for everything"                                                                                            |
| Three-word spoken fingerprint                 | Phase 2                 | Non-literate-friendly pairing                                                                                               |
| **FFmpeg for editing**                        | **No**                  | ffmpeg.wasm is heavy and slow on entry-level Android. Edit raw PCM; encode once on export. **This repo already does that.** |

## 2. `unfoldingWord-box3/passage-recorder-app`

Confidence HIGH — source read directly.

Expo SDK 51 / RN 0.74 / expo-av / AsyncStorage. **There is essentially no data
model: the filesystem is the database.**

```
${documentDirectory}recordings/{langCode}/{BOOK}/{chapter}/{lc}_{BOOK}_{ch}_{v|v1-v2}.m4a
```

Language/book/chapter are recovered by splitting the file path. No take model,
no section model, no project model, no verse markers, **no editing at all**. The
waveform is live amplitude metering from expo-av, not decoded PCM peaks.

**Reusable in a PWA:**

- **Directly:** `constants/versifications/{eng,lxx,vul}.json` (+ `maxVerses`
  lookup) and `constants/languages/languages.json` (299 KB language list).
  Plain JSON, zero native deps.
- **As a UX pattern:** the verse-range control — chevrons move the range, +/−
  expand it, and long-press accelerates quadratically. Good touch-first numeric
  input for a low-literacy UI.
- **Not otherwise.** Path-as-schema is a dead end once takes and reordering
  exist. Roughly 10% of v1 scope.

## 3. `deferredreward/tcorePSA` — Benjamin Wright

Confidence HIGH — source read directly. **Not an audio app** — it is tN/tW
_checking_ on a phone. It matters because it is the closest existing proof that
this exact stack works inside uW:

- **Preact + Vite + `vite-plugin-pwa` + IndexedDB + `fflate`**, chosen
  explicitly "for snappy startup on older Android phones." Eight prod deps.
- **Full Scripture Burrito zip round-trip in the browser**, regenerating
  `metadata.json` with md5/size/scope — and **preserving byte-for-byte every
  file the PWA doesn't model.** That rule is worth copying verbatim.
- **An event journal _draft_** — HLC timestamps, a random per-install actor id
  in IndexedDB, md5-of-payload event ids, and `base` chaining that makes forks
  **detectable, not resolvable**. Corrected 2026-08-22 after reading
  `src/lib/journal.js` in full: it implements exactly one operation
  (`check.decision.set`), there is no JSONL export, and **there is no fold and
  no merge** — the file's own header calls it a "DESIGN DRAFT" of
  `unfoldingWord/translationCore4`'s `BURRITO-SPEC.md` §8, which is the real
  upstream. Useful as a shape to copy; it is not a merge engine and not a
  versioning solution. It also carries **no license**, so its code is not
  legally reusable in this MIT repo — read it for design, do not copy it.

**Talk to Benjamin before writing any burrito emit code.**

## 4. Scripture Burrito — the audio answer

**Yes, there is a fully specified audio flavor, and a PWA can realistically emit
one.** Confidence HIGH — schemas and a real-world example read directly.

`type.flavorType.name = "scripture"`, `flavor.name = "audioTranslation"`.
Required: `performance` (singleVoice|multipleVoice × reading|drama) and
`formats`.

> ⚠️ **`compression` is an enum of only `mp3` and `wav`.** No AAC/M4A, no Opus.
> **tC Mobile's MP3 export is exactly right for burrito compatibility — and
> Shema's M4A would not be declarable.** This repo's canonical WAV + MP3 export
> is on the standard's happy path.

### Addressing audio to book/chapter/verse

**(a) Ingredient `scope`**, keyed by USFM book code, permitting `"1"` (chapter),
`"1-3"` (chapter range), `"1:5"` / `"1:5-21"` (verse range), `"1:5-2:3"`
(cross-chapter), or `[]` (whole book). A real burrito emitted by SIL's APM:

```json
"08RUT/002/ENGSEB2-RUT-2_1-13_Ruth 2_1-13_v5.mp3": {
  "checksum": { "md5": "9a468aab75d1699823abf117524d043e" },
  "mimeType": "audio/mpeg",
  "size": 2741394,
  "scope": { "RUT": ["2:1-13"] }
}
```

Note it splits Ruth 2 into `2:1-13` and `2:14-22` — **section-level, not
chapter-level.** That is precisely tC Mobile's section granularity, already
legal and already emitted by shipping software.

**(b) Timing files** — `"role": "timing"`, conforming to the Scripture Burrito
Alignment Format, `type: "audio-reference"`, mapping VTT timecodes to USFM
references. **This maps 1:1 onto tC Mobile's marker model.**

### Two caveats

- **The real world already diverges from the schema.** APM's own
  `metadata.json` omits `performance` and `formats`, both marked `required`.
  Don't assume "if APM does it, it validates." Validate against the published
  schemas with ajv in CI.
- **There is no audio flavor for OBS.** Stories exist only as
  `gloss/textStories`. OBS audio would need a custom `x-` flavor. Confidence
  HIGH. **Plan accordingly — burrito export for OBS is not a solved problem.**

## 5. LangQuest — brief

Adjacent, not overlapping. Confidence MEDIUM-HIGH. An Expo/React Native app
(not a PWA) centred on **collaborative data capture and sync** (PowerSync +
SQLite + Supabase) with community validation. Recording is `expo-audio`; no
evidence of a waveform editor, cut/insert/paste, take management or section
re-recording. It competes only on "offline oral capture on a phone," not on
"audio notebook and **editor**." Its local-SQLite-plus-sync idea assumes
eventual connectivity and a server, which contradicts tC Mobile's standalone
constraint — Shema's bundles are the better fit, along with tC4's
`BURRITO-SPEC.md` §8. **Not tcorePSA's journal:** §3 above establishes that it
is a design draft with one operation, no export, no fold, no merge and no
licence, so it is something to read rather than something to adopt.

## Open follow-ups

1. **Get a Shema Studio source invite from Han Chung** — Tim's request cannot
   otherwise be fulfilled.
2. **Talk to Benjamin Wright** before writing burrito emit code; he has already
   solved it in-browser.
3. **Decide whether OBS audio needs a custom `x-` flavor** — the standard does
   not cover it.
