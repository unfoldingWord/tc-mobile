import { unzipSync } from "fflate";

import { PROJECT_INGREDIENT_PATH } from "@/lib/export/bundle/input";
import { WAV_HEADER_BYTES } from "@/lib/audio/wav";
import { md5Hex } from "@/lib/export/md5";

import { validateBundleMetadata } from "./scripture-bundle-schema";

/**
 * The test-side reader for an exported Scripture Bundle zip (#1587, ADR 0014
 * "Consequences": R11's "read back by our own test"). It opens the archive and
 * refuses it, with a named reason, unless every check below holds. Test-only:
 * no reader ships to phones, and import is later work.
 */

export type BundleReadReason =
  | "metadata-not-last"
  | "schema"
  | "unlisted-file"
  | "missing-file"
  | "size"
  | "md5"
  | "wav-header"
  | "project-ingredient";

export class BundleReadError extends Error {
  constructor(
    readonly reason: BundleReadReason,
    detail: string
  ) {
    super(`${reason}: ${detail}`);
    this.name = "BundleReadError";
  }
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- the documents read back are arbitrary JSON

interface ReadBundle {
  /** Every entry, in the archive's own order. */
  readonly files: Readonly<Record<string, Uint8Array>>;
  readonly metadata: Json;
  readonly project: Json;
}

const decoder = new TextDecoder();

function json(bytes: Uint8Array): Json {
  return JSON.parse(decoder.decode(bytes)) as Json;
}

function ascii(bytes: Uint8Array, at: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(at, at + length));
}

/** A mono 16-bit PCM WAV whose sizes agree with the bytes that carry it. */
function wavHeaderAgrees(bytes: Uint8Array): boolean {
  if (bytes.length < WAV_HEADER_BYTES) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return (
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 4) === "WAVE" &&
    ascii(bytes, 36, 4) === "data" &&
    view.getUint16(22, true) === 1 &&
    view.getUint16(34, true) === 16 &&
    view.getUint32(4, true) === bytes.length - 8 &&
    view.getUint32(40, true) === bytes.length - WAV_HEADER_BYTES
  );
}

/**
 * Open `zip` and check it:
 *
 * - `metadata.json` is the archive's last entry (ADR 0014 point 3);
 * - it passes the vendored v1.0.0 schema gate (#1478);
 * - every other entry is a listed ingredient, and every ingredient is there;
 * - each ingredient's byte count and MD5 match what `metadata.json` says;
 * - each `.wav` ingredient's header agrees with its own length;
 * - every segment `project.json` gives an ingredient points at a listed one,
 *   every segment without one says why, and every audio ingredient belongs
 *   to exactly one segment.
 *
 * Throws {@link BundleReadError} on the first check that fails.
 */
export function readBundle(zip: Uint8Array): ReadBundle {
  const files = unzipSync(zip);
  const names = Object.keys(files);
  if (names.at(-1) !== "metadata.json") {
    throw new BundleReadError("metadata-not-last", names.join(", "));
  }
  const metadata = json(files["metadata.json"]!);
  const errors = validateBundleMetadata(metadata);
  if (errors.length > 0) {
    throw new BundleReadError("schema", JSON.stringify(errors));
  }

  const ingredients = metadata.ingredients as Record<string, Json>;
  for (const name of names) {
    if (name !== "metadata.json" && !(name in ingredients)) {
      throw new BundleReadError("unlisted-file", name);
    }
  }
  for (const [name, entry] of Object.entries(ingredients)) {
    const bytes = files[name];
    if (bytes === undefined) throw new BundleReadError("missing-file", name);
    if (bytes.length !== entry.size) {
      throw new BundleReadError(
        "size",
        `${name}: ${bytes.length} != ${entry.size}`
      );
    }
    if (md5Hex(bytes) !== entry.checksum?.md5) {
      throw new BundleReadError("md5", name);
    }
    if (name.endsWith(".wav") && !wavHeaderAgrees(bytes)) {
      throw new BundleReadError("wav-header", name);
    }
  }

  const project = json(files[PROJECT_INGREDIENT_PATH]!);
  const claimed = new Set<string>();
  for (const chapter of project.chapters as Json[]) {
    for (const segment of chapter.segments as Json[]) {
      const ingredient = segment.ingredient as string | null;
      if (ingredient === null) {
        if (segment.missingAudio === null) {
          throw new BundleReadError(
            "project-ingredient",
            `${segment.id} has neither audio nor a reason`
          );
        }
        continue;
      }
      if (!(ingredient in ingredients) || claimed.has(ingredient)) {
        throw new BundleReadError("project-ingredient", ingredient);
      }
      claimed.add(ingredient);
    }
  }
  for (const name of Object.keys(ingredients)) {
    if (name.startsWith("ingredients/audio/") && !claimed.has(name)) {
      throw new BundleReadError("project-ingredient", `${name} has no segment`);
    }
  }

  return { files, metadata, project };
}
