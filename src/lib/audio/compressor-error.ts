/**
 * What the speech compressor throws when it refuses its settings or a chunk.
 *
 * Its own module, not part of `compressor.ts`, so the main thread can import
 * the class (`hooks/finish-transcode.ts`, `hooks/mp3-codec.ts`) without
 * importing the DSP arithmetic; that arithmetic may live only in the worker
 * chunk (`tests/dist-dsp-worker-only.test.ts`, #1879).
 */
export class CompressorRangeError extends RangeError {
  override name = "CompressorRangeError";
}
