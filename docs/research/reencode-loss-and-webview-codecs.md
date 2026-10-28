# Re-encode loss at 64 kbps, and which codecs the WebViews decode

**Status:** measurement and sourced facts for #355 (codec half of #1456). No
decision is taken here. **Date:** 2026-10-26.

Rows U6 to U8 of #355 (edit-friendly formats, encoder licences, storage
arithmetic) are in
[`edit-friendly-formats-and-encoders.md`](edit-friendly-formats-and-encoders.md).

## The question

#355 asks how much a 64 kbps speech recording loses on each decode and
re-encode, because that decides whether the uncompressed working copy can go
(ADR 0002). Today a Finished segment edited again is decoded and re-encoded
once per edit cycle, and that one generation is already accepted.

## Method

- Signal: `speechLikePcm(20)` from `src/lib/phone-check/speech.ts`, 20 s of
  mono 44.1 kHz, the app's canonical format.
- Encoder: the project's own `encodeMp3` (`src/lib/audio/mp3.ts`, lamejs, 64 kbps
  CBR), called unchanged.
- Decoder: **not the project's.** The app decodes with `decodeAudioData` in a
  browser (`hooks/audio-io.ts`), which Node does not have. The stand-in is
  `mpg123-decoder` 1.0.3 (WASM libmpg123, MIT wrapper). Its output is aligned
  with the project's `fitMp3Decode`, so the 1105-sample encoder priming is
  removed the way the app removes it. The script checks the alignment: the
  best lag at generation 1 is 0 samples.
- Each generation decodes the previous generation's output to 16-bit PCM and
  encodes it again. Generation 1 is one encode and one decode of the original.
- Metrics, all against the original unless stated: waveform SNR in dB; log
  spectral distance (LSD), RMS difference of 1024-point Hann-window log
  spectra up to 8 kHz over frames above a small energy floor; and SNR of each
  generation against the one before it.

## Results

One run, deterministic input. Every MP3 is 160 287 bytes.

| Generations | SNR vs original (dB) | LSD vs original (dB) | SNR vs previous generation (dB) |
| ----------- | -------------------- | -------------------- | ------------------------------- |
| 1           | 12.07                | 4.36                 | 12.07 (the original)            |
| 2           | 10.97                | 4.68                 | 17.98                           |
| 3           | 10.04                | 4.99                 | 18.45                           |
| 5           | 8.51                 | 5.50                 | 18.35                           |
| 10          | 5.76                 | 6.53                 | 17.63                           |

The last column compares each generation with the one immediately before it
in the chain, not with the row above: generations 4 and 6 to 9 are computed
and not shown, so row 5 is against generation 4 and row 10 against
generation 9.

What the numbers say, as measured:

- Loss accumulates and does not converge by 10 generations. SNR against the
  original falls about 1 dB per early generation (12.07 to 10.97 to 10.04) and
  about 0.55 dB per generation between 5 and 10.
- The one already accepted re-encode (generation 1 to 2) costs 1.10 dB of SNR
  and 0.32 dB of LSD on this signal. Each later generation adds an error about
  18 dB below the signal.
- Generation 1 itself is 12 dB, so most of the waveform error is the first
  encode. The signal has a noise breath on each syllable, which a 64 kbps
  perceptual coder discards, and waveform SNR counts that as loss.

## Does PCM-then-MP3 lose audibly across the one accepted re-encode?

**Not answered, and these numbers cannot answer it.** SNR and LSD are not
listening tests. A perceptual coder puts its error where the ear masks it, so
a dB figure says how far the waveform moved, not whether a person hears it. No
one listened to any output. What is supported: the loss is real, steady and
cumulative, so ten generations is not free. The #355 test, "ten re-encodes of
spoken voice inaudible to a listener", is not met by anything here, and these
figures give no ground for dropping the uncompressed stage. What would
answer it is a listening test on real recorded speech from the target
languages.

## Limits

- **The signal is synthetic.** Inference: a voiced source with harmonics and
  noise is simpler than speech, but its noise and sharp envelope may also make
  these numbers look worse than real speech would. The direction of the bias
  is not established. Treat the figures as the behaviour of this encoder on
  this signal.
- **No recorded human speech fixture exists** in the repo, so none was used.
- The decoder is not the one the app ships (see Method); a platform decoder
  may differ in the last bit and in trimming.
- One signal, one run, one sample rate, mono. Nothing was run on a device.
- Only MP3 was measured. Opus, AAC and Vorbis encoders are not in the repo, and
  the encoder licence question stays with ADR 0003. Nothing here reopens it.

## Which codecs the platforms decode natively (WebView unsourced)

Sourced, with the gaps stated.

**Android.** Android's supported-formats page lists decoders for MP3 and AAC LC
(all versions), Vorbis (all versions, Ogg, WebM and MPEG-4), Opus (Android
5.0 and later), FLAC (3.1 and later), AMR-NB, AMR-WB and 8/16-bit PCM/WAV.
Source: <https://developer.android.com/media/platform/supported-formats>
(fetched 2026-10-26). That page does **not mention WebView**. That Android
WebView decodes what the platform media stack does is an inference, not a
sourced fact.

**iOS.** MDN's audio codec guide gives Safari support for MP3 (3.1), AAC, FLAC
(11) and Opus (11, and for `<audio>` only in a CAF file, on iOS 11), and none
for Vorbis. Source:
<https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Audio_codecs>
(fetched 2026-10-26). The guide does not separate Safari on iOS from Safari on
macOS, and does not mention WKWebView. WKWebView shares Safari's engine
(inference). Current support for Opus in other containers was not found in a
source I could fetch, so it is open.

Both pages describe the platform media stack and Safari's media support; they
do not describe `decodeAudioData`, which is how this app decodes
(`hooks/audio-io.ts`), and both say support can differ by device. The check
that answers the question is `decodeAudioData` of fixture bytes for each
candidate codec in the target WebViews. `canPlayType` may be recorded beside
it; it does not replace it. Nobody has run either.

## Reproducing

The script is one file outside the tree. It imports the project's modules
through the `@/` alias and needs `npm ci` done in the checkout. From the repo
root, with `$REPO` set to its absolute path:

```bash
mkdir /tmp/reencode && cd /tmp/reencode
npm init -y && npm i mpg123-decoder@1.0.3
# save the script below as measure.ts, and tsconfig.json as
# {"compilerOptions":{"baseUrl":".","paths":{"@/*":["$REPO/src/*"]}}}
# with $REPO written out in full
"$REPO/node_modules/.bin/esbuild" measure.ts --bundle --platform=node \
  --format=esm --outfile=measure.mjs --tsconfig=tsconfig.json \
  --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);"
node measure.mjs
```

The script:

```ts
// Re-encode generation loss at 64 kbps. Run via the command in the research note.
import { MPEGDecoder } from "mpg123-decoder";
import { encodeMp3 } from "@/lib/audio/mp3";
import { fitMp3Decode, readMp3FrameHeader } from "@/lib/audio/mp3-align";
import { floatToInt16, CANONICAL_SAMPLE_RATE } from "@/lib/audio/format";
import { speechLikePcm } from "@/lib/phone-check/speech";

const SECONDS = 20;
const GENS = [1, 2, 3, 5, 10];
const N = 1024;

function snr(ref: Int16Array, x: Int16Array): number {
  let s = 0,
    e = 0;
  for (let i = 0; i < ref.length; i++) {
    s += ref[i]! ** 2;
    e += (ref[i]! - x[i]!) ** 2;
  }
  return 10 * Math.log10(s / e);
}
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len)
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(a * k),
          wi = Math.sin(a * k);
        const ur = re[i + k]!,
          ui = im[i + k]!;
        const vr = re[i + k + len / 2]! * wr - im[i + k + len / 2]! * wi;
        const vi = re[i + k + len / 2]! * wi + im[i + k + len / 2]! * wr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
      }
  }
}
function logSpec(x: Int16Array, off: number): Float64Array {
  const re = new Float64Array(N),
    im = new Float64Array(N);
  for (let i = 0; i < N; i++)
    re[i] = (x[off + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  fft(re, im);
  const out = new Float64Array(N / 2);
  for (let k = 0; k < N / 2; k++)
    out[k] = 10 * Math.log10(re[k]! ** 2 + im[k]! ** 2 + 1);
  return out;
}
// Log-spectral distance (dB, RMS over bins 0-8 kHz, frames with signal only).
function lsd(ref: Int16Array, x: Int16Array): number {
  const kmax = Math.floor((8000 / (CANONICAL_SAMPLE_RATE / 2)) * (N / 2));
  let acc = 0,
    cnt = 0;
  for (let off = 0; off + N <= ref.length; off += N) {
    let en = 0;
    for (let i = 0; i < N; i++) en += ref[off + i]! ** 2;
    if (en / N < 100 ** 2) continue;
    const a = logSpec(ref, off),
      b = logSpec(x, off);
    for (let k = 0; k < kmax; k++) {
      acc += (a[k]! - b[k]!) ** 2;
      cnt++;
    }
  }
  return Math.sqrt(acc / cnt);
}

async function decode(mp3: Uint8Array, frames: number): Promise<Int16Array> {
  const dec = new MPEGDecoder();
  await dec.ready;
  // Whole-buffer decode aborts past a few seconds, so feed whole frames in groups.
  const parts: Float32Array[] = [];
  let at = 0;
  while (at < mp3.length) {
    const start = at;
    for (let n = 0; n < 32; n++) {
      const h = readMp3FrameHeader(mp3, at);
      if (!h) break;
      at += h.length;
    }
    if (at === start) break;
    const r = dec.decode(mp3.subarray(start, at));
    if (r.errors.length) throw new Error(JSON.stringify(r.errors));
    if (r.sampleRate !== CANONICAL_SAMPLE_RATE && r.samplesDecoded)
      throw new Error(`rate ${r.sampleRate}`);
    parts.push(r.channelData[0]!);
  }
  const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.length;
  }
  dec.free();
  return fitMp3Decode(floatToInt16(all), mp3, frames);
}

const orig = speechLikePcm(SECONDS);
let cur = orig,
  prev = orig;
console.log(
  "gen | SNR vs original (dB) | LSD vs original (dB) | SNR vs previous gen (dB) | bytes"
);
for (let g = 1; g <= Math.max(...GENS); g++) {
  const mp3 = encodeMp3(cur);
  const next = await decode(mp3, orig.length);
  if (g === 1) {
    let best = [-1e9, 0] as [number, number];
    for (let lag = -1500; lag <= 1500; lag += 1) {
      const a = orig.subarray(Math.max(0, lag), orig.length + Math.min(0, lag));
      const b = next.subarray(
        Math.max(0, -lag),
        next.length - Math.max(0, lag)
      );
      const v = snr(a, b);
      if (v > best[0]) best = [v, lag];
    }
    console.log(
      `alignment check (gen 1): best SNR ${best[0].toFixed(2)} dB at lag ${best[1]} samples`
    );
  }
  if (GENS.includes(g))
    console.log(
      `${g} | ${snr(orig, next).toFixed(2)} | ${lsd(orig, next).toFixed(2)} | ${snr(prev, next).toFixed(2)} | ${mp3.length}`
    );
  prev = next;
  cur = next;
}
```
