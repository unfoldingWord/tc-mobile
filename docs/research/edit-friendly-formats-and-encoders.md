# Edit-friendly formats, encoder licences and storage arithmetic

**Status:** desk research for #355, rows U6, U7 and U8 of its scope. No
decision is taken here. **Date:** 2026-10-28. It continues
[`reencode-loss-and-webview-codecs.md`](reencode-loss-and-webview-codecs.md),
which holds the re-encode measurement and the platform codec facts.

**Not in this note, and not run:** U1 and U2 (listening and real-speech
numbers) wait on the DRI's clips and stated bar. U3, U4 and U5 (decode and
record probes in the Android and iOS WebViews) are **not run, owed to #1472's
devices**. Nothing below claims a device was used.

Dates are the day the source was fetched. A line marked _inference_ is the
author's reading, not something a source says.

## U6: is there an edit-friendly compressed format?

The question: can a cut or an insert be made without re-encoding the audio
that was not touched, so that option 1 (record straight to a compressed
format) loses nothing to editing.

### What the specifications say

| Format           | What the source says about independence                                                                                                                                                                                                                                                                                                                                                           | Source                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FLAC (lossless)  | "each frame starts with a byte-aligned 15-bit sync code" so "a decoder [can] start decoding at any place in the stream"; each frame header carries a sample or frame number, "sample-accurate seeking"; "each subframe in FLAC is coded completely independently". Lossless, so no generation loss at all. The sources give no size ratio; none is computed here.                                 | RFC 9639 section 6 and the subframe prediction description, <https://www.rfc-editor.org/rfc/rfc9639.txt> (fetched 2026-10-28)                                                       |
| Opus in Ogg      | A decoder keeps state between packets. For sample-accurate cropping of an encoded stream, "a value of at least 3840 samples (80 ms) provides sufficient history to the decoder that it will have converged"; a seek "SHOULD start decoding (and discarding the output) at least 3840 samples (80 ms) prior to the seek target". So an Opus cut needs 80 ms of earlier packets kept or re-decoded. | RFC 7845 sections 4.2 and 4.6, <https://www.rfc-editor.org/rfc/rfc7845.txt> (fetched 2026-10-28); state reset, RFC 6716 section 4.5.2, <https://www.rfc-editor.org/rfc/rfc6716.txt> |
| Vorbis           | "The MDCT output of one frame is windowed ... overlapped 50% with the output of the previous frame and added." A frame cannot be rebuilt without its neighbour.                                                                                                                                                                                                                                   | Vorbis I specification, <https://xiph.org/vorbis/doc/Vorbis_I_spec.html> (fetched 2026-10-28)                                                                                       |
| MP3              | RFC 6716 section 2.1.8 describes what MP3 and AAC "call CBR" as "not true CBR due to the bit reservoir". Each frame's side info starts with a 9-bit `main_data_begin` (`third_party/lamejs-1.2.7/src/js/BitStream.js:291`), the number of bytes it reaches back into earlier frames.                                                                                                              | RFC 6716 section 2.1.8; lamejs source, in this repo                                                                                                                                 |
| AAC              | Same bit-reservoir statement for AAC in RFC 6716 section 2.1.8. No AAC specification was fetched, so anything else about AAC frame independence is **unverified**.                                                                                                                                                                                                                                | RFC 6716 section 2.1.8                                                                                                                                                              |
| IMA ADPCM in WAV | Not fetched. Listed only as a format an engineer might name: block-based and about four bits per sample (from the format's name and common description; **unverified**, no primary source read).                                                                                                                                                                                                  | none                                                                                                                                                                                |

So on the sources read, the only format with independently decodable,
sample-addressable frames is **FLAC**, and it is lossless rather than small.
Opus and Vorbis are overlapped or stateful, so an edit at a cut needs a few
frames of neighbouring audio.

### The MP3 byte-comparison experiment

MP3 is the format the app already ships, so the useful question is how an
MP3 from the project's own encoder behaves when frames are cut out. Only a
cut was run; an insert was **not run**.

The script below (inline, following the existing note's pattern) does this on
the same synthetic 20 s signal as the re-encode note, so it carries the same
limit: it is not recorded speech.

1. Encode with `encodeMp3` (64 kbps CBR), walk the frames with
   `readMp3FrameHeader`, and read each frame's `main_data_begin`.
2. Decode the whole stream with one `mpg123-decoder` 1.0.3 instance fed
   32 frames per call (the stand-in decoder of the earlier note, not a
   platform decoder). The note records no control comparing that walk with
   a single `decode()` of the whole buffer.
3. Remove 100 whole frames (frames 200 to 299, 2.6 s) by copying the others
   as bytes, decode the joined stream, and compare it with the reference
   decode spliced the same way in the sample domain.

One run, results as printed:

```text
frames 767; bytes 160287; main_data_begin: zero in 767 frames, max 0, mean 0.0 bytes
reference decode: 883584 samples (767.00 granules), decoder errors 0
naive cut: removed frames 200..299 (100 frames); kept frames byte-identical 667/667; length matches expected true; decoder errors 0; differing samples: samples 0 to 1025 after the join (23.3 ms), max |diff| 6989
first frame at or after 300 with main_data_begin 0: 300
cut ending at main_data_begin 0: removed frames 200..299 (100 frames); kept frames byte-identical 667/667; length matches expected true; decoder errors 0; differing samples: samples 0 to 1025 after the join (23.3 ms), max |diff| 6989
```

What this shows, and no more:

- **Untouched frames stay byte-identical.** Every kept frame is a byte copy,
  so this is true by construction; the run confirms the frame walk reads whole
  frames and the join decodes with no decoder errors and the expected length.
- **This encoder never uses the bit reservoir.** `main_data_begin` is 0 in
  all 767 frames. The cause is in the source: the stream encoder sets
  `gfp.disable_reservoir = true`
  (`third_party/lamejs-1.2.7/src/js/index.js:108`), and the reservoir size
  is forced to zero when that flag is set
  (`third_party/lamejs-1.2.7/src/js/Reservoir.js:158`). So for the app's own
  MP3s the inter-frame byte dependence that makes a cut hard in other
  encoders' output does not arise. This is a property of the encoder
  settings, not of the MP3 format: an MP3 from an encoder that uses the
  reservoir would have to be cut with `main_data_begin` checked, and this run
  did not test one (no such encoder was available to run).
- **The join is not clean for 23 ms.** The decode after the join differs from
  the spliced reference for samples 0 to 1025 after the join (1026 samples,
  23.3 ms), by up to 6989 of 32767. Inference: this is the transform
  overlap and filterbank memory of the granule before the cut, which the
  decoder no longer has; the run does not isolate the cause. It is a
  transient shorter than one frame (1026 of 1152 samples), not a loss of
  the following audio: everything after sample 1025 matches the reference exactly. Whether
  it is audible as a click was **not listened to**; that is a listening
  question for the row's second pass and is not run.

**U6 answer.** On the sources and this run: no compressed lossy format was
found that lets a cut be made with no neighbouring-frame effect at all.
For the MP3 the app already writes, whole frames can be removed with every
remaining frame byte-identical, with a roughly 23 ms transient at the join
that would need either a short crossfade or a re-encode of one or two frames
at the seam. FLAC has independent frames and no loss, but its size relative
to 64 kbps MP3 is unmeasured, and Scripture Bundle's audio flavour admitted
only `mp3` and `wav` as of ADR 0003. Option 1 therefore stays closed on this
evidence; the follow-up that would reopen it is a listening check of the
23 ms seam on real speech (U1's clips).

### Reproducing

Same arrangement as the earlier note: one file outside the tree, importing
the project's modules through the `@/` alias, `npm ci` done in the checkout,
`$REPO` set to its absolute path.

```bash
mkdir /tmp/cutexp && cd /tmp/cutexp
npm init -y && npm i mpg123-decoder@1.0.3
# save the script below as cut.ts, and tsconfig.json as
# {"compilerOptions":{"baseUrl":".","paths":{"@/*":["$REPO/src/*"]}}}
# with $REPO written out in full
"$REPO/node_modules/.bin/esbuild" cut.ts --bundle --platform=node \
  --format=esm --outfile=cut.mjs --tsconfig=tsconfig.json \
  --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);"
node cut.mjs
```

```ts
// Frame-boundary cut of a 64 kbps MP3: what stays byte-identical, what decodes differently.
import { MPEGDecoder } from "mpg123-decoder";
import { encodeMp3 } from "@/lib/audio/mp3";
import { readMp3FrameHeader } from "@/lib/audio/mp3-align";
import { floatToInt16 } from "@/lib/audio/format";
import { speechLikePcm } from "@/lib/phone-check/speech";

interface Frame {
  at: number;
  len: number;
  mdb: number;
}

function frames(mp3: Uint8Array): Frame[] {
  const out: Frame[] = [];
  for (let at = 0; ;) {
    const h = readMp3FrameHeader(mp3, at);
    if (!h) break;
    const si = at + 4 + (h.crc ? 2 : 0); // side info follows the header (and CRC)
    // main_data_begin is the first 9 bits of the side info
    out.push({ at, len: h.length, mdb: (mp3[si]! << 1) | (mp3[si + 1]! >> 7) });
    at += h.length;
  }
  return out;
}
function join(mp3: Uint8Array, fs: Frame[]): Uint8Array {
  const out = new Uint8Array(fs.reduce((n, f) => n + f.len, 0));
  let o = 0;
  for (const f of fs) {
    out.set(mp3.subarray(f.at, f.at + f.len), o);
    o += f.len;
  }
  return out;
}
async function decode(
  mp3: Uint8Array
): Promise<{ pcm: Int16Array; errors: number }> {
  const dec = new MPEGDecoder();
  await dec.ready;
  const fs = frames(mp3);
  const parts: Float32Array[] = [];
  let errors = 0;
  for (let i = 0; i < fs.length; i += 32) {
    const grp = fs.slice(i, i + 32);
    const last = grp[grp.length - 1]!;
    const r = dec.decode(mp3.subarray(grp[0]!.at, last.at + last.len));
    errors += r.errors.length;
    parts.push(r.channelData[0]!);
  }
  dec.free();
  const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.length;
  }
  return { pcm: floatToInt16(all), errors };
}

const G = 1152;
const orig = encodeMp3(speechLikePcm(20));
const fs = frames(orig);
const mdbs = fs.map((f) => f.mdb);
console.log(
  `frames ${fs.length}; bytes ${orig.length}; main_data_begin: zero in ${mdbs.filter((m) => m === 0).length} frames, max ${Math.max(...mdbs)}, mean ${(mdbs.reduce((a, b) => a + b, 0) / mdbs.length).toFixed(1)} bytes`
);

const ref = await decode(orig);
console.log(
  `reference decode: ${ref.pcm.length} samples (${(ref.pcm.length / G).toFixed(2)} granules), decoder errors ${ref.errors}`
);

async function trial(label: string, cutFrom: number, cutTo: number) {
  // remove frames [cutFrom, cutTo); every kept frame is copied as bytes.
  const kept = [...fs.slice(0, cutFrom), ...fs.slice(cutTo)];
  const joined = join(orig, kept);
  let identical = 0;
  let o = 0;
  for (const f of kept) {
    let same = true;
    for (let i = 0; i < f.len; i++)
      if (joined[o + i] !== orig[f.at + i]) {
        same = false;
        break;
      }
    if (same) identical++;
    o += f.len;
  }
  const dec = await decode(joined);
  const expect = new Int16Array(ref.pcm.length - (cutTo - cutFrom) * G);
  expect.set(ref.pcm.subarray(0, cutFrom * G));
  expect.set(ref.pcm.subarray(cutTo * G), cutFrom * G);
  const n = Math.min(expect.length, dec.pcm.length);
  let first = -1;
  let last = -1;
  let maxAbs = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(expect[i]! - dec.pcm[i]!);
    if (d > 0) {
      if (first < 0) first = i;
      last = i;
      if (d > maxAbs) maxAbs = d;
    }
  }
  const lenOk = dec.pcm.length === expect.length;
  const span =
    first < 0
      ? "none"
      : `samples ${first - cutFrom * G} to ${last - cutFrom * G} after the join (${((last - first + 1) / 44.1).toFixed(1)} ms), max |diff| ${maxAbs}`;
  console.log(
    `${label}: removed frames ${cutFrom}..${cutTo - 1} (${cutTo - cutFrom} frames); kept frames byte-identical ${identical}/${kept.length}; length matches expected ${lenOk}; decoder errors ${dec.errors}; differing samples: ${span}`
  );
}

const K = 200;
await trial("naive cut", K, K + 100);
// A cut whose first kept frame has main_data_begin 0 needs no bytes from before the cut.
let end = K + 100;
while (end < fs.length && fs[end]!.mdb !== 0) end++;
console.log(
  `first frame at or after ${K + 100} with main_data_begin 0: ${end < fs.length ? end : "none"}`
);
if (end < fs.length) await trial("cut ending at main_data_begin 0", K, end);
```

## U7: candidate Web Worker encoders and their licences

DRI decision 4 on #355: "LGPL on ADR 0003's terms (Recommended)". An LGPL
encoder is a candidate when it sits behind the same replaceable Web Worker
boundary and meets the obligations ADR 0003 records for lamejs.

**This is a recommendation, not a legal ruling.** ADR 0003 itself records
that its mechanism "was selected by the DRI, not confirmed by qualified
counsel". The yes or no below only says whether ADR 0003's list can be met by
the same means; it does not say a licence is satisfied.

### The test

ADR 0003 "What we owe" lists five items: (1) a replaceable boundary, (2) one
module interface, (3) licence text and attribution shipped and reachable on
the phone, (4) no patches to the library, (5) say so in the open. Its
section 4(d) note adds a source offer. A permissive licence (MIT, BSD) has no
relink or source obligation, so for those the test reduces to items 2, 3 and
5 and carrying the notices. "Yes" below means those can be met by the means
ADR 0003 already uses.

### Candidates

Every package was fetched with `npm pack` on 2026-10-28 and its own files read.
The text in quotation marks is from the package named.

| Candidate (version)                     | Codec                                                                                            | Package licence, quoted                                                                                                                                                                                                                                                  | What it embeds, and whether the package carries that licence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | ADR 0003 terms met?                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `opus-recorder` 8.0.5                   | Opus in Ogg, in its own worker (`dist/encoderWorker.min.js`, 385 096 bytes, plus a WASM decoder) | `LICENSE.md`: "## Opus Recorder License (MIT)"                                                                                                                                                                                                                           | The same file carries "## Opus License (BSD)" ("Copyright 2001-2011 Xiph.Org, Skype Limited, Octasic ...") and "## Speex License (BSD)". README: "Libopus: v1.3.1", "speexDSP: 1.2.0".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | **Yes**, permissive. The package ships all three notices; they would go into `public/licenses/`.                                                                                                                                                                                                                                                                                                      |
| `opusscript` 0.1.1                      | Opus                                                                                             | `LICENSE`: "The MIT License (MIT) Copyright (c) 2016-2021 abalabahaha"                                                                                                                                                                                                   | README: "JS bindings for libopus 1.4, ported with Emscripten." The licence file is MIT only and does not carry libopus's BSD text.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | **Yes, with a condition:** the libopus BSD notice has to be taken from upstream. Its README example uses `require`, so a browser Worker build is not shown by the package (inference).                                                                                                                                                                                                                |
| `libopus-wasm` 0.4.1                    | Opus packets (raw encode and decode, no Ogg muxing, from its description)                        | `LICENSE`: "MIT License Copyright (c) 2026 openclaw"                                                                                                                                                                                                                     | `THIRD_PARTY_NOTICES.md`: libopus "License: BSD-style license, see the upstream source archive for the full text."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | **Yes, with a condition:** the full BSD text is not in the package and has to be fetched from upstream. Container muxing would be ours.                                                                                                                                                                                                                                                               |
| `wasm-media-encoders` 0.7.0             | MP3 (LAME) and Ogg Vorbis, WASM                                                                  | `LICENSE`: "MIT License Copyright (c) 2020-2024 arseneyr"; README: "licensed under the terms of the **MIT** license."                                                                                                                                                    | README: "compiling the reference LAME and Ogg Vorbis encoders to WebAssembly". The licence file has no mention of LAME or Vorbis. LAME's own page says "Yes, you can, under the restrictions of the LGPL" (<https://lame.sourceforge.io/license.txt>, fetched 2026-10-28).                                                                                                                                                                                                                                                                                                                                                                                                           | **MP3 half: no benefit**, it is a second LGPL encoder with the same obligations as lamejs. **Vorbis half: licence yes with a condition** (libvorbis BSD text is not in the package, not verified), and Safari Vorbis support is unresolved by iOS version (see below), so it is not struck. The package's "MIT" label understates what it contains; anyone shipping it would have to add the notices. |
| `libflacjs` 5.6.0                       | FLAC                                                                                             | `LICENSE`: "The MIT License (MIT) Copyright (c) 2014-2020 DFKI GmbH based on FLAC encoder: Copyright (C) 2000-2009 Josh Coalson, Copyright (C) 2011-2014 Xiph.Org Foundation"; README: "libflac.js is compiled from the reference implementation of FLAC (BSD license)". | The BSD terms are named in the README, not reproduced in `LICENSE`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **Yes, with a condition:** carry the FLAC BSD notice from upstream.                                                                                                                                                                                                                                                                                                                                   |
| `@mediabunny/mp3-encoder` 1.62.1        | MP3 (LAME), in a Worker                                                                          | `package.json`: `"license": "MPL-2.0"`; README: "uses the same MPL-2.0 license ... The LAME MP3 Encoder is licensed under LGPL."                                                                                                                                         | The package itself says it spawns a worker that loads a WASM build of LAME. Needs `mediabunny` as a peer dependency.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | **Yes on ADR 0003's terms** (LGPL behind a Worker), plus a new MPL-2.0 file-level obligation. It buys nothing over lamejs, which already encodes MP3.                                                                                                                                                                                                                                                 |
| `@mediabunny/aac-encoder` 1.62.1        | AAC-LC, WASM build of FFmpeg's AAC encoder                                                       | `package.json`: `"license": "MPL-2.0"`; README: "uses a fast, size-optimized WASM build of FFmpeg's AAC encoder under the hood."                                                                                                                                         | FFmpeg "is licensed under the GNU Lesser General Public License (LGPL) version 2.1 or later. However, FFmpeg incorporates several optional parts ... covered by the GNU General Public License (GPL) version 2 or later. If those parts get used the GPL applies to all of FFmpeg." (<https://ffmpeg.org/legal.html>, fetched 2026-10-28). The package ships only the MPL text and its README and sources do not name FFmpeg's licence. Its documented build recipe passes `--disable-all --enable-avcodec --enable-encoder=aac` and no `--enable-gpl`, so the result would be LGPL by FFmpeg's rule (inference: whether the shipped WASM was built exactly so is **not verified**). | **Conditional.** Yes on ADR 0003's terms if the shipped binary is LGPL-only, which the package does not state. Patent position of AAC was not examined. Also, Scripture Bundle's audio flavour listed no AAC as of ADR 0003.                                                                                                                                                                          |
| `@ffmpeg/core` 0.12.10                  | many, via FFmpeg WASM                                                                            | `package.json`: `"license": "GPL-2.0-or-later"`                                                                                                                                                                                                                          | GPL on the whole module                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **No.** A GPL core is outside ADR 0003's LGPL position, and ADR 0003 already rejected ffmpeg.wasm on weight. Struck.                                                                                                                                                                                                                                                                                  |
| `@breezystack/lamejs` 1.2.7 (reference) | MP3                                                                                              | `"license": "LGPL-3.0"`; already ADR 0003's position                                                                                                                                                                                                                     | n/a                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Already in place.                                                                                                                                                                                                                                                                                                                                                                                     |

### Reading across the rows

- Every Opus candidate (`opus-recorder`, `opusscript`, `libopus-wasm`) is
  permissive in its own licence file and embeds a BSD-licensed Xiph codec.
  Licence is not what separates them from lamejs; what does is **where the
  output can go**: ADR 0003's Scripture Bundle limit (`mp3`, `wav`) and the
  earlier note's open question whether Opus in Ogg decodes through
  `decodeAudioData` on iOS. Those are U4 and the bundle profile, not licence.
- The only candidate with an LGPL encoder that is not already lamejs is
  `@mediabunny/mp3-encoder`, and it duplicates it. The AAC encoder is the one
  place the LGPL decision matters, and it is conditional on a build the
  package does not describe.
- Vorbis on Safari is **unresolved**, not excluded. The earlier note's MDN
  source (fetched 2026-10-26) lists no Safari Vorbis support; a review of
  this note cites WebKit's Safari 18.4 announcement
  (<https://webkit.org/blog/16574/webkit-features-in-safari-18-4/#media>,
  **not fetched here**) as adding Ogg Vorbis. Support may depend on the iOS
  version, and `decodeAudioData` of Vorbis in the target WebViews (U4,
  #1472) is not run.
- "Not run": none of these was built into the app, run in a Worker, or
  timed. This is licence text and package contents only.

## U8: storage arithmetic for a 50-story book

Every input, with its source:

| Input                     | Value                                                                                    | Source                                                                                                                                                                                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Canonical audio           | mono, 16-bit, 44.1 kHz = 88 200 bytes per second = 5.292 MB per minute (decimal MB)      | `src/lib/audio/format.ts:15-16`; 44 100 x 2 bytes; ADR 0002 rounds to "~5.3 MB per minute"                                                                                                                                                                         |
| Story count               | 50                                                                                       | `src/data/obs-catalog.json` (`stories` has 50 entries)                                                                                                                                                                                                             |
| Minutes per story, base   | 2.5, so 125 minutes in all                                                               | `docs/decisions/0002-audio-storage-format.md` ("An OBS story of 2-3 minutes ... all 50 stories at ~2.5 min each is roughly 660 MB"). An assumption in that ADR, not a measured duration.                                                                           |
| Minutes, high case        | 177.9, so 3.56 per story                                                                 | _Inference, assumption:_ the catalogue's 26 686 words (`src/data/obs-catalog.json`, 598 frames, counted by whitespace) read at 150 words per minute. 150 wpm is the author's assumption, with no source. Recorded speech with pauses and re-takes is not modelled. |
| MP3 at 64 kbps            | 8 000 bytes per second nominal; measured 160 287 bytes for 20 s = 8 014 bytes per second | `src/lib/audio/mp3-size.ts` (`DEFAULT_BITRATE_KBPS`); measured figure from the earlier note's Results                                                                                                                                                              |
| Opus nominal speech rates | 16 to 20 kbit/s wideband speech, 28 to 40 kbit/s fullband speech                         | RFC 6716 section 2.1.1, <https://www.rfc-editor.org/rfc/rfc6716.txt>. 20 and 32 kbit/s taken as round figures inside those ranges. Opus is VBR by default (section 2.1.8), so these are nominal, not measured.                                                     |
| AAC-LC                    | same 64 kbps as MP3 for comparison                                                       | no other AAC rate is sourced here                                                                                                                                                                                                                                  |
| FLAC                      | not computed                                                                             | the specification gives no ratio (U6)                                                                                                                                                                                                                              |
| Phone free space          | 8 GB, taken as 8 000 MB                                                                  | the issue body ("a phone with 8 GB free")                                                                                                                                                                                                                          |

Result (decimal MB; 8 GB = 8 000 MB; arithmetic only, no on-device figure):

| Format                      | MB per minute | 50 stories at 125 min | Share of 8 GB | 50 stories at 177.9 min | Share of 8 GB |
| --------------------------- | ------------- | --------------------- | ------------- | ----------------------- | ------------- |
| PCM 16-bit 44.1 kHz         | 5.292         | 661.5 MB              | 8.27%         | 941.4 MB                | 11.77%        |
| MP3 64 kbps (nominal)       | 0.480         | 60.0 MB               | 0.75%         | 85.4 MB                 | 1.07%         |
| MP3 64 kbps (measured rate) | 0.481         | 60.1 MB               | 0.75%         | 85.5 MB                 | 1.07%         |
| AAC-LC 64 kbps (nominal)    | 0.480         | 60.0 MB               | 0.75%         | 85.4 MB                 | 1.07%         |
| Opus 32 kbit/s (nominal)    | 0.240         | 30.0 MB               | 0.38%         | 42.7 MB                 | 0.53%         |
| Opus 20 kbit/s (nominal)    | 0.150         | 18.8 MB               | 0.23%         | 26.7 MB                 | 0.33%         |
| FLAC                        | not computed  |                       |               |                         |               |

What the table says:

- The PCM stage costs about 662 MB for all 50 stories at the ADR's own length,
  under a tenth of 8 GB. That is the all-PCM figure (every segment
  unfinished) under the assumptions below: one copy per segment, no retakes,
  no edit copies; it is not a worst case. It matches ADR 0002's "~660 MB".
- The "~66 MB" that `AGENTS.md` gives for the finished case is about 10% above
  the 60 MB computed here; the sources do not say why (not investigated).
- Nominal bitrates are not a size on disk: container overhead, the final
  partial frame and the VBR behaviour of Opus are not in the table.
- The table is for finished books. Phone free space, the other files on the
  card and an edit's temporary copies are not in it.

## What each of these changes for ADR 0013 (#1473)

One line per row. U1 to U5 are not covered here.

- **U6:** no change to PCM-then-MP3. Option 1 stays closed on this evidence;
  the app's own MP3s can be cut at frame boundaries with every kept frame
  byte-identical, with a roughly 23 ms transient at the seam that U1's clips
  would have to judge.
- **U7:** no change. Opus encoders are permissively licensed; the open
  question for any non-MP3 codec is the Bundle profile and iOS decode (U4),
  not the licence. The AAC encoder is conditional on an unverified build.
  `@ffmpeg/core` is struck.
- **U8:** informs only. The PCM stage is about 662 MB for 50 stories at the
  ADR's lengths (8.3% of 8 GB); the finished MP3s are about 60 MB.
