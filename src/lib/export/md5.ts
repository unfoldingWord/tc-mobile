/**
 * MD5 of an audio ingredient for the Scripture Bundle export (#1476).
 *
 * MD5 here is a content checksum the bundle format asks for, not a security
 * control. The digest comes from `@noble/hashes` (the DRI's pick on #1476)
 * rather than hand-written code, and it is pure JavaScript, so this module has
 * no DOM and no Web Crypto dependency — Web Crypto offers no MD5 at all.
 *
 * Two shapes: `md5Hex` for bytes already in hand, and `createMd5` for an
 * ingredient fed in pieces, so a long chapter never has to sit in memory twice.
 */

import { md5 } from "@noble/hashes/legacy.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** The lowercase hexadecimal MD5 digest of `bytes` (32 characters). */
export function md5Hex(bytes: Uint8Array): string {
  return bytesToHex(md5(bytes));
}

/** An incremental MD5: feed pieces with `update`, then read `digestHex` once. */
export interface Md5Stream {
  update(piece: Uint8Array): void;
  /** The lowercase hexadecimal digest. Finishes the stream; call it once. */
  digestHex(): string;
}

/** Start an incremental MD5. */
export function createMd5(): Md5Stream {
  const hash = md5.create();
  return {
    update(piece) {
      hash.update(piece);
    },
    digestHex() {
      return bytesToHex(hash.digest());
    },
  };
}
