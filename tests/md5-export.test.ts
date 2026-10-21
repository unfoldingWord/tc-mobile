import { describe, expect, it } from "vitest";
import { createMd5, md5Hex } from "@/lib/export/md5";

const ascii = (s: string) => new TextEncoder().encode(s);

/** The seven test vectors of RFC 1321, appendix A.5. */
const RFC_1321: readonly (readonly [string, string])[] = [
  ["", "d41d8cd98f00b204e9800998ecf8427e"],
  ["a", "0cc175b9c0f1b6a831c399e269772661"],
  ["abc", "900150983cd24fb0d6963f7d28e17f72"],
  ["message digest", "f96b697d7cb7938d525a2f31aaf161d0"],
  ["abcdefghijklmnopqrstuvwxyz", "c3fcd3d76192e4007dfb496cca67e13b"],
  [
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
    "d174ab98d277d9f5a5611c2c9f419d9f",
  ],
  [
    "12345678901234567890123456789012345678901234567890123456789012345678901234567890",
    "57edf4a22be3c955ac49da2e2107b67a",
  ],
];

describe("md5Hex (RFC 1321 test suite)", () => {
  it.each(RFC_1321)("hashes %j", (input, digest) => {
    expect(md5Hex(ascii(input))).toBe(digest);
  });

  it("hashes bytes that are not text", () => {
    // A million 'a' bytes: a long input crossing many 64-byte blocks.
    expect(md5Hex(new Uint8Array(1_000_000).fill(97))).toBe(
      "7707d6ae4e027c70eea2a935c2296f21"
    );
  });
});

describe("createMd5", () => {
  it("matches the one-shot digest however the input is split", () => {
    const [input, digest] = RFC_1321[6]!;
    const bytes = ascii(input);
    for (const cut of [0, 1, 63, 64, 65, bytes.length]) {
      const stream = createMd5();
      stream.update(bytes.subarray(0, cut));
      stream.update(bytes.subarray(cut));
      expect(stream.digestHex()).toBe(digest);
    }
  });

  it("gives the empty digest when nothing is fed", () => {
    expect(createMd5().digestHex()).toBe("d41d8cd98f00b204e9800998ecf8427e");
  });
});
