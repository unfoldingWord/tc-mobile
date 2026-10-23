/**
 * A QR code encoder (ISO/IEC 18004:2015), pure and DOM-free: byte mode,
 * error-correction level M, versions 1 to 6, with the mask chosen by the
 * standard's four penalty rules. It returns the module matrix only; drawing it
 * is the caller's job (#1250).
 *
 * Why it is hand-written rather than a dependency: the one use is a fixed
 * store link on the About screen (#1250), which must be generated with no
 * network call, and an encoder this narrow is a few hundred lines.
 *
 * Why it stops at version 6: version 7 is where the standard adds the version
 * information blocks and a second ring of alignment patterns. Version 6-M holds
 * 106 bytes, and the link #1250 encodes is 70, so the extra structure would be
 * code with no caller. A longer text throws rather than producing a symbol.
 *
 * Text is encoded as UTF-8 with no ECI header, which is what common phone
 * scanners assume for byte mode; ASCII text, such as a URL, is the same either
 * way.
 */

/** A square of modules; `modules[row][column]` is true for a dark module. */
export interface QrCode {
  readonly version: number;
  readonly mask: number;
  readonly size: number;
  readonly modules: readonly (readonly boolean[])[];
}

/**
 * Level M per version (Table 9): error-correction codewords per block, the
 * number of blocks, and the total codeword count. Every block of a version is
 * the same size at M for versions 1 to 6.
 */
const LEVEL_M: readonly (readonly [
  ec: number,
  blocks: number,
  total: number,
])[] = [
  [10, 1, 26],
  [16, 1, 44],
  [26, 1, 70],
  [18, 2, 100],
  [24, 2, 134],
  [16, 4, 172],
];

const MAX_VERSION = LEVEL_M.length;

/** Data codewords in a version at level M: all codewords less every block's EC. */
function dataCapacity(version: number): number {
  const [ec, blocks, total] = LEVEL_M[version - 1] ?? fail();
  return total - ec * blocks;
}

// Penalty weights N1 to N4 (7.8.3.1, Table 11).
const N1 = 3;
const N2 = 3;
const N3 = 40;
const N4 = 10;

/**
 * Encode `text` as the smallest version that holds it, with the mask whose
 * penalty score is lowest (ties go to the lower mask number). `options.mask`
 * forces a mask instead, which is how the standard's worked examples, given
 * with a stated mask, are reproduced.
 *
 * @pivotpending #1250 part 2: the About screen draws this matrix. Until that
 *   lane lands, the only reader is tests/qr.test.ts.
 */
export function encodeQr(
  text: string,
  options: { mask?: number } = {}
): QrCode {
  const bytes = new TextEncoder().encode(text);
  const version =
    LEVEL_M.findIndex(
      (_, i) => 12 + 8 * bytes.length <= dataCapacity(i + 1) * 8
    ) + 1;
  if (version === 0) {
    throw new RangeError(
      `QR: ${bytes.length} bytes is more than version ${MAX_VERSION}-M holds`
    );
  }
  const codewords = interleave(version, dataCodewords(version, bytes));
  const size = version * 4 + 17;
  const fn = grid(size);
  const base = grid(size);
  drawFunctionPatterns(version, base, fn);
  placeCodewords(base, fn, codewords);

  const forced = options.mask;
  if (
    forced !== undefined &&
    !(Number.isInteger(forced) && forced >= 0 && forced <= 7)
  ) {
    throw new RangeError(`QR: mask ${forced} is not 0 to 7`);
  }
  let best: { mask: number; modules: boolean[][] } | undefined;
  let bestScore = Infinity;
  for (const mask of forced === undefined
    ? [0, 1, 2, 3, 4, 5, 6, 7]
    : [forced]) {
    const modules = applyMask(base, fn, mask);
    drawFormatBits(modules, mask);
    const score = forced === undefined ? penaltyScore(modules) : 0;
    if (score < bestScore) {
      bestScore = score;
      best = { mask, modules };
    }
  }
  if (!best) throw new Error("QR: no mask was scored");
  return { version, mask: best.mask, size, modules: best.modules };
}

/** Byte-mode bit stream, terminated and padded to the version's data capacity. */
function dataCodewords(version: number, bytes: Uint8Array): number[] {
  const capacity = dataCapacity(version);
  const capacityBits = capacity * 8;
  const bits: number[] = [];
  const push = (value: number, length: number): void => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4); // byte mode indicator
  push(bytes.length, 8); // character count, 8 bits for versions 1 to 9
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, capacityBits - bits.length)); // terminator
  push(0, (8 - (bits.length % 8)) % 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | (bits[i + j] ?? 0);
    out.push(byte);
  }
  for (let pad = 0xec; out.length < capacity; pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

/** Split into blocks, add each block's error correction, interleave (7.6). */
function interleave(version: number, data: readonly number[]): number[] {
  const [ec, blockCount] = LEVEL_M[version - 1] ?? fail();
  const perBlock = data.length / blockCount;
  const blocks: number[][] = [];
  for (let b = 0; b < blockCount; b++)
    blocks.push(data.slice(b * perBlock, (b + 1) * perBlock));
  const ecBlocks = blocks.map((block) => reedSolomonRemainder(block, ec));
  const out: number[] = [];
  for (let i = 0; i < perBlock; i++)
    for (const block of blocks) out.push(block[i] ?? fail());
  for (let i = 0; i < ec; i++)
    for (const block of ecBlocks) out.push(block[i] ?? fail());
  return out;
}

/** Multiply in GF(256) with the QR field polynomial x^8 + x^4 + x^3 + x^2 + 1. */
function gfMultiply(a: number, b: number): number {
  let product = 0;
  for (let i = 7; i >= 0; i--) {
    product = (product << 1) ^ ((product >>> 7) * 0x11d);
    product ^= ((b >>> i) & 1) * a;
  }
  return product;
}

/**
 * The `degree` Reed-Solomon error-correction codewords for `data`: the
 * remainder of data(x)·x^degree divided by the generator polynomial with roots
 * α^0 to α^(degree-1) (7.5.2). Exported for the standard's own codeword
 * example (Annex I), which is in numeric mode and so cannot be reached through
 * `encodeQr`.
 */
export function reedSolomonRemainder(
  data: readonly number[],
  degree: number
): number[] {
  // Generator coefficients, highest power first with the leading 1 dropped.
  const generator = new Array<number>(degree).fill(0);
  generator[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      generator[j] =
        gfMultiply(generator[j] ?? 0, root) ^ (generator[j + 1] ?? 0);
    }
    root = gfMultiply(root, 2);
  }
  const remainder = new Array<number>(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ (remainder.shift() ?? 0);
    remainder.push(0);
    for (let j = 0; j < degree; j++)
      remainder[j] =
        (remainder[j] ?? 0) ^ gfMultiply(generator[j] ?? 0, factor);
  }
  return remainder;
}

function grid(size: number): boolean[][] {
  return Array.from({ length: size }, () =>
    new Array<boolean>(size).fill(false)
  );
}

function fail(): never {
  throw new Error("QR: table index out of range");
}

/**
 * Finder, separator, timing and alignment patterns and the dark module, into
 * `modules`; every function module, plus the reserved format areas, is marked
 * in `fn` so data placement and masking skip it.
 */
function drawFunctionPatterns(
  version: number,
  modules: boolean[][],
  fn: boolean[][]
): void {
  const size = modules.length;
  const set = (row: number, col: number, dark: boolean): void => {
    (modules[row] ?? fail())[col] = dark;
    (fn[row] ?? fail())[col] = true;
  };
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [r0, c0] of [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ] as const) {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = r0 + dr;
        const c = c0 + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const ring = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
        set(r, c, ring !== 2 && ring !== 4);
      }
    }
  }
  // Versions 2 to 6 have one alignment pattern, centred at (size-7, size-7).
  if (version >= 2) {
    const centre = size - 7;
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++)
        set(
          centre + dr,
          centre + dc,
          Math.max(Math.abs(dr), Math.abs(dc)) !== 1
        );
    }
  }
  // Reserve both format-information copies; drawFormatBits fills them.
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      set(8, i, false);
      set(i, 8, false);
    }
  }
  for (let i = 0; i < 8; i++) {
    set(8, size - 1 - i, false);
    set(size - 1 - i, 8, false);
  }
  set(size - 8, 8, true); // the dark module, at (4V + 9, 8)
}

/** Data and EC bits in the two-column zigzag from the bottom right (7.7.3). */
function placeCodewords(
  modules: boolean[][],
  fn: boolean[][],
  codewords: readonly number[]
): void {
  const size = modules.length;
  const totalBits = codewords.length * 8;
  let bit = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // skip the vertical timing column
    const upward = ((right + 1) & 2) === 0;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (let j = 0; j < 2; j++) {
        const col = right - j;
        if ((fn[row] ?? fail())[col] || bit >= totalBits) continue;
        // Remainder bits past the last codeword stay light (0) before masking.
        (modules[row] ?? fail())[col] =
          (((codewords[bit >>> 3] ?? 0) >>> (7 - (bit & 7))) & 1) === 1;
        bit++;
      }
    }
  }
}

/** Mask condition (Table 10) for row i, column j: true inverts the module. */
function maskBit(mask: number, i: number, j: number): boolean {
  switch (mask) {
    case 0:
      return (i + j) % 2 === 0;
    case 1:
      return i % 2 === 0;
    case 2:
      return j % 3 === 0;
    case 3:
      return (i + j) % 3 === 0;
    case 4:
      return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
    case 5:
      return ((i * j) % 2) + ((i * j) % 3) === 0;
    case 6:
      return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0;
    default:
      return (((i + j) % 2) + ((i * j) % 3)) % 2 === 0;
  }
}

function applyMask(
  base: readonly boolean[][],
  fn: readonly boolean[][],
  mask: number
): boolean[][] {
  return base.map((row, i) =>
    row.map((dark, j) =>
      (fn[i] ?? fail())[j] ? dark : dark !== maskBit(mask, i, j)
    )
  );
}

/**
 * The 15-bit format information for level M and `mask`: five data bits, ten
 * BCH(15,5) bits from the generator 0x537, then XOR 0x5412 (7.9.1, Annex C).
 */
function formatBits(mask: number): number {
  const data = (0b00 << 3) | mask; // level M is 00
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** Both copies of the format information; bit 14 is the most significant. */
function drawFormatBits(modules: boolean[][], mask: number): void {
  const size = modules.length;
  const bits = formatBits(mask);
  const put = (row: number, col: number, i: number): void => {
    (modules[row] ?? fail())[col] = ((bits >>> i) & 1) === 1;
  };
  // Copy 1, around the top-left finder.
  for (let i = 0; i <= 5; i++) put(i, 8, i);
  put(7, 8, 6);
  put(8, 8, 7);
  put(8, 7, 8);
  for (let i = 9; i < 15; i++) put(8, 14 - i, i);
  // Copy 2, split under the top-right finder and beside the bottom-left one.
  for (let i = 0; i < 8; i++) put(8, size - 1 - i, i);
  for (let i = 8; i < 15; i++) put(size - 15 + i, 8, i);
}

/**
 * The mask penalty score (7.8.3.1, Table 11), summed over rows and columns.
 *
 * Rule 3 is read as: each dark-light-dark-dark-dark-light-dark run scores once
 * when four light modules sit on at least one side of it, and the area outside
 * the symbol counts as light, because the quiet zone that surrounds a symbol is
 * light. Rule 4 scores N4 for each whole 5% step the dark share is away from
 * 50%.
 */
export function penaltyScore(modules: readonly (readonly boolean[])[]): number {
  const size = modules.length;
  const at = (row: number, col: number): boolean =>
    (modules[row] ?? fail())[col] ?? fail();
  let score = 0;
  let dark = 0;
  for (let line = 0; line < size; line++) {
    const row: boolean[] = [];
    const column: boolean[] = [];
    for (let k = 0; k < size; k++) {
      row.push(at(line, k));
      column.push(at(k, line));
    }
    for (const seq of [row, column])
      score += runPenalty(seq) + finderLikePenalty(seq);
    for (const m of row) if (m) dark++;
  }
  for (let r = 0; r + 1 < size; r++) {
    for (let c = 0; c + 1 < size; c++) {
      const v = at(r, c);
      if (at(r, c + 1) === v && at(r + 1, c) === v && at(r + 1, c + 1) === v)
        score += N2;
    }
  }
  const total = size * size;
  score += N4 * Math.floor(Math.abs(dark * 100 - total * 50) / (total * 5));
  return score;
}

/** Rule 1: each run of five or more same-colour modules scores N1 + (length - 5). */
function runPenalty(seq: readonly boolean[]): number {
  let score = 0;
  let run = 0;
  for (let k = 0; k <= seq.length; k++) {
    if (k > 0 && k < seq.length && seq[k] === seq[k - 1]) {
      run++;
      continue;
    }
    if (run >= 5) score += N1 + (run - 5);
    run = 1;
  }
  return score;
}

const FINDER_LIKE = [true, false, true, true, true, false, true] as const;

/** Rule 3: a 1:1:3:1:1 run with four light modules on at least one side. */
function finderLikePenalty(seq: readonly boolean[]): number {
  const lightSpan = (from: number, to: number): boolean => {
    for (let k = Math.max(from, 0); k < Math.min(to, seq.length); k++)
      if (seq[k]) return false;
    return true;
  };
  let score = 0;
  for (let k = 0; k + FINDER_LIKE.length <= seq.length; k++) {
    if (!FINDER_LIKE.every((m, d) => seq[k + d] === m)) continue;
    if (lightSpan(k - 4, k) || lightSpan(k + 7, k + 11)) score += N3;
  }
  return score;
}
